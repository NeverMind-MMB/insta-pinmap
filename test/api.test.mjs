import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minuteWithOffset } from '../web/js/api.js';

test('minuteWithOffset applies the server clock difference', () => {
  const now = Date.UTC(2026, 9, 4, 12, 0, 30);
  assert.equal(minuteWithOffset(now, 0), Math.floor(now / 60000));
  assert.equal(minuteWithOffset(now, -7), Math.floor(now / 60000) - 7);
});

import { adoptDifficulty } from '../web/js/api.js';

test('adoptDifficulty accepts 8..26, clamps, and ignores garbage', () => {
  assert.equal(adoptDifficulty('18', 20), 18);
  assert.equal(adoptDifficulty('30', 18), 26);
  assert.equal(adoptDifficulty('2', 18), 8);
  assert.equal(adoptDifficulty('abc', 18), 18);
  assert.equal(adoptDifficulty(null, 18), 18);
});

import { resolveApplePlaces } from '../web/js/api.js';

/** Answers /api/apple-places like the Worker; `plan` can force a status per call number. */
function stubApplePlaces(plan = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const n = calls.length;
    if (plan[n] === 'throw') throw new TypeError('Failed to fetch');
    if (plan[n] === 429) return new Response(JSON.stringify({ ok: false, reason: 'rate-limit' }), { status: 429 });
    const ids = new URL(String(url), 'https://pinmap.example').searchParams.get('ids').split(',');
    const places = ids.map((id) => (id.endsWith('7')
      ? { id, ok: false }
      : { id, ok: true, name: `Place ${id}`, address: 'Somewhere', lat: 1, lon: 2 }));
    return new Response(JSON.stringify({ ok: true, places }), { headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

const ids23 = Array.from({ length: 23 }, (_, i) => String(1000 + i));

test('resolveApplePlaces: 23 ids go out as 10/10/3, one after the other, with progress', async () => {
  const calls = stubApplePlaces();
  const progress = [];
  const found = await resolveApplePlaces(ids23, (done, total) => progress.push([done, total]));
  assert.deepEqual(calls.map((u) => new URL(u, 'https://x').searchParams.get('ids').split(',').length), [10, 10, 3]);
  assert.ok(calls.every((u) => u.startsWith('/api/apple-places?ids=')));
  assert.deepEqual(new URL(calls[2], 'https://x').searchParams.get('ids').split(','), ids23.slice(20));
  assert.deepEqual(progress.at(-1), [23, 23]);
  assert.deepEqual(progress.map((p) => p[0]), [10, 20, 23]);
  assert.ok(found instanceof Map);
  assert.equal(found.size, 21, 'ids ending in 7 were not found');
  assert.deepEqual(found.get('1000'), { id: '1000', ok: true, name: 'Place 1000', address: 'Somewhere', lat: 1, lon: 2 });
  assert.equal(found.has('1007'), false);
});

test('resolveApplePlaces: on 429 waits for the next minute once, then goes on', async () => {
  const calls = stubApplePlaces({ 2: 429 });
  const waits = [];
  const progress = [];
  const found = await resolveApplePlaces(ids23, (done, total, info) => progress.push([done, total, info?.waitSeconds ?? 0]), {
    sleep: async (ms) => { waits.push(ms); },
  });
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 61000, `waited ${waits[0]} ms`);
  assert.ok(progress.some((p) => p[0] === 10 && p[2] > 0), 'the wait is shown');
  assert.equal(calls.length, 4, 'the refused batch is sent again');
  assert.equal(found.size, 21);
});

test('resolveApplePlaces: a second 429 or a network error leaves the rest unresolved without throwing', async () => {
  stubApplePlaces({ 2: 429, 3: 429 });
  const a = await resolveApplePlaces(ids23, () => {}, { sleep: async () => {} });
  assert.equal(a.size, 9, 'only the first batch');

  const calls = stubApplePlaces({ 2: 'throw' });
  const b = await resolveApplePlaces(ids23, () => {}, { sleep: async () => {} });
  assert.equal(b.size, 9);
  assert.equal(calls.length, 2, 'stops after a network error');

  stubApplePlaces();
  assert.equal((await resolveApplePlaces([], () => {})).size, 0);
});
