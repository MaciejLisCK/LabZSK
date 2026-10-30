// Key-value storage in IndexedDB (no 5 MB limit of localStorage); falls back to localStorage when
// IndexedDB is unavailable. Writes are queued in call order and need not be awaited.

const DB_NAME = 'labzsk';
const STORE = 'kv';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function load(key) {
  try {
    const db = await openDb();
    return await done(db.transaction(STORE).objectStore(STORE).get(key));
  } catch {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  }
}

export function save(key, value) {
  let copy;
  try {
    copy = structuredClone(value);
  } catch {
    copy = JSON.parse(JSON.stringify(value));
  }
  openDb().then((db) => db.transaction(STORE, 'readwrite').objectStore(STORE).put(copy, key)).catch(() => {
    try {
      localStorage.setItem(key, JSON.stringify(copy));
    } catch { /* storage unavailable */ }
  });
}

export function remove(key) {
  openDb().then((db) => db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key)).catch(() => {
    try {
      localStorage.removeItem(key);
    } catch { /* storage unavailable */ }
  });
}
