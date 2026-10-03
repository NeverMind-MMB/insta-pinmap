import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDb, mergeDb, store } from '../web/js/store.js';

const pin = (id, updatedAt, extra = {}) => ({
  id, lat: 49.45, lon: 11.07, title: id, address: '', note: '', status: 'wishlist', tags: [],
  source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', updatedAt, posts: [], keptApartFrom: [], ...extra,
});

test('normalizeDb maps legacy German fields', () => {
  const db = normalizeDb({ stand: 123, pins: [{ ...pin('a', '2026-01-02T00:00:00.000Z'), source: undefined,
    quelle: 'instagram', keptApartFrom: undefined, getrenntVon: ['b'] }] });
  assert.equal(db.changedAt, 123);
  assert.equal(db.pins[0].source, 'instagram');
  assert.deepEqual(db.pins[0].keptApartFrom, ['b']);
  assert.deepEqual(db.deleted, []);
  assert.equal('stand' in db, false);
});

test('mergeDb: deleted pin stays deleted', () => {
  const local = normalizeDb({ pins: [], deleted: [{ id: 'a', deletedAt: '2026-02-01T00:00:00.000Z' }] });
  const incoming = normalizeDb({ pins: [pin('a', '2026-01-15T00:00:00.000Z')] });
  const r = mergeDb(local, incoming);
  assert.equal(r.db.pins.length, 0);
  assert.equal(r.skipped, 1);
});

test('mergeDb: pin edited after deletion comes back and the entry is dropped', () => {
  const local = normalizeDb({ pins: [], deleted: [{ id: 'a', deletedAt: '2026-02-01T00:00:00.000Z' }] });
  const incoming = normalizeDb({ pins: [pin('a', '2026-03-01T00:00:00.000Z')] });
  const r = mergeDb(local, incoming);
  assert.deepEqual(r.db.pins.map((p) => p.id), ['a']);
  assert.deepEqual(r.db.deleted, []);
  assert.equal(r.added, 1);
});

test('mergeDb: newer version wins, older is skipped', () => {
  const local = normalizeDb({ pins: [pin('a', '2026-02-01T00:00:00.000Z', { title: 'old' }), pin('b', '2026-05-01T00:00:00.000Z', { title: 'mine' })] });
  const incoming = normalizeDb({ pins: [pin('a', '2026-03-01T00:00:00.000Z', { title: 'new' }), pin('b', '2026-04-01T00:00:00.000Z', { title: 'theirs' })] });
  const r = mergeDb(local, incoming);
  const byId = Object.fromEntries(r.db.pins.map((p) => [p.id, p.title]));
  assert.deepEqual(byId, { a: 'new', b: 'mine' });
  assert.equal(r.updated, 1);
  assert.equal(r.skipped, 1);
});

test('mergeDb: incoming deletion removes an unchanged local pin', () => {
  const local = normalizeDb({ pins: [pin('a', '2026-01-01T00:00:00.000Z')] });
  const incoming = normalizeDb({ pins: [], deleted: [{ id: 'a', deletedAt: '2026-02-01T00:00:00.000Z' }] });
  const r = mergeDb(local, incoming);
  assert.equal(r.db.pins.length, 0);
  assert.deepEqual(r.db.deleted.map((d) => d.id), ['a']);
});

test('mergeDb: new pin whose post is already saved elsewhere is skipped', () => {
  const post = { url: 'https://www.instagram.com/p/AAA111/', shortcode: 'AAA111' };
  const local = normalizeDb({ pins: [pin('a', '2026-01-01T00:00:00.000Z', { posts: [post] })] });
  const incoming = normalizeDb({ pins: [pin('z', '2026-01-02T00:00:00.000Z', { posts: [post] })] });
  const r = mergeDb(local, incoming);
  assert.deepEqual(r.db.pins.map((p) => p.id), ['a']);
  assert.equal(r.skipped, 1);
});

test('mergeDb: tags are united, local colour kept', () => {
  const local = normalizeDb({ pins: [], tags: [{ name: 'coffee', color: '#111111' }] });
  const incoming = normalizeDb({ pins: [], tags: [{ name: 'coffee', color: '#222222' }, { name: 'beach', color: '#333333' }] });
  const r = mergeDb(local, incoming);
  assert.deepEqual(r.db.tags, [{ name: 'coffee', color: '#111111' }, { name: 'beach', color: '#333333' }]);
});

test('store.load without IndexedDB opens empty and records the error', async () => {
  await store.load();
  assert.equal(store.db.pins.length, 0);
  assert.match(store.lastError, /storage/i);
});

test('save after a failed load does not write and reports the error', async () => {
  await store.load();
  let reported = null;
  store.onSaveError = (m) => { reported = m; };
  const r = await store.save();
  assert.equal(r.ok, false);
  assert.ok(reported);
  store.onSaveError = () => {};
});

test('normalizeDb skips non-object pins and posts instead of throwing', () => {
  assert.deepEqual(normalizeDb({ pins: [null] }).pins, []);
  const db = normalizeDb({ pins: [pin('a', '2026-01-01T00:00:00.000Z', { posts: [null, 'x'] })] });
  assert.deepEqual(db.pins[0].posts, []);
});

test('removePost changes updatedAt and rebuilds postIndex', () => {
  const post = { url: 'https://www.instagram.com/p/AAA111/', shortcode: 'AAA111' };
  store.db = normalizeDb({ pins: [pin('a', '2026-01-01T00:00:00.000Z', { posts: [post] })] });
  assert.ok(store.db.postIndex.AAA111);
  store.removePost('a', post.url);
  assert.deepEqual(store.pin('a').posts, []);
  assert.notEqual(store.pin('a').updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(store.db.postIndex.AAA111, undefined);
  clearTimeout(store._saveTimer);
  store._saveTimer = null;
});

test('normalizeDb drops hostile tag colours and non-http post links', () => {
  const db = normalizeDb({
    tags: [{ name: 'a', color: '"><img src=x onerror=alert(1)>' }, { name: 'b', color: '#b8543f' }],
    pins: [pin('p', '2026-01-02T00:00:00.000Z', { posts: [{ url: 'javascript:alert(1)' }, { url: 'https://www.instagram.com/p/AAA111/' }] })],
  });
  assert.equal(db.tags.find((t) => t.name === 'a').color, '');
  assert.equal(db.tags.find((t) => t.name === 'b').color, '#b8543f');
  assert.deepEqual(db.pins[0].posts.map((x) => x.url), ['https://www.instagram.com/p/AAA111/']);
});
