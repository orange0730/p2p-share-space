import Peer from 'peerjs';
import { BaseEngine } from './baseEngine';
import { PEER_OPTIONS, decodeChunk, describePeerError, parseMessage, sendBlob, sendJSON } from './protocol';
import { codeFromPeerId, fileKind, getIdentity, saveBlob, setDeviceName, uid } from './utils';
import { toast } from './toast';

const CONNECT_TIMEOUT = 20_000;
/** 斷線後自動重連的間隔（毫秒），總計約 3 分鐘後放棄，改由使用者手動重連 */
const RETRY_DELAYS = [1, 2, 3, 5, 8, 13, 20, 30, 30, 30, 30].map((s) => s * 1000);
/** Host 通知即將卸載（多半是重新整理）時，等它重新上線再連 */
const HOST_RELOAD_DELAY = 1500;
/** 即時新增的檔案：小於此大小自動向 Host 取回，讓轉發「即時可見」 */
const AUTO_FETCH_LIVE = 20 * 1024 * 1024;
/** 加入時的歷史檔案：只自動取回小圖片作為預覽，避免手機一進房就狂下載 */
const AUTO_FETCH_HISTORY = 5 * 1024 * 1024;
const ROOM_KEY = 'p2p-client-room';

/** 目前分頁加入中的空間（從系統分享選單開啟時用來自動回到原空間） */
export function readClientRoom() {
  try {
    return sessionStorage.getItem(ROOM_KEY);
  } catch {
    return null;
  }
}

function writeClientRoom(peerId) {
  try {
    if (peerId) sessionStorage.setItem(ROOM_KEY, peerId);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 加入端：只與 Host 建立單一 DataChannel。
 * status: connecting → connected ⇄ reconnecting → disconnected（放棄自動重連）| closed（Host 解散）| error（首次連線失敗）
 */
export class ClientEngine extends BaseEngine {
  constructor(hostId) {
    const me = getIdentity();
    super({ role: 'client', status: 'connecting', roomId: hostId, code: codeFromPeerId(hostId), self: me });
    this.hostId = hostId;
    this.me = me;
    this.everConnected = false;
    this.attempt = 0;
    /** itemId → { item, rid, parts, received, save } */
    this.downloads = new Map();
    /** rid → itemId：下載分塊以每次請求的 rid 標記 */
    this.rids = new Map();
    /** itemId → { ctrl: AbortController } */
    this.uploads = new Map();
    /** itemId → [{ resolve, reject }]：等待檔案下載完成的 Promise（匯出 ZIP 用） */
    this.waiters = new Map();
    this.uploadQueue = Promise.resolve();
    writeClientRoom(hostId);

    // 回到前景或網路恢復時，不必等退避計時器，立刻重連
    this.onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.retryPending || this.state.status === 'disconnected') this.reconnect();
    };
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);

    this.connect();
  }

  connect() {
    clearTimeout(this.retryTimer);
    this.retryPending = false;
    this.teardown();
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting', error: null });
    const peer = new Peer(PEER_OPTIONS);
    this.peer = peer;

    this.timeout = setTimeout(() => {
      if (this.peer === peer && this.state.status !== 'connected') this.failed('連線逾時。請確認主控裝置仍開著頁面，且網路正常。');
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
      if (this.state.status === 'connected') return;
      this.failed(describePeerError(err));
    });
  }

  /** 立即重連（手動按鈕、回到前景） */
  reconnect() {
    this.attempt = 0;
    this.connect();
  }

  /** 首次連線失敗直接顯示錯誤；連上過的空間則進入自動重連 */
  failed(message) {
    if (this.everConnected) return this.scheduleRetry();
    this.teardown();
    this.set({ status: 'error', error: message });
  }

  scheduleRetry(delay) {
    this.teardown();
    if (this.attempt >= RETRY_DELAYS.length) {
      this.set({ status: 'disconnected' });
      return;
    }
    this.retryPending = true;
    this.set({ status: 'reconnecting' });
    this.retryTimer = setTimeout(() => this.connect(), delay ?? RETRY_DELAYS[this.attempt]);
    this.attempt++;
  }

  teardown() {
    clearTimeout(this.timeout);
    const { peer, conn } = this;
    this.peer = this.conn = null;
    conn?.close();
    peer?.destroy();
    this.abortTransfers();
  }

  onClosed(conn) {
    if (this.destroyed || conn !== this.conn) return;
    if (['closed', 'error'].includes(this.state.status)) return;
    this.failed('與主控裝置的連線中斷');
  }

  /** 中斷時清掉所有進行中的傳輸；未完成的上傳標記為失敗 */
  abortTransfers() {
    this.downloads.clear();
    this.rids.clear();
    this.settleWaiters(null, new Error('連線已中斷'));
    for (const up of this.uploads.values()) up.ctrl.abort('disconnect');
    this.uploads.clear();
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
        const wasReconnect = this.everConnected;
        this.everConnected = true;
        this.attempt = 0;
        const items = Array.isArray(msg.items) ? msg.items : [];
        const keep = new Set(items.map((i) => i.id));
        for (const [id, f] of Object.entries(this.state.files)) if (!keep.has(id)) URL.revokeObjectURL(f.url);
        this.set((s) => ({
          status: 'connected',
          error: null,
          items,
          files: Object.fromEntries(Object.entries(s.files).filter(([id]) => keep.has(id))),
        }));
        if (wasReconnect) toast('已重新連線', 'success');
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
        // 小檔案的確認可能比節流的進度更新還早到，要連同尚未 flush 的進度一起清掉
        if (this.transferOf(item.id)?.dir === 'up') this.clearTransfer(item.id);
        if (item.type === 'file' && item.size <= AUTO_FETCH_LIVE) this.request(item.id, false);
        break;
      }
      case 'item-removed':
        this.dropDownload(msg.id);
        this.settleWaiters(msg.id, new Error('項目已被刪除'));
        this.removeLocal(msg.id);
        break;
      case 'file-missing':
        this.dropDownload(msg.id);
        this.settleWaiters(msg.id, new Error('主控裝置找不到這個檔案'));
        this.clearTransfer(msg.id);
        toast('主控裝置找不到這個檔案', 'error');
        break;
      case 'cleared': {
        // 保留自己正在上傳的項目，其餘全部清除
        this.downloads.clear();
        this.rids.clear();
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
      case 'host-leaving':
        this.scheduleRetry(HOST_RELOAD_DELAY);
        break;
      case 'room-closed':
        clearTimeout(this.retryTimer);
        this.teardown();
        this.set({ status: 'closed' });
        writeClientRoom(null);
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
    const dl = chunk && this.downloads.get(this.rids.get(chunk.id));
    if (!dl) return; // 已取消的下載殘留的分塊
    dl.parts.push(chunk.data);
    dl.received += chunk.data.byteLength;
    this.progress(dl.item.id, { loaded: dl.received });
    if (dl.received >= dl.item.size) this.finishDownload(dl);
  }

  dropDownload(id) {
    const dl = this.downloads.get(id);
    if (!dl) return null;
    this.downloads.delete(id);
    this.rids.delete(dl.rid);
    return dl;
  }

  finishDownload(dl) {
    const { item, parts, save } = dl;
    this.dropDownload(item.id);
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

    const dl = { item, rid: uid(), parts: [], received: 0, save };
    this.downloads.set(id, dl);
    this.rids.set(dl.rid, id);
    if (item.size === 0) return this.finishDownload(dl);
    this.progress(id, { dir: 'down', loaded: 0, total: item.size });
    sendJSON(this.conn, { t: 'file-request', id, rid: dl.rid });
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
      const ctrl = new AbortController();
      this.uploads.set(item.id, { ctrl });
      this.upsert(item);
      this.setLocalFile(item.id, file);
      this.progress(item.id, { dir: 'up', loaded: 0, total: file.size });
      this.uploadQueue = this.uploadQueue.then(() => this.upload(item, file, ctrl));
    }
  }

  async upload(item, file, ctrl) {
    if (ctrl.signal.aborted) return; // 排隊中就被取消
    const conn = this.conn;
    let started = false;
    try {
      if (!conn?.open) throw new Error('未連線');
      sendJSON(conn, { t: 'file-meta', id: item.id, name: item.name, size: item.size, mime: item.mime });
      started = true;
      await sendBlob(conn, item.id, file, (loaded) => this.progress(item.id, { loaded }), ctrl.signal);
      // 傳送佇列清空後，等 Host 回送 item-added 才算完成
    } catch {
      if (ctrl.signal.aborted) {
        // 使用者取消：通知 Host 丟掉已收到的部分；斷線則已由 abortTransfers 標記失敗
        if (started && ctrl.signal.reason === 'cancel') sendJSON(conn, { t: 'upload-cancel', id: item.id });
        return;
      }
      this.clearTransfer(item.id);
      this.set((s) => ({ items: s.items.map((i) => (i.id === item.id ? { ...i, pending: false, failed: true } : i)) }));
      toast(`「${item.name}」上傳失敗`, 'error');
    } finally {
      if (this.uploads.get(item.id)?.ctrl === ctrl) this.uploads.delete(item.id);
    }
  }

  cancelTransfer(id) {
    const t = this.transferOf(id);
    if (t?.dir === 'up') {
      const up = this.uploads.get(id);
      if (!up) return; // 已送完，只差 Host 確認
      up.ctrl.abort('cancel');
      this.uploads.delete(id);
      this.removeLocal(id);
      toast('已取消上傳');
    } else if (t?.dir === 'down') {
      const dl = this.dropDownload(id);
      if (dl) sendJSON(this.conn, { t: 'download-cancel', rid: dl.rid });
      this.settleWaiters(id, new Error('已取消下載'));
      this.clearTransfer(id);
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
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
    clearTimeout(this.retryTimer);
    writeClientRoom(null);
    this.teardown();
    super.destroy();
  }
}
