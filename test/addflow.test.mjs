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

/* ---------- Several map place links in one paste (2.0.10) ---------- */

const LL_LINK = 'https://maps.apple.com/?ll=48.1371,11.5754&q=Synthetic%20Cafe';
const ADDRESS_AUID_LINK = 'https://maps.apple.com/?address=Teststrasse%201,%2080331%20Testtown,%20Germany&auid=1234567890123&ll=48.2,11.6&lsp=9902&q=Synthetic%20Museum&t=m';
const AUID_LINK = 'https://maps.apple.com/place?auid=987654321';
const PLACE_ID_LINK = 'https://maps.apple.com/place?address=Testweg%202&coordinate=47.5,11.1&name=Synthetic%20Lake&place-id=I1A2B3C4D5E6F';
// 987654321 is 0x3ADE68B1: Apple's place-id is "I" + the ID in hexadecimal.
const PLACE_ID_ONLY_LINK = 'https://maps.apple.com/place?place-id=I3ADE68B1&_provider=9902';

const SEVERAL_LINKS_HINT = 'Several links? Paste them in Settings → Import (one per line), or import a file there.';

test('the input bar takes one link at a time: several place links bring a hint to Settings → Import, no dialog', async () => {
  for (const text of [[LL_LINK, ADDRESS_AUID_LINK, AUID_LINK].join('\n'), `${AUID_LINK}\n${PLACE_ID_LINK}`]) {
    const { imports, toasts, cleared } = await pasteIntoBar(text);
    assert.deepEqual(imports, [], text);
    assert.deepEqual(toasts, [[SEVERAL_LINKS_HINT, 'info']], text);
    assert.equal(cleared, 0, 'nothing imported');
  }
});

test('Settings → Import: three place links (ll=, address+auid, auid only) open one import dialog, the auid-only row unchecked for the Shortcut', async () => {
  const { imports, toasts, field } = await readInSettings([LL_LINK, ADDRESS_AUID_LINK, AUID_LINK].join('\n'));
  assert.equal(imports.length, 1);
  const { e, n, g } = imports[0];
  assert.deepEqual(e.map((r) => [r.name, r.lat, r.lon, r.checked !== false]), [
    ['Synthetic Cafe', 48.1371, 11.5754, true],
    ['Synthetic Museum', 48.2, 11.6, true],
    ['Apple Maps place', null, null, false],
  ]);
  assert.equal(e[1].address, 'Teststrasse 1, 80331 Testtown, Germany');
  assert.equal(e[2].url, 'https://maps.apple.com/place?auid=987654321');
  assert.deepEqual(g.appleIds, ['987654321'], 'the dialog offers the Shortcut lookup for it');
  assert.equal(g.entries.length, 2, 'the other rows wait with it, so a trip to the Shortcuts app keeps them');
  assert.equal(n, '', 'no guide name: the dialog says "Places found"');
  assert.equal(field.value, '');
  assert.deepEqual(toasts, []);
});

test('Settings → Import: place links with repeats and other lines give one row per place, the other lines ignored', async () => {
  const text = ['My places:', LL_LINK, '', AUID_LINK, `${LL_LINK} `, PLACE_ID_ONLY_LINK, 'see you there', PLACE_ID_LINK, AUID_LINK].join('\n');
  const { imports } = await readInSettings(text);
  assert.equal(imports.length, 1);
  const { e, g } = imports[0];
  assert.deepEqual(e.map((r) => r.name), ['Synthetic Cafe', 'Synthetic Lake', 'Apple Maps place']);
  assert.deepEqual(g.appleIds, ['987654321'], 'the auid and the place-id link name the same place');
});

test('Settings → Import: Google Maps links open one import dialog without the Apple lookup, nothing fetched yet', async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}'); };
  const { imports } = await readInSettings([
    'https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721',
    'https://maps.app.goo.gl/synthetic1',
  ].join('\n'));
  assert.equal(imports.length, 1);
  const { e, g } = imports[0];
  assert.equal(g, null);
  assert.deepEqual(e.map((r) => [r.name, r.lat, r.checked !== false]), [['Synthetic Bar', 45.4719, true], ['Google place', null, true]]);
  assert.match(e[1].warning, /resolved on import/);
  assert.deepEqual(calls, [], 'the short link is resolved on import, as in a list import');
});

test('one place link alone still opens the confirm dialog, not the import', async () => {
  const opened = [];
  globalThis.document = { getElementById: (id) => { opened.push(id); throw new Error('confirm dialog reached'); } };
  try {
    for (const text of [LL_LINK, `Look at this:\n${ADDRESS_AUID_LINK}\nnice, isn't it`, `${LL_LINK}\n${LL_LINK}`]) {
      opened.length = 0;
      const imports = [];
      const { ui } = fakeUi();
      await assert.rejects(startAdd(text, { ...ui, showImport: () => imports.push(1) }), /confirm dialog reached/, text);
      assert.deepEqual(opened, ['dlg-confirm'], text);
      assert.equal(imports.length, 0, text);
    }
  } finally {
    delete globalThis.document;
  }
});

test('isShortcutPaste: two or more place links go straight to the add flow too (the field would join the lines)', async () => {
  const { isShortcutPaste } = await import('../web/js/addflow.js');
  assert.equal(isShortcutPaste(`${LL_LINK}\n${AUID_LINK}`), true);
  assert.equal(isShortcutPaste(`${LL_LINK}\r\n${ADDRESS_AUID_LINK}\r\n`), true);
  for (const t of [LL_LINK, AUID_LINK, `${LL_LINK}\n${LL_LINK}`, `Look at this:\n${LL_LINK}`]) {
    assert.equal(isShortcutPaste(t), false, t);
  }
});

test('Settings → Import: an Apple link with only a place-id is an Apple ID row too', async () => {
  const { imports } = await readInSettings(`${LL_LINK}\n${PLACE_ID_ONLY_LINK}`);
  const { e, g } = imports[0];
  assert.deepEqual(g.appleIds, ['987654321']);
  assert.equal(e[1].url, 'https://maps.apple.com/place?auid=987654321');
  assert.equal(e[1].checked, false);
});

test('raw HTML without a waiting guide never turns into a list of place links, not even in Settings', async () => {
  const page = (id) => `<!DOCTYPE html><html><head><link rel="canonical" href="https://maps.apple.com/place?auid=${id}"></head>` +
    `<body><a href="https://maps.apple.com/?ll=48.1,11.5&q=Spot${id}">x</a></body></html>`;
  const { imports, toasts } = await readInSettings(`${page(101)}\n${page(202)}`);
  assert.equal(imports.length, 0);
  assert.ok(!toasts.some(([t]) => t === SEVERAL_LINKS_HINT));
});

/* ---------- Settings → Import: pasted text goes the input bar's way (2.0.10) ---------- */

/** Runs Settings' "Read" on `value`; records the order of closing Settings and opening dialogs. */
async function readInSettings(value) {
  globalThis.localStorage = memoryStorage();
  const { addFromSettings } = await import('../web/js/addflow.js');
  const { toasts, ui } = fakeUi();
  const field = { value };
  const order = [];
  const imports = [];
  await addFromSettings(field, { ...ui, showImport: (e, n, g) => { order.push('import'); imports.push({ e, n, g }); } },
    () => order.push('close'));
  return { field, order, imports, toasts };
}

test('Settings → Import → Read: three place links open one import dialog; Settings closes first, the field empties', async () => {
  const { field, order, imports } = await readInSettings(`  ${[LL_LINK, ADDRESS_AUID_LINK, AUID_LINK].join('\n')}\n`);
  assert.deepEqual(order, ['close', 'import']);
  assert.equal(imports[0].e.length, 3);
  assert.deepEqual(imports[0].g.appleIds, ['987654321']);
  assert.equal(field.value, '');
});

test('Settings → Import → Read: a guide link with the Shortcut\'s results works there as in the input bar', async () => {
  const { imports, field } = await readInSettings([SYN_GUIDE, 'https://maps.apple.com/place?auid=1001@@Museum@@48.1@@11.5@@Town'].join('\n'));
  assert.equal(imports[0].n, 'Synthetic Guide');
  assert.equal(rowOf(imports[0].e, '1001').name, 'Museum');
  assert.equal(field.value, '');
});

test('Settings → Import → Read: an empty field does nothing; a link nothing could open stays in the field', async () => {
  const empty = await readInSettings('  \n ');
  assert.deepEqual(empty.order, []);
  const failed = await readInSettings(AUID_LINK);
  assert.deepEqual(failed.imports, []);
  assert.equal(failed.toasts.at(-1)[1], 'error');
  assert.equal(failed.field.value, AUID_LINK, 'kept, so it can be fixed');
});

/* ---------- Fix round 1 (2.0.10 review) ---------- */

const { shortcutInput, loadPendingGuide } = await import('../web/js/appleplace.js');

/**
 * The input bar (or with `viaSettings`, Settings → Import) with a guide waiting as "Look up with
 * iPhone Shortcut" leaves it: own pin, 1 of 3 Apple IDs found.
 */
async function addWithWaitingGuide(text, { viaSettings = false } = {}) {
  globalThis.localStorage = memoryStorage();
  const inline = [{ name: 'Pin', address: '', lat: 47.1, lon: 11.1, url: '', source: 'apple-guide', note: '', warning: '' }];
  const found = new Map([['101', { name: 'Earlier', lat: 48.1, lon: 11.5, address: 'Testtown' }]]);
  savePendingGuide({ title: 'Synthetic Guide', link: 'https://guides.apple.com/?ug=x', entries: inline,
    appleIds: ['101', '202', '303'], found, requested: ['202', '303'] });
  const { addFromSettings } = await import('../web/js/addflow.js');
  const { toasts, ui } = fakeUi();
  const imports = [];
  const env = { ...ui, inputDone: () => {}, showImport: (e, n, g) => imports.push({ e, n, g }) };
  if (viaSettings) await addFromSettings({ value: text }, env, () => {});
  else await startAdd(text, env);
  return { imports, toasts };
}

test('the copied place links pasted back before the Shortcut is done: the waiting guide reopens, with a hint', async () => {
  for (const ids of [['202', '303'], ['101', '202', '303'], ['303']]) {
    const { imports, toasts } = await addWithWaitingGuide(shortcutInput(ids));
    assert.equal(imports.length, 1, ids.join());
    const { e, n, g } = imports[0];
    assert.equal(n, 'Synthetic Guide', ids.join());
    assert.deepEqual(g.appleIds, ['101', '202', '303'], 'the waiting guide, not a new list');
    assert.deepEqual(g.requested, ['202', '303']);
    assert.equal(e[0].name, 'Pin', 'its own pins stay');
    assert.equal(rowOf(e, '101').name, 'Earlier', 'earlier finds stay');
    assert.match(toasts.at(-1)[0], /Shortcut isn't done yet/);
    assert.equal(loadPendingGuide().title, 'Synthetic Guide');
  }
});

test('place links that are not all the waiting guide\'s, or come with other places: their own list in Settings, the hint in the input bar', async () => {
  for (const text of [shortcutInput(['202', '999']), `${shortcutInput(['202'])}\n${LL_LINK}`]) {
    const settings = await addWithWaitingGuide(text, { viaSettings: true });
    assert.equal(settings.imports[0].n, '', text);
    assert.ok(!settings.toasts.some(([t]) => /isn't done yet/.test(t)), text);
    const bar = await addWithWaitingGuide(text);
    assert.deepEqual(bar.imports, [], text);
    assert.deepEqual(bar.toasts, [[SEVERAL_LINKS_HINT, 'info']], text);
  }
});

test('Settings → Import: a guide link stays out of a list of place links', async () => {
  const { imports } = await readInSettings([SYN_GUIDE, LL_LINK, PLACE_ID_LINK].join('\n'));
  assert.deepEqual(imports[0].e.map((r) => r.name), ['Synthetic Cafe', 'Synthetic Lake']);
  assert.equal(imports[0].g, null, 'none of the guide\'s Apple IDs');
});

test('the input bar: any two links bring the hint and import nothing (two posts, two guides, a guide and a place)', async () => {
  const { isShortcutPaste } = await import('../web/js/addflow.js');
  for (const text of [
    'https://www.instagram.com/p/AAA111/\nhttps://www.instagram.com/p/BBB222/',
    `${APPLE_UG}\n${SYN_GUIDE}`,
    `${SYN_GUIDE}\n${LL_LINK}`,
    `Look: https://www.instagram.com/p/AAA111/ and ${LL_LINK}`,
  ]) {
    const { imports, toasts, cleared } = await pasteIntoBar(text);
    assert.deepEqual(imports, [], text);
    assert.deepEqual(toasts, [[SEVERAL_LINKS_HINT, 'info']], text);
    assert.equal(cleared, 0, text);
    assert.equal(isShortcutPaste(text), true, `${text}: straight to the add flow, so the hint shows on paste`);
  }
});

test('Settings → Import: a list of place links says in one toast how many other links it left out', async () => {
  const text = [LL_LINK, AUID_LINK, 'https://maps.apple/p/AbCdEf1234', 'https://www.instagram.com/p/ABC123/', SYN_GUIDE, LL_LINK].join('\n');
  const { imports, toasts } = await readInSettings(text);
  assert.equal(imports[0].e.length, 2);
  assert.deepEqual(toasts, [["Skipped 3 links that aren't place links this app can read.", 'info']]);
});

test('Settings → Import: the copied place links with another link: their own list, not the waiting guide', async () => {
  const { imports, toasts } = await addWithWaitingGuide(`${shortcutInput(['202', '303'])}\nhttps://maps.apple/p/AbCdEf1234`, { viaSettings: true });
  assert.equal(imports[0].n, '');
  assert.deepEqual(toasts, [["Skipped 1 link that isn't a place link this app can read.", 'info']]);
});

/** A document just big enough for the confirm dialog; without #confirm-map the preview map stays off. */
function confirmDocument() {
  const make = () => {
    const on = {};
    return {
      hidden: false, open: false, disabled: false, value: '', textContent: '', innerHTML: '', scrollTop: 0,
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {}, appendChild() {}, append() {}, focus() {}, select() {},
      querySelector: () => make(), querySelectorAll: () => [],
      addEventListener(type, fn) { (on[type] ??= []).push(fn); },
      fire(type) { for (const fn of on[type] || []) fn({ preventDefault() {} }); },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire('close'); },
    };
  };
  const els = new Map();
  return {
    getElementById: (id) => (id === 'confirm-map' ? null : els.get(id) ?? els.set(id, make()).get(id)),
    createElement: () => make(), createTextNode: () => ({}), querySelectorAll: () => [],
  };
}

test('Settings → Import → Read with one place link: once the confirm dialog saves its pin, the field empties', async () => {
  const { wireConfirm, addFromSettings } = await import('../web/js/addflow.js');
  const { store, normalizeDb } = await import('../web/js/store.js');
  const doc = confirmDocument();
  globalThis.document = doc;
  store.db = normalizeDb({});
  try {
    const { ui } = fakeUi();
    const appEnv = { ...ui, redraw() {}, inputDone() {} };
    wireConfirm(appEnv);
    const field = { value: LL_LINK };
    await addFromSettings(field, appEnv, () => {});
    assert.equal(doc.getElementById('dlg-confirm').open, true, 'the confirm dialog is open');
    assert.equal(field.value, LL_LINK, 'kept while the dialog is open, like the input bar');
    doc.getElementById('confirm-save').fire('click');
    assert.deepEqual(store.db.pins.map((p) => p.title), ['Synthetic Cafe']);
    assert.equal(field.value, '');
  } finally {
    delete globalThis.document;
    clearTimeout(store._saveTimer);
    store._saveTimer = null;
  }
});
