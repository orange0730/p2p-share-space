/**
 * 讀出 Service Worker 暫存的分享內容（從系統分享選單開啟時網址帶 ?share=1）。
 * 讀完即刪除並移除網址參數，回傳 { files: File[], text: string } 或 null。
 */
export async function takeSharedPayload() {
  const params = new URLSearchParams(location.search);
  const flag = params.get('share');
  if (!flag) return null;
  params.delete('share');
  const url = new URL(location.href);
  url.search = params.toString();
  history.replaceState(null, '', url);

  if (flag !== '1' || !('caches' in window)) return { files: [], text: '', error: true };
  const cache = await caches.open('share-target');
  const meta = await cache.match('/__share/meta');
  if (!meta) return null;
  const { text = '', files: list = [] } = await meta.json();
  const files = [];
  for (let i = 0; i < list.length; i++) {
    const res = await cache.match(`/__share/file-${i}`);
    if (!res) continue;
    const blob = await res.blob();
    files.push(new File([blob], list[i].name || `分享的檔案-${i + 1}`, { type: list[i].type || blob.type }));
  }
  await caches.delete('share-target');
  return { files, text };
}
