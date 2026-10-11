/**
 * DataChannel 訊息協定（PeerJS `serialization: 'raw'`，自行控制分塊與背壓）
 *
 *   string       → JSON 控制訊息 { t: <type>, ... }
 *   ArrayBuffer  → 檔案分塊：[u32 headerLen][header JSON { id, i }][payload bytes]
 *
 * Client → Host
 *   text          { id, text }
 *   file-meta     { id, name, size, mime }   之後緊接著該檔案的所有分塊（分塊 header.id = 項目 id）
 *   upload-cancel { id }                     放棄上傳中的檔案
 *   file-request  { id, rid }                請 Host 傳送檔案內容（分塊 header.id = rid，每次請求都不同，
 *                                            取消後重新下載不會混到前一次殘留的分塊）
 *   download-cancel { rid }
 *   delete        { id }
 *   clear         {}                         清除全部內容
 *   rename        { name }                   變更裝置名稱
 *
 * Host → Client
 *   welcome       { host, items }            連線後同步完整歷史（文字 + 檔案清單）
 *   peers         { peers }
 *   item-added    { item }
 *   item-removed  { id }
 *   cleared       {}
 *   file-missing  { id, rid }
 *   host-leaving  {}                         Host 分頁正在卸載（可能只是重新整理），Client 應自動重連
 *   room-closed   {}                         Host 主動解散空間
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 對端未回報 maxMessageSize 時的保守分塊大小（所有瀏覽器都能接受） */
const SAFE_CHUNK = 16 * 1024;
const MAX_CHUNK = 64 * 1024;
/** bufferedAmount 超過高水位就暫停送出，降到低水位再繼續 —— 避免 DataChannel 緩衝區爆掉 */
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;
/** 一次從磁碟讀入的區塊，再切成多個網路分塊 */
const READ_BLOCK = 2 * 1024 * 1024;

export const PEER_OPTIONS = (() => {
  const env = import.meta.env;
  const opts = { debug: 1 };
  if (env.VITE_PEER_HOST) {
    Object.assign(opts, {
      host: env.VITE_PEER_HOST,
      port: Number(env.VITE_PEER_PORT || 443),
      path: env.VITE_PEER_PATH || '/',
      secure: env.VITE_PEER_SECURE !== 'false',
    });
  }
  return opts;
})();

export function sendJSON(conn, msg) {
  if (conn?.open) conn.send(JSON.stringify(msg));
}

export function parseMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.t === 'string' ? msg : null;
  } catch {
    return null;
  }
}

export function encodeChunk(id, i, payload) {
  const header = encoder.encode(JSON.stringify({ id, i }));
  const out = new Uint8Array(4 + header.length + payload.byteLength);
  new DataView(out.buffer).setUint32(0, header.length);
  out.set(header, 4);
  out.set(payload, 4 + header.length);
  return out.buffer;
}

export function decodeChunk(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || bytes.length < 4) return null;
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (4 + len > bytes.length) return null;
  try {
    const { id, i } = JSON.parse(decoder.decode(bytes.subarray(4, 4 + len)));
    return { id, i, data: bytes.subarray(4 + len) };
  } catch {
    return null;
  }
}

function chunkSizeFor(conn) {
  const max = conn.peerConnection?.sctp?.maxMessageSize;
  if (max === Infinity) return MAX_CHUNK;
  if (!max) return SAFE_CHUNK;
  return Math.max(4096, Math.min(MAX_CHUNK, max - 1024));
}

function waitForDrain(dc) {
  return new Promise((resolve) => {
    const done = () => {
      dc.removeEventListener('bufferedamountlow', done);
      dc.removeEventListener('close', done);
      clearInterval(poll);
      resolve();
    };
    dc.bufferedAmountLowThreshold = LOW_WATER;
    dc.addEventListener('bufferedamountlow', done);
    dc.addEventListener('close', done);
    // 部分瀏覽器的 bufferedamountlow 事件不可靠，加上輪詢保底
    const poll = setInterval(() => {
      if (dc.readyState !== 'open' || dc.bufferedAmount <= LOW_WATER) done();
    }, 100);
  });
}

const aborted = () => new DOMException('已取消', 'AbortError');

/** 以分塊 + 背壓方式送出整個 Blob；連線中斷或 signal 被取消時拋出錯誤。 */
export async function sendBlob(conn, id, blob, onProgress, signal) {
  const chunkSize = chunkSizeFor(conn);
  let index = 0;
  let sent = 0;
  for (let offset = 0; offset < blob.size; offset += READ_BLOCK) {
    const block = new Uint8Array(await blob.slice(offset, offset + READ_BLOCK).arrayBuffer());
    for (let p = 0; p < block.length; p += chunkSize) {
      const dc = conn.dataChannel;
      if (signal?.aborted) throw aborted();
      if (!conn.open || !dc || dc.readyState !== 'open') throw new Error('連線已中斷');
      if (dc.bufferedAmount > HIGH_WATER) {
        await waitForDrain(dc);
        if (signal?.aborted) throw aborted();
        if (dc.readyState !== 'open') throw new Error('連線已中斷');
      }
      const payload = block.subarray(p, p + chunkSize);
      conn.send(encodeChunk(id, index++, payload));
      sent += payload.length;
      onProgress?.(sent, blob.size);
    }
  }
}

export function describePeerError(err) {
  switch (err?.type) {
    case 'peer-unavailable':
      return '找不到這個空間。請確認代碼正確，且主控裝置仍開著頁面。';
    case 'unavailable-id':
      return '房間代碼衝突，請再試一次。';
    case 'browser-incompatible':
      return '此瀏覽器不支援 WebRTC，請改用新版 Chrome、Safari、Edge 或 Firefox。';
    case 'network':
    case 'socket-error':
    case 'socket-closed':
    case 'server-error':
      return '無法連上信令伺服器，請檢查網路連線。';
    case 'webrtc':
      return 'WebRTC 連線失敗，可能是網路環境（防火牆 / 對稱式 NAT）阻擋了點對點連線。';
    default:
      return `連線發生錯誤：${err?.message || err?.type || '未知錯誤'}`;
  }
}
