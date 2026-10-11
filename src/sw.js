/// Service Worker：預快取 App 殼層 + 接收系統分享選單（Web Share Target）傳來的檔案與文字
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// 不呼叫 skipWaiting：新版在所有分頁關閉後才生效，避免 Host 頁面被換版而中斷空間

const SHARE_CACHE = 'share-target';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(event.request));
  }
});

/** 把分享內容暫存到 Cache Storage，再導回 App（?share=1），由頁面讀出後送進空間 */
async function receiveShare(request) {
  const back = (q) => Response.redirect(new URL(`./?${q}`, self.registration.scope).href, 303);
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f instanceof File && (f.size > 0 || f.name));
    const parts = ['title', 'text', 'url'].map((k) => form.get(k)).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
    // 很多 App 會把網址同時放在 text 與 url，去掉重複的部分
    const text = parts.filter((p, i) => !parts.some((q, j) => j !== i && q.includes(p) && q !== p) && parts.indexOf(p) === i).join('\n');

    const cache = await caches.open(SHARE_CACHE);
    await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
    await Promise.all(files.map((f, i) => cache.put(`/__share/file-${i}`, new Response(f))));
    await cache.put('/__share/meta', new Response(JSON.stringify({ text, files: files.map((f) => ({ name: f.name, type: f.type })) })));
    return back('share=1');
  } catch (err) {
    console.error('分享失敗', err);
    return back('share=error');
  }
}
