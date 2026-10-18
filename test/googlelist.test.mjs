// test/googlelist.test.mjs — a Google Maps list link imports the whole list (web/js/googlelist.js, Worker /api/list).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { startAdd, addFromSettings, isMapLink } = await import('../web/js/addflow.js');
const { googleListId, googleListEntries } = await import('../web/js/googlelist.js');
const { importTag } = await import('../web/js/ui.js');
const { sourceColor, pinLook, SOURCE_GROUPS } = await import('../web/js/sources.js');

const LIST_ID = 'SyntheticListId_0123456789';
const LIST_LINK = `https://www.google.com/maps/placelists/list/${LIST_ID}?g_ep=synthetic`;
const RESOLVED_LINK = `https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2s${LIST_ID}!3e3?g_ep=synthetic`;

/** What /api/list answers for a synthetic list. */
const LIST = {
  ok: true,
  title: 'Synthetic Trip: Rome',
  total: 3,
  places: [
    { name: 'Synthetic Cafe', lat: 41.9, lon: 12.5, address: 'Via Test 1, Rome', note: 'Try the cake', url: 'https://www.google.com/maps?cid=1' },
    { name: '', lat: 41.8, lon: 12.4, address: 'Via Prova 2, Rome', note: '', url: 'https://www.google.com/maps?cid=2' },
    { name: 'Synthetic Bar', lat: null, lon: null, address: '', note: '', url: '' },
  ],
};

function fakeUi() {
  const toasts = [];
  return { toasts, ui: { toast: (text, kind) => toasts.push([text, kind]), hideToast: () => {} } };
}

/** Stubs fetch: /api/resolve answers `resolved`, /api/list answers `answer` (a body, or [status, body]); records the calls. */
function stubWorker({ answer = LIST, resolved = RESOLVED_LINK } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('/api/resolve')) return Response.json({ ok: true, url: resolved });
    if (typeof answer === 'function') return answer();
    const [status, body] = Array.isArray(answer) ? answer : [200, answer];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

/** Runs startAdd from the input bar; returns what it opened and said. */
async function addInBar(text, options) {
  const calls = stubWorker(options);
  const { toasts, ui } = fakeUi();
  const imports = [];
  const unsupported = [];
  let cleared = 0;
  await startAdd(text, {
    ...ui,
    inputDone: () => cleared++,
    showImport: (entries, name, guide) => imports.push({ entries, name, guide }),
    showUnsupported: (link, what) => unsupported.push([link, what]),
  });
  return { calls, toasts, imports, unsupported, cleared };
}

/* ---------- Which links are lists ---------- */

test('googleListId: the list ID of a placelists link and of the address a list\'s short link resolves to', () => {
  for (const link of [
    LIST_LINK, RESOLVED_LINK,
    `https://google.de/maps/placelists/list/${LIST_ID}`,
    `https://www.google.co.uk/maps/placelists/list/${LIST_ID}/`,
    `https://maps.google.com/maps/placelists/list/${LIST_ID}`,
    `google.com/maps/placelists/list/${LIST_ID}`,
  ]) {
    assert.equal(googleListId(link), LIST_ID, link);
  }
});

test('googleListId: nothing for place links, short links, other sites and IDs that are too short or too long', () => {
  for (const link of [
    'https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721',
    'https://maps.app.goo.gl/synthList', 'https://www.google.com/maps/placelists/list/short',
    `https://www.google.com/maps/placelists/list/${'x'.repeat(65)}`,
    `https://evil.example/maps/placelists/list/${LIST_ID}`,
    `https://www.google.com.evil.example/maps/placelists/list/${LIST_ID}`,
    `https://www.instagram.com/p/ABC123/?x=/placelists/list/${LIST_ID}`,
    'Cafe Luitpold', '', null,
  ]) {
    assert.equal(googleListId(link), '', String(link));
  }
});

/* ---------- The input bar ---------- */

test('the input bar: a Google Maps list link opens one import dialog with every place, titled with the list\'s name', async () => {
  const { calls, imports, unsupported, toasts, cleared } = await addInBar(LIST_LINK);
  assert.deepEqual(calls, [`/api/list?link=${encodeURIComponent(LIST_LINK)}`]);
  assert.deepEqual(unsupported, []);
  assert.equal(imports.length, 1);
  const { entries, name, guide } = imports[0];
  assert.equal(name, 'Synthetic Trip: Rome');
  assert.equal(importTag(name), 'synthetic-trip-rome', 'the tag field starts with the list\'s name');
  assert.equal(guide, null);
  assert.equal(entries.length, 3);
  for (const e of entries) {
    assert.equal(e.source, 'google-list');
    assert.notEqual(e.checked, false, `${e.name} is checked`);
  }
  assert.deepEqual(entries[0], {
    name: 'Synthetic Cafe', address: 'Via Test 1, Rome', lat: 41.9, lon: 12.5,
    url: 'https://www.google.com/maps?cid=1', source: 'google-list', note: 'Try the cake', warning: '',
  });
  assert.equal(cleared, 1, 'the input bar empties once the dialog has the list');
  assert.equal(toasts.at(-1)?.[1], 'busy', 'only the "reading" toast, no error');
});

test('the input bar: a maps.app.goo.gl list link is resolved first, then the list is read', async () => {
  const { calls, imports, unsupported } = await addInBar('https://maps.app.goo.gl/synthList');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^\/api\/resolve\?url=/);
  assert.equal(calls[1], `/api/list?link=${encodeURIComponent(RESOLVED_LINK)}`);
  assert.deepEqual(unsupported, []);
  assert.equal(imports[0]?.name, 'Synthetic Trip: Rome');
  assert.equal(imports[0].entries.length, 3);
});

test('the input bar: a list link inside shared text works too', async () => {
  const { imports } = await addInBar(`Our trip: ${LIST_LINK} – enjoy`);
  assert.equal(imports.length, 1);
});

test('a list link is a map link (sources.js picks the Google reader)', () => {
  assert.equal(isMapLink(LIST_LINK), true);
  assert.equal(isMapLink(RESOLVED_LINK), true);
});

/* ---------- Settings → Import ---------- */

test('Settings → Import: one list link opens the same import dialog', async () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const calls = stubWorker();
  const { ui } = fakeUi();
  const field = { value: LIST_LINK };
  const imports = [];
  await addFromSettings(field, { ...ui, showImport: (e, n) => imports.push({ e, n }), showUnsupported: () => assert.fail('lists are supported') }, () => {});
  assert.deepEqual(calls, [`/api/list?link=${encodeURIComponent(LIST_LINK)}`]);
  assert.equal(imports[0]?.n, 'Synthetic Trip: Rome');
  assert.equal(imports[0].e.length, 3);
  assert.equal(field.value, '', 'the paste box empties');
});

/* ---------- When the list can't be read ---------- */

test('a list the Worker can\'t read: its message as an error toast, no dialog, the input bar keeps the link', async () => {
  const message = 'This Google Maps list can\'t be read. Only lists shared with "Anyone with the link" can be imported.';
  const { imports, unsupported, toasts, cleared } = await addInBar(LIST_LINK, { answer: [404, { ok: false, reason: 'not-found', message }] });
  assert.deepEqual(imports, []);
  assert.deepEqual(unsupported, []);
  assert.deepEqual(toasts.at(-1), [message, 'error']);
  assert.equal(cleared, 0);
});

test('a placelists link without a readable list ID: an error toast, no request, no unsupported-link dialog', async () => {
  const { calls, imports, unsupported, toasts } = await addInBar('https://www.google.com/maps/placelists/list/AbCdEf123');
  assert.deepEqual(calls, []);
  assert.deepEqual(imports, []);
  assert.deepEqual(unsupported, []);
  assert.equal(toasts.at(-1)[1], 'error');
  assert.match(toasts.at(-1)[0], /list link/);
});

test('no internet, an old Worker without /api/list, or junk: a clear error toast instead of junk', async () => {
  for (const answer of [
    () => { throw new TypeError('Failed to fetch'); },
    [404, { ok: false, message: 'Not found.' }],
    [200, '<html>not json</html>'],
    [200, { ok: true, title: 'x' }],
  ]) {
    const { imports, unsupported, toasts } = await addInBar(LIST_LINK, { answer });
    assert.deepEqual(imports, [], String(answer));
    assert.deepEqual(unsupported, [], String(answer));
    const [text, kind] = toasts.at(-1);
    assert.equal(kind, 'error');
    assert.ok(!text.includes('Not found.'), text);
    assert.match(text, /Google Maps list|internet/i, text);
  }
});

test('an empty list: says so, no dialog', async () => {
  const { imports, toasts } = await addInBar(LIST_LINK, { answer: { ok: true, title: 'Empty', total: 0, places: [] } });
  assert.deepEqual(imports, []);
  assert.match(toasts.at(-1)[0], /no places/);
});

test('fewer places than the list holds: the dialog opens, and a note says how many came back', async () => {
  const { imports, toasts } = await addInBar(LIST_LINK, { answer: { ...LIST, total: 3500 } });
  assert.equal(imports[0].entries.length, 3);
  assert.deepEqual(toasts.at(-1), ['Google sent 3 of the 3500 places in this list.', 'info']);
});

/* ---------- Import rows ---------- */

test('googleListEntries: a place without a name takes its address\'s first part, else "Google place"; no coordinates → looked up on import', () => {
  const entries = googleListEntries(LIST.places.concat([{ name: '', lat: 1, lon: 2 }]));
  assert.deepEqual(entries.map((e) => e.name), ['Synthetic Cafe', 'Via Prova 2', 'Synthetic Bar', 'Google place']);
  assert.equal(entries[2].lat, null);
  assert.equal(entries[2].lon, null);
  assert.match(entries[2].warning, /coordinates/);
  assert.ok(entries.every((e) => e.checked !== false));
});

test('google-list pins: the Google group\'s colour and logo', () => {
  assert.ok(SOURCE_GROUPS.find((g) => g.id === 'google').sources.includes('google-list'));
  assert.equal(sourceColor('google-list'), '#2f7d5d');
  assert.deepEqual(pinLook('google-list'), { logo: '/icons/sources/google.png', caption: '' });
});
