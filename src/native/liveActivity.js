import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './platform';

/**
 * iOS 即時動態 / 動態島的橋接。原生端實作在 native/ios/LiveActivityPlugin.swift，
 * 網頁版不會呼叫（isNativeApp() 為 false），所以不需要 web 實作。
 *
 * start({ roomCode, role, ...LiveState })  update(LiveState)  end()
 */
const LiveActivity = registerPlugin('LiveActivity');

const call = (method, data) => (isNativeApp() ? LiveActivity[method](data).catch(() => {}) : Promise.resolve());

export const liveActivity = {
  start: (data) => call('start', data),
  update: (data) => call('update', data),
  end: () => call('end'),
};

/**
 * 把引擎狀態轉成動態島要顯示的內容（對應 Swift 的 ShareSpaceAttributes.ContentState）。
 * 只送有值的欄位，原生端讀不到就當作 nil。
 */
export function toLiveState(s) {
  const status = s.role === 'host' ? (s.status === 'ready' ? 'online' : s.status) : s.status === 'connected' ? 'online' : s.status;
  let top = null; // 同時有多個傳輸時，顯示最大的那個
  for (const [id, t] of Object.entries(s.transfers)) if (!top || t.total > top.t.total) top = { id, t };

  const state = { status, deviceCount: s.peers.length };
  if (top) {
    state.transferName = top.t.name ?? s.items.find((i) => i.id === top.id)?.name ?? '檔案';
    state.transferDirection = top.t.dir;
    state.progress = top.t.total ? Math.min(1, top.t.loaded / top.t.total) : 1;
  }
  return state;
}
