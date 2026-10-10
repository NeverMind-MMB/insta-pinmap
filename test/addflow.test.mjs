import { test } from 'node:test';
import assert from 'node:assert/strict';

const { startAdd } = await import('../web/js/addflow.js');

/** Replaces fetch for /api/resolve; returns the list of resolve calls. */
function stubResolve(answer) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(answer(calls.length)), { headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

function fakeUi() {
  const toasts = [];
  return { toasts, ui: { toast: (text, kind) => toasts.push([text, kind]), hideToast: () => {} } };
}

test('short link that leads nowhere: one request and a message, no loop', async () => {
  const link = 'https://maps.app.goo.gl/deadLink123';
  for (const answer of [
    () => ({ ok: false, message: "This short link doesn't lead anywhere." }),
    () => ({ ok: true, url: link }), // an old Worker answering with the same address
  ]) {
    const calls = stubResolve(answer);
    const { toasts, ui } = fakeUi();
    await startAdd(link, ui);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^\/api\/resolve\?url=/);
    assert.equal(toasts.at(-1)[1], 'error');
    assert.match(toasts.at(-1)[0], /short link/);
  }
});

const APPLE_UG = 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5nElcaM0hvbHpzY2h1aGVyc3RyYcOfZSAzNiwgOTA0MzkgTsO8cm5iZXJnLCBEZXV0c2NobGFuZCISCak0vB8SuUhAEcvv2d9%2BGSZAKgxIaXZlIEdhbWluZz8SDQiuTRDUhIiNx%2FL9oDgSURo1R3Jvw59lbmhhaW5lciBTdHJhw59lIDE4OCwgMDExMjkgRHJlc2RlbiwgRGV1dHNjaGxhbmQiEgna1vjlEYxJQBErmInXrHArQCoENDA0PxJrGjxPbHltcGlhcGFyaywgVG9uaS1NZXJrZW5zLVdlZyA0LCA4MDgwOSBNw7xuY2hlbiwgRGV1dHNjaGxhbmQiEgmZbbTiuhVIQBHGXDAhvhQnQCoXUmVkIEJ1bGwgR2FtaW5nIEdhcmRlbj8SDgiuTRDq57OmgKKGic8BEg4Irk0Qxeiv6pCt5ZyIARINCK5NEMrCuI7%2Bh6LKORINCK5NEI%2BtreyGx%2Fe1TxINCK5NEIrU7sq7pqLZMBIOCK5NEML2otPY%2BsCgzgE%3D';

test('Apple Guide link: inline places plus looked-up Apple Maps places go to the import dialog', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const ids = new URL(String(url), 'https://x').searchParams.get('ids').split(',');
    const places = ids.map((id, i) => (i === ids.length - 1
      ? { id, ok: false }
      : { id, ok: true, name: `Place ${i}`, address: 'Germany', lat: 50 + i, lon: 10 }));
    return new Response(JSON.stringify({ ok: true, places }), { headers: { 'content-type': 'application/json' } });
  };
  const { toasts, ui } = fakeUi();
  const imports = [];
  await startAdd(APPLE_UG, { ...ui, showImport: (entries, name) => imports.push({ entries, name }) });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/apple-places\?ids=4053793356543820372,/);
  assert.equal(imports.length, 1);
  const { entries, name } = imports[0];
  assert.equal(name, 'Epic Gamering');
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.slice(0, 3).map((e) => e.name), ['Hive Gaming', '404', 'Red Bull Gaming Garden']);
  assert.equal(entries[3].name, 'Place 0');
  assert.equal(entries[3].url, 'https://maps.apple.com/place?auid=4053793356543820372');
  assert.equal(entries[9].lat, null);
  assert.equal(entries[9].checked, false);
  assert.ok(toasts.some(([t]) => /^Looking up 7 Apple Maps places … \(\d\/7\)$/.test(t)), JSON.stringify(toasts));
});
