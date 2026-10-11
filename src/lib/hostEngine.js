import Peer from 'peerjs';
import { BaseEngine } from './baseEngine';
import * as storage from './storage';
import { PEER_OPTIONS, decodeChunk, describePeerError, parseMessage, sendBlob, sendJSON } from './protocol';
import { MAX_NAME, getIdentity, isPreviewable, peerIdFromCode, randomCode, safeId, saveBlob, setDeviceName, uid } from './utils';
import { toast } from './toast';

const MAX_ID_RETRIES = 5;
const MAX_TEXT = 100_000;
const SIGNAL_ERRORS = new Set(['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected']);

/**
 * 主控端（虛擬伺服器）：
 *  - 以 6 位數代碼註冊 Peer ID，接受所有 Client 的 DataChannel（星狀拓撲中心）
 *  - 所有內容寫入 IndexedDB，並轉發給其他在線 Client
 *  - 新 Client 連上時送出完整歷史；檔案內容依需求（file-request）以分塊回傳
 */
export class HostEngine extends BaseEngine {
  constructor() {
    const me = getIdentity();
    super({ role: 'host', status: 'starting', signal: 'connecting', self: me, peers: [{ ...me, isHost: true }] });
    this.me = me;
    /** conn.peer → { conn, identity, queue, uploads: Map<id, { item, parts, received }> } */
    this.clients = new Map();

    this.onBeforeUnload = (e) => {
      if (this.state.status !== 'ready') return;
      // 瀏覽器只會顯示自家的通用文字；頁面上另有常駐提示說明「關閉將導致共享空間解散」
      e.preventDefault();
      e.returnValue = '關閉將導致共享空間解散';
      return e.returnValue;
    };
    this.onPageHide = () => this.broadcast({ t: 'room-closed' });
    this.onVisibility = () => document.visibilityState === 'visible' && this.keepAwake();
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.init();
  }

  async init() {
    await storage.clearAll(); // 每個空間都從空白開始
    this.openPeer(0);
    this.keepAwake();
  }

  openPeer(attempt) {
    if (this.destroyed) return;
    const code = randomCode();
    const peer = new Peer(peerIdFromCode(code), PEER_OPTIONS);
    this.peer = peer;

    peer.on('open', (id) => this.set({ status: 'ready', signal: 'online', code, roomId: id, error: null }));
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.destroyed || peer !== this.peer) return;
      this.set({ signal: 'offline' });
      this.scheduleReconnect();
    });
    peer.on('error', (err) => {
      if (this.destroyed || peer !== this.peer) return;
      if (err.type === 'unavailable-id' && attempt < MAX_ID_RETRIES) {
        peer.destroy();
        this.openPeer(attempt + 1);
        return;
      }
      if (this.state.status === 'ready') {
        // 空間已建立：信令伺服器斷線不影響既有 P2P 連線，只會讓新裝置暫時無法加入
        if (SIGNAL_ERRORS.has(err.type)) {
          this.set({ signal: 'offline' });
          this.scheduleReconnect();
        }
        return;
      }
      this.set({ status: 'error', error: describePeerError(err) });
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      const peer = this.peer;
      if (this.destroyed || !peer || peer.destroyed) return;
      if (peer.disconnected) peer.reconnect();
    }, 3000);
  }

  accept(conn) {
    conn.on('open', () => {
      if (this.destroyed) return conn.close();
      const meta = conn.metadata || {};
      const identity = {
        id: safeId(meta.id),
        name: String(meta.name || '訪客裝置').slice(0, MAX_NAME),
        kind: ['phone', 'tablet', 'desktop'].includes(meta.kind) ? meta.kind : 'desktop',
      };
      this.clients.get(conn.peer)?.conn.close();
      this.clients.set(conn.peer, { conn, identity, queue: Promise.resolve(), uploads: new Map() });
      sendJSON(conn, { t: 'welcome', host: this.me, items: this.state.items });
      this.syncPeers();
      toast(`${identity.name} 已加入`, 'success');
    });
    conn.on('data', (data) => this.onData(conn.peer, data));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  drop(conn) {
    const c = this.clients.get(conn.peer);
    if (!c || c.conn !== conn) return;
    this.clients.delete(conn.peer);
    for (const id of c.uploads.keys()) this.clearTransfer(id);
    this.syncPeers();
    if (!this.destroyed) toast(`${c.identity.name} 已離開`);
  }

  syncPeers() {
    const peers = [{ ...this.me, isHost: true }, ...[...this.clients.values()].map((c) => c.identity)];
    this.set({ peers });
    this.broadcast({ t: 'peers', peers });
  }

  broadcast(msg) {
    for (const c of this.clients.values()) sendJSON(c.conn, msg);
  }

  onData(peerId, data) {
    const c = this.clients.get(peerId);
    if (!c) return;
    if (typeof data !== 'string') return this.onChunk(c, data);

    const msg = parseMessage(data);
    if (!msg) return;
    switch (msg.t) {
      case 'text': {
        const text = String(msg.text ?? '').slice(0, MAX_TEXT);
        if (text.trim()) this.addItem({ id: safeId(msg.id), type: 'text', text, from: c.identity, createdAt: Date.now() });
        break;
      }
      case 'file-meta': {
        const item = {
          id: safeId(msg.id),
          type: 'file',
          name: String(msg.name || '未命名檔案').slice(0, 255),
          size: Math.max(0, Math.floor(Number(msg.size) || 0)),
          mime: String(msg.mime || 'application/octet-stream').slice(0, 128),
          from: c.identity,
          createdAt: Date.now(),
        };
        const upload = { item, parts: [], received: 0 };
        c.uploads.set(item.id, upload);
        this.progress(item.id, { dir: 'down', loaded: 0, total: item.size, name: item.name, from: c.identity.name });
        if (item.size === 0) this.finishUpload(c, upload);
        break;
      }
      case 'file-request':
        this.serveFile(c, msg.id);
        break;
      case 'delete':
        this.deleteItem(msg.id);
        break;
      case 'clear':
        this.clearAll();
        break;
      case 'rename': {
        const name = String(msg.name ?? '').trim().slice(0, MAX_NAME);
        if (!name) return;
        c.identity = { ...c.identity, name };
        this.syncPeers();
        break;
      }
    }
  }

  onChunk(c, data) {
    const chunk = decodeChunk(data);
    const upload = chunk && c.uploads.get(chunk.id);
    if (!upload) return;
    upload.parts.push(chunk.data);
    upload.received += chunk.data.byteLength;
    this.progress(upload.item.id, { loaded: upload.received });
    if (upload.received >= upload.item.size) this.finishUpload(c, upload);
  }

  async finishUpload(c, { item, parts }) {
    c.uploads.delete(item.id);
    const blob = new Blob(parts, { type: item.mime });
    this.clearTransfer(item.id);
    await this.addItem(item, blob);
  }

  async addItem(item, blob) {
    if (this.state.items.some((i) => i.id === item.id)) return;
    await storage.putItem(item, blob);
    if (blob && isPreviewable(item)) this.setLocalFile(item.id, blob);
    this.set((s) => ({ items: [...s.items, item] }));
    this.broadcast({ t: 'item-added', item });
  }

  serveFile(c, id) {
    const item = this.state.items.find((i) => i.id === id && i.type === 'file');
    // 每個 Client 一條傳送佇列，檔案依序傳送，背壓只需看單一 DataChannel
    c.queue = c.queue
      .then(async () => {
        if (!c.conn.open) return;
        const blob = item && (this.state.files[id]?.blob ?? (await storage.getBlob(id)));
        if (!blob) return sendJSON(c.conn, { t: 'file-missing', id });
        await sendBlob(c.conn, id, blob);
      })
      .catch((err) => console.warn('傳送檔案失敗', err));
  }

  async deleteItem(id) {
    if (!this.state.items.some((i) => i.id === id)) return;
    this.removeLocal(id);
    this.broadcast({ t: 'item-removed', id });
    await storage.deleteItem(id);
  }

  async clearAll() {
    if (!this.state.items.length) return;
    this.revokeAll();
    this.pendingTransfers = {};
    // 只清掉已完成的項目；正在上傳中的檔案（transfers 裡 dir=down 的）照常完成
    this.set((s) => ({ items: [], files: {}, transfers: Object.fromEntries(Object.entries(s.transfers).filter(([, t]) => t.dir === 'down')) }));
    this.broadcast({ t: 'cleared' });
    await storage.clearAll();
  }

  // ---- 本機（Host 使用者）操作 ----

  rename(name) {
    this.me = setDeviceName(name);
    this.set({ self: this.me });
    this.syncPeers();
  }

  async fetchBlob(id) {
    return this.state.files[id]?.blob ?? (await storage.getBlob(id));
  }

  sendText(text) {
    return this.addItem({ id: uid(), type: 'text', text, from: this.me, createdAt: Date.now() });
  }

  async sendFiles(files) {
    for (const file of files) {
      await this.addItem(
        { id: uid(), type: 'file', name: file.name, size: file.size, mime: file.type || 'application/octet-stream', from: this.me, createdAt: Date.now() },
        file,
      );
    }
  }

  async download(id) {
    const item = this.state.items.find((i) => i.id === id);
    const blob = await this.fetchBlob(id);
    if (item && blob) saveBlob(blob, item.name);
    else toast('找不到檔案內容', 'error');
  }

  async keepAwake() {
    // 主控裝置螢幕關閉後，行動瀏覽器可能中斷連線；盡量保持喚醒
    if (this.destroyed || this.wakeLock || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
      this.wakeLock?.addEventListener('release', () => (this.wakeLock = null));
    } catch {
      /* 不支援或被拒絕時忽略 */
    }
  }

  destroy() {
    this.broadcast({ t: 'room-closed' });
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearTimeout(this.reconnectTimer);
    this.wakeLock?.release().catch(() => {});
    const peer = this.peer;
    // 稍等讓 room-closed 送出後再拆線
    setTimeout(() => peer?.destroy(), 300);
    super.destroy();
    storage.clearAll();
  }
}
