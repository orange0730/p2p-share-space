import Peer from 'peerjs';
import { BaseEngine } from './baseEngine';
import { RoomStore, cleanupStaleRooms, heartbeat } from './storage';
import { PEER_OPTIONS, decodeChunk, describePeerError, parseMessage, sendBlob, sendJSON } from './protocol';
import { MAX_NAME, getIdentity, isPreviewable, peerIdFromCode, randomCode, safeId, saveBlob, setDeviceName, uid } from './utils';
import { toast } from './toast';

const MAX_ID_RETRIES = 5;
/** 恢復空間時，舊連線可能還佔著同一個 Peer ID，稍等幾次再放棄原代碼 */
const RESUME_RETRIES = 8;
const RESUME_RETRY_DELAY = 2000;
const HEARTBEAT_INTERVAL = 20_000;
const MAX_TEXT = 100_000;
const SIGNAL_ERRORS = new Set(['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected']);
const SESSION_KEY = 'p2p-host-session';

/** 同一個分頁重新整理後，用這份紀錄恢復空間（sessionStorage 在分頁關閉時自動消失） */
export function readHostSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return s?.key && /^\d{6}$/.test(s.code) ? s : null;
  } catch {
    return null;
  }
}

function writeHostSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* 無法保存時只是不能恢復 */
  }
}

/**
 * 主控端（虛擬伺服器）：
 *  - 以 6 位數代碼註冊 Peer ID，接受所有 Client 的 DataChannel（星狀拓撲中心）
 *  - 所有內容寫入 IndexedDB，並轉發給其他在線 Client
 *  - 新 Client 連上時送出完整歷史；檔案內容依需求（file-request）以分塊回傳
 *  - 重新整理後以同一代碼恢復空間，Client 會自動重連
 */
export class HostEngine extends BaseEngine {
  /** @param {{ key: string, code: string } | null} resume 要恢復的空間 */
  constructor(resume = null) {
    const me = getIdentity();
    super({ role: 'host', status: 'starting', resuming: !!resume, signal: 'connecting', self: me, peers: [{ ...me, isHost: true }] });
    this.me = me;
    this.resume = resume;
    this.roomKey = resume?.key ?? uid();
    this.store = new RoomStore(this.roomKey);
    /** conn.peer → { conn, identity, queue, uploads: Map<id, upload>, serving: Map<rid, AbortController> } */
    this.clients = new Map();

    this.onBeforeUnload = (e) => {
      if (this.state.status !== 'ready') return;
      // 瀏覽器只會顯示自家的通用文字；頁面上另有常駐提示說明「關閉將導致共享空間解散」
      e.preventDefault();
      e.returnValue = '關閉將導致共享空間解散';
      return e.returnValue;
    };
    // 卸載時無法分辨是重新整理還是關閉分頁：先讓 Client 進入自動重連，Host 回來就能接上
    this.onPageHide = () => this.broadcast({ t: 'host-leaving' });
    this.onVisibility = () => document.visibilityState === 'visible' && this.keepAwake();
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.init();
  }

  async init() {
    heartbeat(this.roomKey);
    this.heartbeatTimer = setInterval(() => heartbeat(this.roomKey), HEARTBEAT_INTERVAL);
    cleanupStaleRooms(this.roomKey);

    if (this.resume) {
      const items = await this.store.getItems();
      for (const item of items) {
        if (item.type !== 'file' || !isPreviewable(item)) continue;
        const blob = await this.store.getBlob(item.id);
        if (blob) this.setLocalFile(item.id, blob);
      }
      this.set({ items });
    } else {
      await this.store.clear();
    }

    this.openPeer(this.resume?.code ?? randomCode(), 0);
    this.keepAwake();
  }

  openPeer(code, attempt) {
    if (this.destroyed) return;
    const peer = new Peer(peerIdFromCode(code), PEER_OPTIONS);
    this.peer = peer;

    peer.on('open', (id) => {
      this.set({ status: 'ready', signal: 'online', code, roomId: id, error: null });
      writeHostSession({ key: this.roomKey, code });
      if (this.state.resuming) {
        this.set({ resuming: false });
        toast(code === this.resume.code ? '已恢復空間，其他裝置會自動重新連線' : '已恢復空間內容', 'success');
      }
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.destroyed || peer !== this.peer) return;
      this.set({ signal: 'offline' });
      this.scheduleReconnect();
    });
    peer.on('error', (err) => {
      if (this.destroyed || peer !== this.peer) return;
      if (err.type === 'unavailable-id') {
        peer.destroy();
        // 恢復中：舊分頁的信令連線可能還沒被伺服器釋放，用同一代碼多試幾次
        if (this.state.resuming && code === this.resume.code) {
          if (attempt < RESUME_RETRIES) {
            this.retryTimer = setTimeout(() => this.openPeer(code, attempt + 1), RESUME_RETRY_DELAY);
            return;
          }
          toast('原本的代碼暫時無法使用，已換成新代碼，請重新邀請其他裝置', 'error');
        }
        if (attempt < RESUME_RETRIES + MAX_ID_RETRIES) {
          this.openPeer(randomCode(), attempt + 1);
          return;
        }
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

  /** 錯誤畫面的「重試」：保留資料與代碼重新註冊 */
  reconnect() {
    clearTimeout(this.retryTimer);
    this.peer?.destroy();
    this.set({ status: 'starting', error: null });
    this.openPeer(this.state.code || this.resume?.code || randomCode(), 0);
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
      this.clients.set(conn.peer, { conn, identity, queue: Promise.resolve(), uploads: new Map(), serving: new Map() });
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
    for (const ctrl of c.serving.values()) ctrl.abort();
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
      case 'upload-cancel':
        if (c.uploads.delete(msg.id)) this.clearTransfer(msg.id);
        break;
      case 'file-request':
        this.serveFile(c, msg.id, typeof msg.rid === 'string' ? safeId(msg.rid) : msg.id);
        break;
      case 'download-cancel':
        c.serving.get(msg.rid)?.abort();
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
    await this.store.putItem(item, blob);
    if (blob && isPreviewable(item)) this.setLocalFile(item.id, blob);
    this.set((s) => ({ items: [...s.items, item] }));
    this.broadcast({ t: 'item-added', item });
  }

  serveFile(c, id, rid) {
    const item = this.state.items.find((i) => i.id === id && i.type === 'file');
    const ctrl = new AbortController();
    c.serving.set(rid, ctrl);
    // 每個 Client 一條傳送佇列，檔案依序傳送，背壓只需看單一 DataChannel
    c.queue = c.queue
      .then(async () => {
        if (ctrl.signal.aborted || !c.conn.open) return;
        const blob = item && (await this.fetchBlob(id));
        if (!blob) return sendJSON(c.conn, { t: 'file-missing', id, rid });
        await sendBlob(c.conn, rid, blob, null, ctrl.signal);
      })
      .catch((err) => err.name !== 'AbortError' && console.warn('傳送檔案失敗', err))
      .finally(() => c.serving.delete(rid));
  }

  async deleteItem(id) {
    if (!this.state.items.some((i) => i.id === id)) return;
    this.removeLocal(id);
    this.broadcast({ t: 'item-removed', id });
    await this.store.deleteItem(id);
  }

  async clearAll() {
    if (!this.state.items.length) return;
    this.revokeAll();
    this.pendingTransfers = {};
    // 只清掉已完成的項目；正在上傳中的檔案（transfers 裡 dir=down 的）照常完成
    this.set((s) => ({ items: [], files: {}, transfers: Object.fromEntries(Object.entries(s.transfers).filter(([, t]) => t.dir === 'down')) }));
    this.broadcast({ t: 'cleared' });
    await this.store.clear();
  }

  // ---- 本機（Host 使用者）操作 ----

  rename(name) {
    this.me = setDeviceName(name);
    this.set({ self: this.me });
    this.syncPeers();
  }

  async fetchBlob(id) {
    return this.state.files[id]?.blob ?? (await this.store.getBlob(id));
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

  /** 主動解散空間：通知所有 Client、刪除資料、不再恢復 */
  destroy() {
    this.broadcast({ t: 'room-closed' });
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeatTimer);
    this.wakeLock?.release().catch(() => {});
    writeHostSession(null);
    const peer = this.peer;
    // 稍等讓 room-closed 送出後再拆線
    setTimeout(() => peer?.destroy(), 300);
    super.destroy();
    this.store.drop();
  }
}
