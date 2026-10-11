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

/** A raw Apple Maps place page as the Shortcut's round 2 fetches it (synthetic). */
function placePage(id, name, lat, lon) {
  return `<!DOCTYPE html><html><head><title>${name} in Testtown, Germany - Apple Maps</title>
<meta property="place:location:latitude" content="${lat}">
<meta property="place:location:longitude" content="${lon}">
<meta property="og:title" content="${name}"></head><body><div data-ref="${id}"></div>${'<p>x</p>'.repeat(200)}</body></html>`;
}

test('place pages in the input bar with a waiting guide: import opens with the places found before and now', async () => {
  globalThis.localStorage = memoryStorage();
  const ids = ['101', '202', '303'];
  const inline = [{ name: 'Pin', address: '', lat: 47.1, lon: 11.1, url: '', source: 'apple-guide', note: '', warning: '' }];
  const found = new Map([['101', { name: 'Earlier', lat: 48.1, lon: 11.5, address: 'Testtown' }]]);
  savePendingGuide({ title: 'Synthetic Guide', link: 'https://guides.apple.com/?ug=x', entries: inline, appleIds: ids, found });
  const { toasts, ui } = fakeUi();
  const imports = [];
  let cleared = 0;
  await startAdd(placePage('202', 'Second', 48.2, 11.6) + '\n' + placePage('999', 'Other', 1, 2),
    { ...ui, inputDone: () => cleared++, showImport: (e, n, g) => imports.push({ e, n, g }) });
  assert.equal(imports.length, 1);
  const { e, n, g } = imports[0];
  assert.equal(n, 'Synthetic Guide');
  assert.deepEqual(g.appleIds, ids, 'the pending guide is handed on');
  assert.equal(e.length, 4);
  const row = (id) => e.find((r) => appleIdOf(r.url) === id);
  assert.equal(row('101').name, 'Earlier');
  assert.equal(row('101').lat, 48.1);
  assert.notEqual(row('101').checked, false);
  assert.equal(row('202').name, 'Second');
  assert.equal(row('202').checked, true);
  assert.equal(row('303').lat, null);
  assert.equal(row('303').checked, false);
  assert.equal(cleared, 1);
  assert.deepEqual(toasts, []);
  clearPendingGuide();
});

test('guide page with a waiting guide that has places found before: they stay filled', async () => {
  globalThis.localStorage = memoryStorage();
  const ids = ['4053793356543820372', '777'];
  const found = new Map([['777', { name: 'Earlier', lat: 48.1, lon: 11.5, address: '' }]]);
  savePendingGuide({ title: 'Epic Gamering', link: 'https://guides.apple.com/?ug=x', entries: [], appleIds: ids, found });
  const { ui } = fakeUi();
  const imports = [];
  await startAdd(GUIDE_PAGE, { ...ui, showImport: (e, n, g) => imports.push({ e, n, g }) });
  const { e } = imports[0];
  assert.equal(e.find((r) => appleIdOf(r.url) === '777').name, 'Earlier');
  assert.ok(Number.isFinite(e.find((r) => appleIdOf(r.url) === ids[0]).lat));
  clearPendingGuide();
});

/* ---------- A guide link with the Shortcut's results pasted into the main input bar ---------- */

const { ugLink, pbText, pbIdRef, pbPin } = await import('./ug.mjs');
const SYN_GUIDE = ugLink([pbText(1, 'Synthetic Guide'), pbIdRef(9902, '1001'), pbPin('Pin?', 'Street 1, Town', 47.1, 11.1), pbIdRef(6489, '1002')]);
const SYN_USER = 'https://maps.apple.com/guides?user=' +
  new URL(SYN_GUIDE).searchParams.get('ug').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function pasteIntoBar(text) {
  globalThis.localStorage = memoryStorage();
  const { toasts, ui } = fakeUi();
  const imports = [];
  let cleared = 0;
  await startAdd(text, { ...ui, inputDone: () => cleared++, showImport: (e, n, g) => imports.push({ e, n, g }) });
  return { imports, toasts, cleared };
}

const rowOf = (e, id) => e.find((r) => appleIdOf(r.url) === id);

test('guide link + raw place pages: the import opens for that guide with the places found', async () => {
  const text = [SYN_GUIDE, placePage('1001', 'Museum', 48.1, 11.5), placePage('1002', 'Lake Village', 47.6, 11.3)].join('\n');
  const { imports, cleared } = await pasteIntoBar(text);
  assert.equal(imports.length, 1);
  const { e, n, g } = imports[0];
  assert.equal(n, 'Synthetic Guide');
  assert.deepEqual(g.appleIds, ['1001', '1002']);
  assert.equal(e.length, 3);
  assert.equal(e[0].name, 'Pin');
  assert.equal(rowOf(e, '1001').name, 'Museum');
  assert.equal(rowOf(e, '1001').checked, true);
  assert.equal(rowOf(e, '1002').lat, 47.6);
  assert.equal(cleared, 1);
});

test('guide link (user= form) + @@ lines: same; a place without a line stays unchecked', async () => {
  const text = [SYN_USER, 'https://maps.apple.com/place?auid=1001@@Museum@@48.1@@11.5@@Town'].join('\n');
  const { imports } = await pasteIntoBar(text);
  const { e, g } = imports[0];
  assert.deepEqual(g.appleIds, ['1001', '1002']);
  assert.equal(rowOf(e, '1001').name, 'Museum');
  assert.equal(rowOf(e, '1001').address, 'Town');
  assert.equal(rowOf(e, '1002').lat, null);
  assert.equal(rowOf(e, '1002').checked, false);
});

test('only @@ lines: the import opens with those places as checked rows', async () => {
  const text = [
    'https://maps.apple.com/place?auid=1001@@Museum@@48.1@@11.5@@Town',
    '1002@@Lake Village@@47.6@@11.3@@Bavaria',
  ].join('\n');
  const { imports, cleared } = await pasteIntoBar(text);
  assert.equal(imports.length, 1);
  const { e, g } = imports[0];
  assert.equal(g, null);
  assert.deepEqual(e.map((r) => [r.name, r.lat, r.lon, r.address, r.checked]),
    [['Museum', 48.1, 11.5, 'Town', true], ['Lake Village', 47.6, 11.3, 'Bavaria', true]]);
  assert.equal(cleared, 1);
});

test('a guide link alone (user= form) still just opens the import with unchecked Apple rows', async () => {
  const { imports } = await pasteIntoBar(SYN_USER);
  const { e, n, g } = imports[0];
  assert.equal(n, 'Synthetic Guide');
  assert.deepEqual(g.appleIds, ['1001', '1002']);
  assert.ok(e.slice(1).every((r) => r.lat === null && r.checked === false));
});

test('isShortcutPaste: Shortcut output goes straight to the add flow (a text field would drop its line breaks)', async () => {
  const { isShortcutPaste } = await import('../web/js/addflow.js');
  assert.equal(isShortcutPaste(`${SYN_GUIDE}\n1001@@Museum@@48.1@@11.5@@Town`), true);
  assert.equal(isShortcutPaste(`${SYN_USER}\n${placePage('1001', 'Museum', 48.1, 11.5)}`), true);
  assert.equal(isShortcutPaste('1001@@Museum@@48.1@@11.5@@Town'), true);
  assert.equal(isShortcutPaste(GUIDE_PAGE), true);
  for (const t of [SYN_GUIDE, 'https://www.instagram.com/p/ABC123/', 'Check this out:\nhttps://www.instagram.com/p/ABC123/', 'Cafe Luitpold', 'a@@b']) {
    assert.equal(isShortcutPaste(t), false, t.slice(0, 40));
  }
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
