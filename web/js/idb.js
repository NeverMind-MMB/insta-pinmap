/**
 * idb.js — a tiny key-value wrapper around IndexedDB.
 * One database "insta-pinmap", one object store "kv".
 */

const DB_NAME = 'insta-pinmap';
const STORE_NAME = 'kv';
let opening = null;

function open() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser has no storage for apps (IndexedDB).'));
  }
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { opening = null; reject(req.error || new Error('Storage could not be opened.')); };
  });
  return opening;
}

function run(mode, action) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = action(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error || new Error('Storage error.'));
    tx.onabort = () => reject(tx.error || new Error('Storage write was aborted (full?).'));
  }));
}

export function idbGet(key) {
  return run('readonly', (s) => s.get(key));
}

export function idbSet(key, value) {
  return run('readwrite', (s) => s.put(value, key)).then(() => undefined);
}
