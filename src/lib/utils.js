import { PUBLIC_URL, isNativeApp } from '../native/platform';

export const ROOM_PREFIX = 'p2pspace-';

export const peerIdFromCode = (code) => ROOM_PREFIX + code;
export const codeFromPeerId = (id = '') => (id.startsWith(ROOM_PREFIX) ? id.slice(ROOM_PREFIX.length) : id);

/** 6 位數代碼（允許前導 0）。getRandomValues 在非安全來源（區網 http）也可用。 */
export function randomCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

/** 接受 6 位數代碼、完整 Host Peer ID，或含 ?room= 的配對連結；無效時回傳 null。 */
export function normalizeRoom(input) {
  const v = String(input ?? '').trim();
  if (!v) return null;
  if (/^\d{6}$/.test(v)) return peerIdFromCode(v);
  if (/^https?:\/\//i.test(v)) {
    try {
      return normalizeRoom(new URL(v).searchParams.get('room'));
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(v) ? v : null;
}

export function roomLink(peerId) {
  const url = new URL(isNativeApp() ? PUBLIC_URL : `${location.origin}${location.pathname}`);
  url.searchParams.set('room', peerId);
  return url.href;
}

/** crypto.randomUUID 只在安全來源可用，區網 http 測試時需要後備方案。 */
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export const safeId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : uid());

export function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android.*Mobile|Mobile/.test(ua)) return 'phone';
  return 'desktop';
}

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPod/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '裝置';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox|FxiOS/.test(ua)
        ? 'Firefox'
        : /CriOS|Chrome/.test(ua)
          ? 'Chrome'
          : /Safari/.test(ua)
            ? 'Safari'
            : '';
  return browser ? `${os} · ${browser}` : os;
}

const NAME_KEY = 'p2p-device-name';
export const MAX_NAME = 24;

let identity;
/**
 * 裝置 ID 存 sessionStorage（每個分頁各自獨立，重新整理後仍能辨識「我」發出的內容）；
 * 自訂名稱存 localStorage（同一台裝置下次開啟仍保留）。
 */
export function getIdentity() {
  if (identity) return identity;
  let id;
  let name;
  try {
    id = sessionStorage.getItem('p2p-device-id');
    if (!id) sessionStorage.setItem('p2p-device-id', (id = uid()));
  } catch {
    id = uid();
  }
  try {
    name = localStorage.getItem(NAME_KEY);
  } catch {
    /* 無法存取 storage 時使用預設名稱 */
  }
  identity = { id, name: name || deviceName(), kind: deviceKind() };
  return identity;
}

/** 更新自訂名稱；傳入空字串則恢復預設名稱。回傳新的 identity。 */
export function setDeviceName(raw) {
  const name = String(raw ?? '').trim().slice(0, MAX_NAME);
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* 僅本次有效 */
  }
  identity = { ...getIdentity(), name: name || deviceName() };
  return identity;
}

export function formatBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} ${time}`;
}

export function fileKind(mime = '', name = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (/\.(zip|rar|7z|tar|gz|bz2|xz)$/i.test(name)) return 'archive';
  if (mime.startsWith('text/') || /pdf|json|xml|document|sheet|presentation/.test(mime)) return 'doc';
  return 'other';
}

/** 瀏覽器可直接預覽、值得放在記憶體裡產生 object URL 的檔案 */
export const isPreviewable = (item) =>
  ['image', 'video', 'audio'].includes(fileKind(item.mime, item.name)) && item.size <= 200 * 1024 * 1024;

/** navigator.clipboard 只在安全來源可用；區網 http 時改用 execCommand。 */
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 落到後備方案 */
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const isEditable = (el) =>
  !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'file'].includes(el.type)));
