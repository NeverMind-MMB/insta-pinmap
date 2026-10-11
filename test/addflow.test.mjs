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

test('Apple Guide link: inline places plus unchecked Apple Maps places go to the import dialog, without any request', async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}'); };
  const { toasts, ui } = fakeUi();
  const imports = [];
  await startAdd(APPLE_UG, { ...ui, showImport: (entries, name, guide) => imports.push({ entries, name, guide }) });
  assert.equal(calls.length, 0, 'the Worker is not asked any more');
  assert.equal(imports.length, 1);
  const { entries, name, guide } = imports[0];
  assert.equal(name, 'Epic Gamering');
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.slice(0, 3).map((e) => e.name), ['Hive Gaming', '404', 'Red Bull Gaming Garden']);
  for (const e of entries.slice(3)) {
    assert.equal(e.name, 'Apple Maps place');
    assert.equal(e.lat, null);
    assert.equal(e.checked, false);
    assert.equal(e.warning, 'Look this place up with the Shortcut or the computer script.');
  }
  assert.equal(entries[3].url, 'https://maps.apple.com/place?auid=4053793356543820372');
  assert.equal(guide.title, 'Epic Gamering');
  assert.equal(guide.entries.length, 3);
  assert.deepEqual(guide.appleIds.slice(0, 1), ['4053793356543820372']);
  assert.equal(guide.appleIds.length, 7);
  assert.equal(guide.link, APPLE_UG, 'the original link goes to the Shortcut');
  assert.deepEqual(toasts, []);
});

/* ---------- The whole guide page pasted into the main input bar ---------- */

const { readFileSync } = await import('node:fs');
const { savePendingGuide, clearPendingGuide, appleIdOf } = await import('../web/js/appleplace.js');
const GUIDE_PAGE = readFileSync(new URL('./fixtures/guide-page.html', import.meta.url), 'utf8');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('guide page in the input bar: every place is a checked row, title without the Apple suffix', async () => {
  globalThis.localStorage = memoryStorage();
  const { toasts, ui } = fakeUi();
  const imports = [];
  let cleared = 0;
  await startAdd(GUIDE_PAGE, { ...ui, inputDone: () => cleared++, showImport: (e, n, g) => imports.push({ e, n, g }) });
  assert.equal(imports.length, 1);
  assert.equal(imports[0].n, 'Epic Gamering');
  assert.equal(imports[0].g, null);
  assert.equal(imports[0].e.length, 10);
  assert.ok(imports[0].e.every((r) => r.checked === true && r.source === 'apple-guide' && Number.isFinite(r.lat)));
  assert.equal(cleared, 1);
  assert.equal(toasts.length, 0);
});

test('guide page with a waiting guide: its Apple ID rows are filled', async () => {
  globalThis.localStorage = memoryStorage();
  const ids = ['4053793356543820372', '14921016072022586346', '9816041141257892933'];
  const inline = [{ name: 'Hive Gaming', address: '', lat: 49.4458656, lon: 11.0497961, url: '', source: 'apple-guide', note: '', warning: '' }];
  savePendingGuide({ title: 'Epic Gamering', link: 'https://guides.apple.com/?ug=x', entries: inline, appleIds: ids });
  const { ui } = fakeUi();
  const imports = [];
  await startAdd(GUIDE_PAGE, { ...ui, showImport: (e, n, g) => imports.push({ e, n, g }) });
  const { e, n, g } = imports[0];
  assert.equal(n, 'Epic Gamering');
  assert.ok(g && g.appleIds.length === 3, 'the pending guide is handed on, so the dialog clears it');
  for (const id of ids) {
    const row = e.find((r) => appleIdOf(r.url) === id);
    assert.ok(row && Number.isFinite(row.lat) && row.checked && row.name !== 'Apple Maps place', id);
  }
  clearPendingGuide();
});

test('guide page without places: error toast, no import dialog', async () => {
  globalThis.localStorage = memoryStorage();
  const { toasts, ui } = fakeUi();
  let opened = 0;
  const page = '<html><body><div class="mw-collection-place-name">' + 'x'.repeat(1200) + '</div></body></html>';
  await startAdd(page, { ...ui, showImport: () => opened++ });
  assert.equal(opened, 0);
  assert.equal(toasts.at(-1)[1], 'error');
  assert.match(toasts.at(-1)[0], /lists no places/);
});
