import Peer from 'peerjs';
import { BaseEngine } from './baseEngine';
import { PEER_OPTIONS, decodeChunk, describePeerError, parseMessage, sendBlob, sendJSON } from './protocol';
import { codeFromPeerId, fileKind, getIdentity, saveBlob, setDeviceName, uid } from './utils';
import { toast } from './toast';

const CONNECT_TIMEOUT = 20_000;
/** 即時新增的檔案：小於此大小自動向 Host 取回，讓轉發「即時可見」 */
const AUTO_FETCH_LIVE = 20 * 1024 * 1024;
/** 加入時的歷史檔案：只自動取回小圖片作為預覽，避免手機一進房就狂下載 */
const AUTO_FETCH_HISTORY = 5 * 1024 * 1024;

/**
 * 加入端：只與 Host 建立單一 DataChannel。
 * status: connecting → connected → disconnected | closed | error
 */
export class ClientEngine extends BaseEngine {
  constructor(hostId) {
    const me = getIdentity();
    super({ role: 'client', status: 'connecting', roomId: hostId, code: codeFromPeerId(hostId), self: me });
    this.hostId = hostId;
    this.me = me;
    /** id → { item, parts, received, save } */
    this.downloads = new Map();
    /** id → [{ resolve, reject }]：等待檔案下載完成的 Promise（匯出 ZIP 用） */
    this.waiters = new Map();
    this.uploadQueue = Promise.resolve();

    // 手機切到背景常會斷線，回到前景時自動重連
    this.onVisibility = () => {
      if (document.visibilityState === 'visible' && this.state.status === 'disconnected') this.reconnect();
    };
    document.addEventListener('visibilitychange', this.onVisibility);

    this.connect();
  }

  connect() {
    this.teardown();
    this.set({ status: 'connecting', error: null });
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;

    this.timeout = setTimeout(() => {
      if (this.peer === peer && this.state.status === 'connecting') this.fail('連線逾時。請確認主控裝置仍開著頁面，且網路正常。');
    }, CONNECT_TIMEOUT);

    peer.on('open', () => {
      const conn = peer.connect(this.hostId, { reliable: true, serialization: 'raw', metadata: this.me });
      this.conn = conn;
      conn.on('data', (data) => this.onData(data));
      conn.on('close', () => this.onClosed(conn));
      conn.on('error', () => this.onClosed(conn));
    });
    peer.on('error', (err) => {
      if (this.destroyed || this.peer !== peer) return;
      // 已連上後，信令伺服器的問題不影響 DataChannel
      if (this.state.status === 'connected' && err.type !== 'peer-unavailable') return;
      this.fail(describePeerError(err));
    });
  }

  reconnect() {
    this.connect();
  }

  teardown() {
    clearTimeout(this.timeout);
    const { peer, conn } = this;
    this.peer = this.conn = null;
    conn?.close();
    peer?.destroy();
    this.abortTransfers();
  }

  fail(message) {
    this.teardown();
    this.set({ status: 'error', error: message });
  }

  onClosed(conn) {
    if (this.destroyed || conn !== this.conn) return;
    if (['closed', 'error'].includes(this.state.status)) return;
    this.abortTransfers();
    this.set({ status: 'disconnected' });
  }

  /** 中斷時清掉所有進行中的傳輸；未完成的上傳標記為失敗 */
  abortTransfers() {
    this.downloads.clear();
    this.settleWaiters(null, new Error('連線已中斷'));
    if (!Object.keys(this.state.transfers).length && !this.state.items.some((i) => i.pending)) return;
    this.pendingTransfers = {};
    this.set((s) => ({
      transfers: {},
      items: s.items.map((i) => (i.pending ? { ...i, pending: false, failed: true } : i)),
    }));
  }

  onData(data) {
    if (typeof data !== 'string') return this.onChunk(data);
    const msg = parseMessage(data);
    if (!msg) return;

    switch (msg.t) {
      case 'welcome': {
        clearTimeout(this.timeout);
        const items = Array.isArray(msg.items) ? msg.items : [];
        const keep = new Set(items.map((i) => i.id));
        for (const [id, f] of Object.entries(this.state.files)) if (!keep.has(id)) URL.revokeObjectURL(f.url);
        this.set((s) => ({
          status: 'connected',
          error: null,
          items,
          files: Object.fromEntries(Object.entries(s.files).filter(([id]) => keep.has(id))),
        }));
        for (const item of items) {
          if (item.type === 'file' && fileKind(item.mime) === 'image' && item.size <= AUTO_FETCH_HISTORY) this.request(item.id, false);
        }
        break;
      }
      case 'peers':
        if (Array.isArray(msg.peers)) this.set({ peers: msg.peers });
        break;
      case 'item-added': {
        const item = msg.item;
        if (!item?.id) return;
        this.upsert(item);
        if (this.state.transfers[item.id]?.dir === 'up') this.clearTransfer(item.id);
        if (item.type === 'file' && item.size <= AUTO_FETCH_LIVE) this.request(item.id, false);
        break;
      }
      case 'item-removed':
        this.downloads.delete(msg.id);
        this.settleWaiters(msg.id, new Error('項目已被刪除'));
        this.removeLocal(msg.id);
        break;
      case 'file-missing':
        this.downloads.delete(msg.id);
        this.settleWaiters(msg.id, new Error('主控裝置找不到這個檔案'));
        this.clearTransfer(msg.id);
        toast('主控裝置找不到這個檔案', 'error');
        break;
      case 'cleared': {
        // 保留自己正在上傳的項目，其餘全部清除
        this.downloads.clear();
        this.settleWaiters(null, new Error('內容已被清除'));
        const keep = new Set(this.state.items.filter((i) => i.pending).map((i) => i.id));
        for (const [id, f] of Object.entries(this.state.files)) if (!keep.has(id)) URL.revokeObjectURL(f.url);
        this.pendingTransfers = {};
        this.set((s) => ({
          items: s.items.filter((i) => keep.has(i.id)),
          files: Object.fromEntries(Object.entries(s.files).filter(([id]) => keep.has(id))),
          transfers: Object.fromEntries(Object.entries(s.transfers).filter(([id]) => keep.has(id))),
        }));
        break;
      }
      case 'room-closed':
        this.teardown();
        this.set({ status: 'closed' });
        break;
    }
  }

  upsert(item) {
    this.set((s) => {
      const idx = s.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return { items: [...s.items, item] };
      const items = s.items.slice();
      items[idx] = item; // 以 Host 版本取代本機的樂觀項目（清除 pending）
      return { items };
    });
  }

  onChunk(data) {
    const chunk = decodeChunk(data);
    const dl = chunk && this.downloads.get(chunk.id);
    if (!dl) return;
    dl.parts.push(chunk.data);
    dl.received += chunk.data.byteLength;
    this.progress(chunk.id, { loaded: dl.received });
    if (dl.received >= dl.item.size) this.finishDownload(dl);
  }

  finishDownload({ item, parts, save }) {
    this.downloads.delete(item.id);
    const blob = new Blob(parts, { type: item.mime });
    this.clearTransfer(item.id);
    this.setLocalFile(item.id, blob);
    this.settleWaiters(item.id, null, blob);
    if (save) saveBlob(blob, item.name);
  }

  /** id 為 null 時處理全部等待者 */
  settleWaiters(id, error, blob) {
    const ids = id == null ? [...this.waiters.keys()] : [id];
    for (const key of ids) {
      for (const w of this.waiters.get(key) ?? []) error ? w.reject(error) : w.resolve(blob);
      this.waiters.delete(key);
    }
  }

  /** 取得檔案內容；本機沒有就向 Host 下載並等待完成 */
  fetchBlob(id) {
    const local = this.state.files[id];
    if (local) return Promise.resolve(local.blob);
    return new Promise((resolve, reject) => {
      const list = this.waiters.get(id) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(id, list);
      this.request(id, false);
      if (!this.downloads.has(id) && !this.state.files[id]) this.settleWaiters(id, new Error('尚未連線到主控裝置'));
    });
  }

  request(id, save) {
    const item = this.state.items.find((i) => i.id === id && i.type === 'file');
    if (!item) return;
    const local = this.state.files[id];
    if (local) return save && saveBlob(local.blob, item.name);

    const existing = this.downloads.get(id);
    if (existing) {
      existing.save ||= save;
      return;
    }
    if (!this.conn?.open) return save && toast('尚未連線到主控裝置', 'error');

    const dl = { item, parts: [], received: 0, save };
    this.downloads.set(id, dl);
    if (item.size === 0) return this.finishDownload(dl);
    this.progress(id, { dir: 'down', loaded: 0, total: item.size });
    sendJSON(this.conn, { t: 'file-request', id });
  }

  // ---- 使用者操作 ----

  sendText(text) {
    if (!this.conn?.open) return toast('尚未連線到主控裝置', 'error');
    const item = { id: uid(), type: 'text', text, from: this.me, createdAt: Date.now(), pending: true };
    this.upsert(item);
    sendJSON(this.conn, { t: 'text', id: item.id, text });
  }

  sendFiles(files) {
    if (!this.conn?.open) return toast('尚未連線到主控裝置', 'error');
    for (const file of files) {
      const item = {
        id: uid(),
        type: 'file',
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        from: this.me,
        createdAt: Date.now(),
        pending: true,
      };
      this.upsert(item);
      this.setLocalFile(item.id, file);
      this.progress(item.id, { dir: 'up', loaded: 0, total: file.size });
      this.uploadQueue = this.uploadQueue.then(() => this.upload(item, file));
    }
  }

  async upload(item, file) {
    const conn = this.conn;
    try {
      if (!conn?.open) throw new Error('未連線');
      sendJSON(conn, { t: 'file-meta', id: item.id, name: item.name, size: item.size, mime: item.mime });
      await sendBlob(conn, item.id, file, (loaded) => this.progress(item.id, { loaded }));
      // 傳送佇列清空後，等 Host 回送 item-added 才算完成
    } catch {
      this.clearTransfer(item.id);
      this.set((s) => ({ items: s.items.map((i) => (i.id === item.id ? { ...i, pending: false, failed: true } : i)) }));
      toast(`「${item.name}」上傳失敗`, 'error');
    }
  }

  rename(name) {
    this.me = setDeviceName(name);
    this.set({ self: this.me });
    sendJSON(this.conn, { t: 'rename', name: this.me.name });
  }

  clearAll() {
    if (!this.conn?.open) return toast('尚未連線到主控裝置', 'error');
    sendJSON(this.conn, { t: 'clear' });
  }

  download(id) {
    this.request(id, true);
  }

  deleteItem(id) {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return;
    if (item.failed) return this.removeLocal(id); // 從未成功送達 Host 的項目只需本機移除
    if (!this.conn?.open) return toast('尚未連線到主控裝置', 'error');
    sendJSON(this.conn, { t: 'delete', id });
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.teardown();
    super.destroy();
  }
}
