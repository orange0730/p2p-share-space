/**
 * Host / Client 引擎的共用基底：一個可被 useSyncExternalStore 訂閱的狀態容器。
 *
 * state.items      共享項目（依加入順序）
 * state.peers      在線裝置（含 Host）
 * state.transfers  { [id]: { dir: 'up' | 'down', loaded, total, name?, from? } }
 * state.files      本機已有內容的檔案 { [id]: { blob, url } }
 */
export class BaseEngine {
  constructor(init) {
    this.state = {
      status: 'connecting',
      error: null,
      code: '',
      roomId: '',
      items: [],
      peers: [],
      transfers: {},
      files: {},
      ...init,
    };
    this.listeners = new Set();
    this.pendingTransfers = {};
    this.flushTimer = null;
    this.destroyed = false;
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  set(patch) {
    if (this.destroyed) return;
    const next = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => fn());
  }

  /** 進度更新節流（約 8 fps），避免每個分塊都觸發重新渲染 */
  progress(id, patch) {
    this.pendingTransfers[id] = { ...(this.pendingTransfers[id] ?? this.state.transfers[id]), ...patch };
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      const pending = this.pendingTransfers;
      this.pendingTransfers = {};
      this.set((s) => ({ transfers: { ...s.transfers, ...pending } }));
    }, 120);
  }

  /** 目前的傳輸狀態（含尚未 flush 的節流更新） */
  transferOf(id) {
    return this.pendingTransfers[id] ?? this.state.transfers[id];
  }

  clearTransfer(id) {
    delete this.pendingTransfers[id];
    if (!(id in this.state.transfers)) return;
    this.set((s) => {
      const { [id]: _, ...rest } = s.transfers;
      return { transfers: rest };
    });
  }

  setLocalFile(id, blob) {
    const url = URL.createObjectURL(blob);
    this.set((s) => ({ files: { ...s.files, [id]: { blob, url } } }));
  }

  removeLocal(id) {
    const f = this.state.files[id];
    if (f) URL.revokeObjectURL(f.url);
    this.clearTransfer(id);
    this.set((s) => {
      const { [id]: _, ...files } = s.files;
      return { items: s.items.filter((i) => i.id !== id), files };
    });
  }

  revokeAll() {
    Object.values(this.state.files).forEach((f) => URL.revokeObjectURL(f.url));
  }

  destroy() {
    clearTimeout(this.flushTimer);
    this.revokeAll();
    this.destroyed = true;
    this.listeners.clear();
  }
}
