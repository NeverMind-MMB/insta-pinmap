import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Instagram posts with a location tag (2.2.0): /api/ig sends `locationTag: { name, lat, lon, address? }`
 * (and, for apps from before 2.2.0, the tag's name as `location`)
 * and Confirm place shows that place first, marked "Tagged location", with the caption's
 * places below. Nothing is saved before Drop pin. All names, codes and coordinates are made up.
 */

const { startAdd, wireConfirm, taggedPlace } = await import('../web/js/addflow.js');
const { store, normalizeDb } = await import('../web/js/store.js');

/** A document for the confirm dialog that also finds `.class` children, so the candidate list can be read. */
function confirmDocument() {
  const descendants = (n) => (n.children || []).flatMap((c) => [c, ...descendants(c)]);
  const make = (tag = '') => {
    const on = {};
    const memo = {};
    let html = '';
    return {
      tag, className: '', attrs: {}, hidden: false, open: false, disabled: false, checked: false, value: '', textContent: '', scrollTop: 0,
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [],
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; this.children = []; for (const k of Object.keys(memo)) delete memo[k]; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      focus() {}, select() {},
      appendChild(kid) { this.children.push(kid); return kid; },
      append(...kids) { this.children.push(...kids); },
      replaceChildren(...kids) { this.children = kids; },
      querySelector(sel) {
        if (sel === 'input:checked') return descendants(this).find((n) => n.tag === 'input' && n.checked) || null;
        const hit = sel.startsWith('.') && descendants(this).find((n) => n.className === sel.slice(1));
        return hit || (memo[sel] ??= make());
      },
      querySelectorAll(sel) { return sel.startsWith('.') ? descendants(this).filter((n) => n.className === sel.slice(1)) : []; },
      addEventListener(type, fn) { (on[type] ??= []).push(fn); },
      fire(type) { for (const fn of on[type] || []) fn({ preventDefault() {} }); },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire('close'); },
    };
  };
  const els = new Map();
  return {
    getElementById: (id) => (id === 'confirm-map' ? null : els.get(id) ?? els.set(id, make()).get(id)),
    createElement: (tag) => make(tag), createTextNode: (t) => ({ textContent: t }), querySelectorAll: () => [],
  };
}

/** The work ticket is solved in a Web Worker; here it answers at once. */
globalThis.Worker = class {
  postMessage() { queueMicrotask(() => this.onmessage({ data: { nonce: 1 } })); }
  terminate() {}
};

const feature = (name, lat, lon) => ({
  geometry: { coordinates: [lon, lat] },
  properties: { name, city: 'Testtown', country: 'Testland', countrycode: 'TL', osm_key: 'amenity', osm_value: 'cafe' },
});

/** /api/ig answers `ig`; the place search answers `places` (Photon) for every query. */
function stubNetwork(ig, places = []) {
  const calls = [];
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('/api/ig')) return json(ig);
    if (u.includes('photon')) return json({ features: places });
    if (u.includes('nominatim')) return json([]);
    return new Response('', { status: 404 });
  };
  return calls;
}

const POST = { ok: true, shortcode: 'SynthTag001', username: 'synthetic.user', postedAt: '2026-05-01', thumb: '' };
const TAG = { name: 'Synthetic Bistro', lat: 47.5012345, lon: 9.7487654, address: 'Teststraße 1, 12345 Testtown' };
/** What /api/ig sends for a tagged post: the whole tag as `locationTag`, its name as `location` (as before 2.2.0). */
const withTag = (tag) => ({ location: tag.name, locationTag: tag });

async function addPost(ig, places) {
  const doc = confirmDocument();
  globalThis.document = doc;
  store.db = normalizeDb({});
  const calls = stubNetwork(ig, places);
  const env = { toast() {}, hideToast() {}, redraw() {}, inputDone() {} };
  wireConfirm(env);
  await startAdd('https://www.instagram.com/p/SynthTag001/', env);
  const el = (id) => doc.getElementById(id);
  const rows = el('confirm-candidates').children.map((li) => {
    const btn = li.children[0];
    return {
      name: btn.querySelector('.candidate__name').textContent,
      address: btn.querySelector('.candidate__address').textContent,
      kind: btn.querySelector('.candidate__kind').textContent,
      pressed: btn.getAttribute('aria-pressed'),
    };
  });
  return { el, rows, calls, searched: calls.filter((u) => /photon|nominatim/.test(u)) };
}

function cleanUp() {
  delete globalThis.document;
  clearTimeout(store._saveTimer);
  store._saveTimer = null;
}

test('a post with a location tag: that place comes first as "Tagged location", chosen, the caption\'s places below', async () => {
  try {
    const places = [feature('Harbour Cafe', 48.2, 11.6), feature('Harbour Cafe Annex', 48.3, 11.7)];
    const { el, rows, searched } = await addPost({ ...POST, caption: 'Ort: Harbour Cafe\nGreat lunch', ...withTag(TAG) }, places);
    assert.equal(el('dlg-confirm').open, true);
    assert.deepEqual(rows[0], { name: 'Synthetic Bistro', address: 'Teststraße 1, 12345 Testtown', kind: 'Tagged location', pressed: 'true' });
    assert.deepEqual(rows.slice(1).map((r) => r.name).sort(), ['Harbour Cafe', 'Harbour Cafe Annex'], 'caption places below');
    assert.ok(rows.slice(1).every((r) => r.kind !== 'Tagged location' && r.pressed === 'false'));
    assert.ok(searched.length > 0, 'the caption was still searched');
    assert.equal(el('confirm-name').textContent, 'Synthetic Bistro', 'the preview shows the tagged place');
    assert.equal(el('confirm-coords').textContent, '47.50123, 9.74877');
    assert.equal(el('confirm-title').value, 'Synthetic Bistro');
    assert.match(el('confirm-status').textContent, /location tag/);
    assert.equal(el('confirm-save').disabled, false);
    assert.equal(store.db.pins.length, 0, 'nothing is saved before Drop pin');

    el('confirm-save').fire('click');
    assert.equal(store.db.pins.length, 1);
    const pin = store.db.pins[0];
    assert.deepEqual([pin.lat, pin.lon, pin.title, pin.address, pin.source], [47.5012345, 9.7487654, 'Synthetic Bistro', 'Teststraße 1, 12345 Testtown', 'instagram']);
    assert.match(pin.posts[0].url, /SynthTag001/);
  } finally {
    cleanUp();
  }
});

test('a tagged post: picking a caption place instead saves that one', async () => {
  try {
    const { el } = await addPost({ ...POST, caption: 'Ort: Harbour Cafe', ...withTag(TAG) }, [feature('Harbour Cafe', 48.2, 11.6)]);
    const list = el('confirm-candidates').children;
    assert.equal(list.length, 2);
    list[1].children[0].fire('click');
    assert.equal(list[0].children[0].getAttribute('aria-pressed'), 'false');
    assert.equal(list[1].children[0].getAttribute('aria-pressed'), 'true');
    el('confirm-save').fire('click');
    assert.deepEqual([store.db.pins[0].lat, store.db.pins[0].lon], [48.2, 11.6]);
  } finally {
    cleanUp();
  }
});

test('a tagged post: the search finding the tagged spot again does not list it twice', async () => {
  try {
    const places = [feature('Bistro (map name)', 47.50124, 9.74876), feature('Harbour Cafe', 48.2, 11.6)];
    const { rows } = await addPost({ ...POST, caption: 'Ort: Harbour Cafe', ...withTag(TAG) }, places);
    assert.deepEqual(rows.map((r) => r.name), ['Synthetic Bistro', 'Harbour Cafe']);
  } finally {
    cleanUp();
  }
});

test('a tagged post without places in its caption: only the tagged place, nothing searched', async () => {
  try {
    const { el, rows, searched } = await addPost({ ...POST, caption: '', ...withTag({ name: 'Synthetic Bistro', lat: 47.5, lon: 9.75 }) });
    assert.deepEqual(rows, [{ name: 'Synthetic Bistro', address: '', kind: 'Tagged location', pressed: 'true' }]);
    assert.deepEqual(searched, []);
    assert.match(el('confirm-status').textContent, /location tag/);
    assert.equal(el('confirm-save').disabled, false);
    assert.equal(store.db.pins.length, 0);
  } finally {
    cleanUp();
  }
});

test('a tagged post whose caption places the search doesn\'t know: the tagged place stays, no error', async () => {
  try {
    const { el, rows } = await addPost({ ...POST, caption: 'Ort: Harbour Cafe', ...withTag(TAG) }, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'Tagged location');
    assert.equal(el('confirm-name').textContent, 'Synthetic Bistro');
    assert.match(el('confirm-status').textContent, /location tag/);
  } finally {
    cleanUp();
  }
});

test('a post without a location tag works as before: the best caption match is chosen, no tagged row', async () => {
  try {
    const places = [feature('Harbour Cafe', 48.2, 11.6), feature('Harbour Cafe Annex', 48.3, 11.7)];
    const { el, rows } = await addPost({ ...POST, caption: 'Ort: Harbour Cafe\nGreat lunch' }, places);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.kind !== 'Tagged location'));
    assert.equal(rows[0].pressed, 'true');
    assert.equal(el('confirm-name').textContent, rows[0].name);
    assert.equal(el('confirm-status').textContent, '2 possible places — which one is it?');
  } finally {
    cleanUp();
  }
});

test('a tag the app can\'t place (bad coordinates) counts as no tag; its name is searched first', async () => {
  try {
    const { rows, searched } = await addPost({ ...POST, caption: 'Ort: Harbour Cafe', ...withTag({ name: 'Synthetic Bistro', lat: 123, lon: 9 }) },
      [feature('Harbour Cafe', 48.2, 11.6)]);
    assert.ok(rows.every((r) => r.kind !== 'Tagged location'));
    assert.match(searched[0], /q=Synthetic\+Bistro/);
  } finally {
    cleanUp();
  }
});

test('taggedPlace: only a named place with real coordinates', () => {
  assert.deepEqual(taggedPlace({ name: ' Synthetic Bistro ', lat: 47.5, lon: 9.75 }),
    { name: 'Synthetic Bistro', lat: 47.5, lon: 9.75, address: '', tagged: true });
  assert.equal(taggedPlace({ name: 'X Place', lat: 47.5, lon: 9.75, address: 'Teststraße 1' }).address, 'Teststraße 1');
  for (const bad of [
    undefined, null, 'Synthetic Bistro', {}, { name: 'X', lat: 47.5 }, { name: '', lat: 47.5, lon: 9.75 },
    { name: 'X', lat: '47.5', lon: '9.75' }, { name: 'X', lat: 0, lon: 0 }, { name: 'X', lat: -91, lon: 9 },
    { name: 'X', lat: 47, lon: 181 }, { name: 'X', lat: NaN, lon: 9 }, { name: 42, lat: 47.5, lon: 9.75 },
  ]) {
    assert.equal(taggedPlace(bad), null, JSON.stringify(bad));
  }
});
