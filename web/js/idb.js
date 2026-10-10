/**
 * idb.js — a tiny key-value wrapper around IndexedDB.
 * One database "insta-pinmap", one object store "kv".
 *
 * The open connection is reused, but browsers can close it (iOS does after the
 * app was in the background). Then the next call opens a new one, so saving
 * keeps working without a reload.
 */

const DB_NAME = 'insta-pinmap';
const STORE_NAME = 'kv';
let opening = null;

function open() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('This browser has no storage for apps (IndexedDB).'));
  }
  if (opening) return opening;
  const mine = new Promise((resolve, reject) => {
    // Only reset `opening` while it still is this connection's promise, not a newer one.
    const reset = () => { if (opening === mine) opening = null; };
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = reset;
      db.onversionchange = () => { db.close(); reset(); };
      resolve(db);
    };
    req.onerror = () => { reset(); reject(req.error || new Error('Storage could not be opened.')); };
  });
  opening = mine;
  return mine;
}

function run(mode, action, retried = false) {
  return open().then((db) => {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, mode);
    } catch (e) {
      // The connection was closed under us (InvalidStateError, UnknownError): open a new one once.
      opening = null;
      if (retried) throw e;
      return run(mode, action, true);
    }
    return new Promise((resolve, reject) => {
      const req = action(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || new Error('Storage error.'));
      tx.onabort = () => reject(tx.error || new Error('Storage write was aborted (full?).'));
    });
  });
}

export function idbGet(key) {
  return run('readonly', (s) => s.get(key));
}

export function idbSet(key, value) {
  return run('readwrite', (s) => s.put(value, key)).then(() => undefined);
}
