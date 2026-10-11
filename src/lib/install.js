import { isNativeApp } from '../native/platform';

/**
 * PWA 安裝狀態。beforeinstallprompt 可能在 React 掛載前就觸發，所以在模組載入時就開始監聽。
 * mode: 'installed' | 'prompt'（Chromium 可一鍵安裝）| 'ios'（需手動「加入主畫面」）| 'none'
 */

const listeners = new Set();
let deferred = null;

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function compute() {
  if (isStandalone() || isNativeApp()) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'none';
}

let mode = compute();
const update = () => {
  mode = compute();
  listeners.forEach((fn) => fn());
};

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  update();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  update();
});

export const subscribeInstall = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getInstallMode = () => mode;

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  update();
  return outcome === 'accepted';
}
