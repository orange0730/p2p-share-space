/**
 * Host 端暫存：每個空間一個獨立的 IndexedDB（items 存中繼資料、blobs 存檔案內容），
 * 讓 Host 重新整理後能找回資料，同一瀏覽器開多個 Host 分頁也不會互相覆蓋。
 * IndexedDB 無法使用或寫入失敗（無痕模式、配額不足）時，自動退回記憶體 Map。
 */
const DB_PREFIX = 'p2p-room-';
const ALIVE_PREFIX = 'p2p-alive:';
const ITEMS = 'items';
const BLOBS = 'blobs';
/** 超過這麼久沒有心跳的空間視為已關閉，資料可以清掉（背景分頁的計時器最慢每分鐘跑一次） */
const STALE_AFTER = 5 * 60 * 1000;

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

export class RoomStore {
  constructor(key) {
    this.key = key;
    this.name = DB_PREFIX + key;
    this.memory = { items: new Map(), blobs: new Map() };
  }

  open() {
    this.dbPromise ??= new Promise((resolve) => {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(this.name, 1);
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
    return this.dbPromise;
  }

  async putItem(item, blob) {
    const db = await this.open();
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
    this.memory.items.set(item.id, item);
    if (blob) this.memory.blobs.set(item.id, blob);
  }

  /** 依建立時間排序的所有項目（恢復空間用） */
  async getItems() {
    const db = await this.open();
    let items = [];
    if (db) {
      items = await tx(db, [ITEMS], 'readonly', (t, set) => {
        const req = t.objectStore(ITEMS).getAll();
        req.onsuccess = () => set(req.result);
      }).catch(() => []);
    }
    return [...items, ...this.memory.items.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async getBlob(id) {
    if (this.memory.blobs.has(id)) return this.memory.blobs.get(id);
    const db = await this.open();
    if (!db) return null;
    return tx(db, [BLOBS], 'readonly', (t, set) => {
      const req = t.objectStore(BLOBS).get(id);
      req.onsuccess = () => set(req.result ?? null);
    }).catch(() => null);
  }

  async deleteItem(id) {
    this.memory.items.delete(id);
    this.memory.blobs.delete(id);
    const db = await this.open();
    if (!db) return;
    await tx(db, [ITEMS, BLOBS], 'readwrite', (t) => {
      t.objectStore(ITEMS).delete(id);
      t.objectStore(BLOBS).delete(id);
    }).catch(() => {});
  }

  async clear() {
    this.memory.items.clear();
    this.memory.blobs.clear();
    const db = await this.open();
    if (!db) return;
    await tx(db, [ITEMS, BLOBS], 'readwrite', (t) => {
      t.objectStore(ITEMS).clear();
      t.objectStore(BLOBS).clear();
    }).catch(() => {});
  }

  /** 解散空間：整個資料庫刪除 */
  async drop() {
    this.memory.items.clear();
    this.memory.blobs.clear();
    const db = await this.open();
    db?.close();
    indexedDB.deleteDatabase(this.name);
    forgetHeartbeat(this.key);
  }
}

export function heartbeat(key) {
  try {
    localStorage.setItem(ALIVE_PREFIX + key, String(Date.now()));
  } catch {
    /* 忽略 */
  }
}

function forgetHeartbeat(key) {
  try {
    localStorage.removeItem(ALIVE_PREFIX + key);
  } catch {
    /* 忽略 */
  }
}

/** 刪除已關閉分頁遺留的空間資料（分頁直接關掉時來不及清理） */
export async function cleanupStaleRooms(keepKey) {
  if (!indexedDB.databases) return;
  indexedDB.deleteDatabase('p2p-share-space'); // 舊版（所有空間共用一個資料庫）
  const dbs = await indexedDB.databases().catch(() => []);
  for (const { name } of dbs) {
    if (!name?.startsWith(DB_PREFIX)) continue;
    const key = name.slice(DB_PREFIX.length);
    if (key === keepKey) continue;
    let last = 0;
    try {
      last = Number(localStorage.getItem(ALIVE_PREFIX + key)) || 0;
    } catch {
      /* 讀不到就視為過期 */
    }
    if (Date.now() - last > STALE_AFTER) {
      indexedDB.deleteDatabase(name);
      forgetHeartbeat(key);
    }
  }
}
