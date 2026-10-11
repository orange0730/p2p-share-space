/**
 * Host 端暫存：IndexedDB 為主（items 存中繼資料、blobs 存檔案內容）。
 * IndexedDB 無法使用或寫入失敗（無痕模式、配額不足）時，自動退回記憶體 Map。
 */
const DB_NAME = 'p2p-share-space';
const ITEMS = 'items';
const BLOBS = 'blobs';

const memory = { items: new Map(), blobs: new Map() };
let dbPromise;

function openDB() {
  dbPromise ??= new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ITEMS, { keyPath: 'id' });
      req.result.createObjectStore(BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn('IndexedDB 無法使用，改用記憶體暫存', req.error);
      resolve(null);
    };
  });
  return dbPromise;
}

function tx(db, stores, mode, body) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    body(t, (r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putItem(item, blob) {
  const db = await openDB();
  if (db) {
    try {
      await tx(db, [ITEMS, BLOBS], 'readwrite', (t) => {
        t.objectStore(ITEMS).put(item);
        if (blob) t.objectStore(BLOBS).put(blob, item.id);
      });
      return;
    } catch (err) {
      console.warn('寫入 IndexedDB 失敗，改存記憶體', err);
    }
  }
  memory.items.set(item.id, item);
  if (blob) memory.blobs.set(item.id, blob);
}

export async function getBlob(id) {
  if (memory.blobs.has(id)) return memory.blobs.get(id);
  const db = await openDB();
  if (!db) return null;
  try {
    return await tx(db, [BLOBS], 'readonly', (t, set) => {
      const req = t.objectStore(BLOBS).get(id);
      req.onsuccess = () => set(req.result ?? null);
    });
  } catch {
    return null;
  }
}

export async function deleteItem(id) {
  memory.items.delete(id);
  memory.blobs.delete(id);
  const db = await openDB();
  if (!db) return;
  await tx(db, [ITEMS, BLOBS], 'readwrite', (t) => {
    t.objectStore(ITEMS).delete(id);
    t.objectStore(BLOBS).delete(id);
  }).catch(() => {});
}

export async function clearAll() {
  memory.items.clear();
  memory.blobs.clear();
  const db = await openDB();
  if (!db) return;
  await tx(db, [ITEMS, BLOBS], 'readwrite', (t) => {
    t.objectStore(ITEMS).clear();
    t.objectStore(BLOBS).clear();
  }).catch(() => {});
}
