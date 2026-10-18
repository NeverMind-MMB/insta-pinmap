import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Instagram posts with a location tag (2.2.0): /api/ig sends `locationTag: { name, lat, lon, address? }`
 * (and, for apps from before 2.2.0, the tag's name as `location`)
 * and Confirm place shows that place first, marked "Tagged location", with the caption's
 * places below. Nothing is saved before Drop pin. All names, codes and coordinates are made up.
 * At the end: a TikTok video's tag, which /api/post reads from the video page (name and address).
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

/* ---------- TikTok's location tag, through the Worker's /api/post (2.2.0) ---------- */

const { TIKTOK_OEMBED } = await import('../web/js/tiktok.js');
const TT_ID = '7561234567890123456';
const TT_VIDEO = `https://www.tiktok.com/@synthetic.user/video/${TT_ID}`;
const TT_TAG = { name: 'Trattoria Sintetica', address: 'Via Finta 1, 40100, Testopoli, Italia' };

/**
 * oEmbed answers `caption` (or refuses with `oembedOk` false), /api/post answers `post`,
 * the place search answers `places(query)` (Photon).
 */
function stubTikTok({ caption = 'Lunch 📍 Harbour Cafe #foodtok', oembedOk = true, post, places = () => [] }) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith(TIKTOK_OEMBED)) {
      return oembedOk
        ? json({ title: caption, author_unique_id: 'synthetic.user', embed_product_id: TT_ID, embed_type: 'video' })
        : json({ code: 400 }, 400);
    }
    if (u.startsWith('/api/post')) return json(post);
    if (u.includes('photon')) return json({ features: places(new URL(u).searchParams.get('q')) });
    if (u.includes('nominatim')) return json([]);
    return new Response('', { status: 404 });
  };
  return calls;
}

async function addTikTok(options) {
  const doc = confirmDocument();
  globalThis.document = doc;
  store.db = normalizeDb({});
  const calls = stubTikTok(options);
  const ui = { toast() {}, hideToast() {}, redraw() {}, inputDone() {} };
  wireConfirm(ui);
  await startAdd(TT_VIDEO, ui);
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
  return { el, rows, calls, searched: calls.filter((u) => /photon|nominatim/.test(u)).map((u) => new URL(u).searchParams.get('q')) };
}

test('TikTok: the video\'s location tag from /api/post comes first as "Tagged location", the caption\'s places below', async () => {
  try {
    const places = (q) => (q.startsWith('Trattoria Sintetica') ? [feature('Via Finta 1', 44.4949, 11.3426)] : [feature('Harbour Cafe', 48.2, 11.6)]);
    const { el, rows, calls, searched } = await addTikTok({ post: { ok: true, kind: 'tiktok', url: TT_VIDEO, title: '', text: 'x', location: TT_TAG }, places });
    const asked = calls.filter((u) => u.startsWith('/api/post'));
    assert.equal(asked.length, 1);
    assert.equal(new URL(asked[0], 'https://app.example').searchParams.get('url'), TT_VIDEO, 'the video link, not the shared one');
    assert.equal(searched[0], 'Trattoria Sintetica, Via Finta 1, 40100, Testopoli, Italia', 'the tag is searched first, with its address');
    assert.deepEqual(rows[0], { name: 'Trattoria Sintetica', address: TT_TAG.address, kind: 'Tagged location', pressed: 'true' });
    assert.deepEqual(rows.slice(1).map((r) => [r.name, r.kind === 'Tagged location']), [['Harbour Cafe', false]], 'caption places below');
    assert.equal(el('confirm-title').value, 'Trattoria Sintetica');
    assert.match(el('confirm-status').textContent, /location tag/);
    assert.match(el('confirm-caption').textContent, /Harbour Cafe/, 'the caption still comes from oEmbed');
    assert.equal(store.db.pins.length, 0, 'nothing is saved before Drop pin');

    el('confirm-save').fire('click');
    const pin = store.db.pins[0];
    assert.deepEqual([pin.lat, pin.lon, pin.title, pin.address, pin.source], [44.4949, 11.3426, 'Trattoria Sintetica', TT_TAG.address, 'tiktok']);
    assert.equal(pin.posts[0].url, TT_VIDEO);
  } finally {
    cleanUp();
  }
});

test('TikTok: a tag with coordinates is the place as it is; a tag the search can\'t place is a search candidate, no tagged row', async () => {
  try {
    let r = await addTikTok({ post: { ok: true, location: { ...TT_TAG, lat: 44.5, lon: 11.3 } }, places: () => [feature('Harbour Cafe', 48.2, 11.6)] });
    assert.deepEqual([r.rows[0].name, r.rows[0].kind], ['Trattoria Sintetica', 'Tagged location']);
    assert.ok(!r.searched.some((q) => q.includes('Via Finta')), 'not searched');
    cleanUp();
    r = await addTikTok({ post: { ok: true, location: TT_TAG }, places: (q) => (q.includes('Via Finta') ? [] : [feature('Harbour Cafe', 48.2, 11.6)]) });
    assert.ok(r.rows.every((row) => row.kind !== 'Tagged location'));
    assert.equal(r.searched.find((q) => !q.includes('Via Finta')), 'Trattoria Sintetica', "after the tag's address, its name is the first candidate");
  } finally {
    cleanUp();
  }
});

test('TikTok without a tag, or with /api/post failing: the caption flow as before', async () => {
  try {
    for (const post of [{ ok: true, kind: 'tiktok', text: 'x' }, { ok: false, reason: 'http-403', message: "Couldn't read this TikTok video." }]) {
      const { el, rows, searched } = await addTikTok({ post, places: () => [feature('Harbour Cafe', 48.2, 11.6)] });
      assert.ok(rows.every((r) => r.kind !== 'Tagged location'), JSON.stringify(post));
      assert.equal(searched[0], 'Harbour Cafe');
      assert.equal(el('confirm-title').value, 'Harbour Cafe');
      assert.equal(el('confirm-error').hidden, true);
      cleanUp();
    }
  } finally {
    cleanUp();
  }
});

test('TikTok: oEmbed refusing the video, the Worker\'s caption and tag still fill Confirm place', async () => {
  try {
    const { el, rows } = await addTikTok({
      oembedOk: false,
      post: { ok: true, kind: 'tiktok', text: 'Dinner 📍 Harbour Cafe', author: 'synthetic.user', location: { ...TT_TAG, lat: 44.5, lon: 11.3 } },
      places: () => [feature('Harbour Cafe', 48.2, 11.6)],
    });
    assert.equal(rows[0].kind, 'Tagged location');
    assert.match(el('confirm-caption').textContent, /Dinner/);
    assert.equal(el('confirm-error').hidden, true, 'no "couldn\'t read" notice: the Worker read it');
  } finally {
    cleanUp();
  }
});
