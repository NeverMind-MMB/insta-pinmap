import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * A minimal in-memory IndexedDB: enough for idb.js. `closeAll()` simulates the
 * browser dropping the connection (as iOS does after backgrounding): the old
 * connection's transaction() then throws InvalidStateError.
 */
function fakeIndexedDB() {
  const data = new Map();
  const connections = [];
  let opens = 0;
  const factory = {
    open() {
      opens++;
      const req = {};
      const db = {
        closed: false,
        close() { this.closed = true; },
        transaction() {
          if (this.closed) throw Object.assign(new Error('The database connection is closing.'), { name: 'InvalidStateError' });
          const tx = {};
          tx.objectStore = () => ({
            get(key) {
              const r = { result: data.get(key) };
              setTimeout(() => tx.oncomplete?.());
              return r;
            },
            put(value, key) {
              data.set(key, structuredClone(value));
              const r = { result: key };
              setTimeout(() => tx.oncomplete?.());
              return r;
            },
          });
          return tx;
        },
      };
      connections.push(db);
      setTimeout(() => { req.result = db; req.onsuccess?.(); });
      return req;
    },
  };
  return {
    factory,
    get opens() { return opens; },
    /** Closed by the browser: no close() call from the page, onclose may or may not fire. */
    dropSilently() { for (const c of connections) c.closed = true; },
    dropWithEvent() { for (const c of connections) { c.closed = true; c.onclose?.(); } },
    versionChange() { for (const c of connections) c.onversionchange?.(); },
  };
}

const fake = fakeIndexedDB();
globalThis.indexedDB = fake.factory;
const { idbGet, idbSet } = await import('../web/js/idb.js');

test('idb: saves keep working after the browser drops the connection', async () => {
  await idbSet('a', { n: 1 });
  assert.deepEqual(await idbGet('a'), { n: 1 });
  assert.equal(fake.opens, 1, 'the connection is reused');

  // Dropped without an event: transaction() throws, idb.js reopens once.
  fake.dropSilently();
  await idbSet('a', { n: 2 });
  assert.deepEqual(await idbGet('a'), { n: 2 });
  assert.equal(fake.opens, 2);

  // Dropped with a close event: the next call opens a new connection straight away.
  fake.dropWithEvent();
  await idbSet('b', 'x');
  assert.equal(await idbGet('b'), 'x');
  assert.equal(fake.opens, 3);

  // Another tab upgrades the database: we close and reopen next time.
  fake.versionChange();
  assert.deepEqual(await idbGet('a'), { n: 2 });
  assert.equal(fake.opens, 4);
});
