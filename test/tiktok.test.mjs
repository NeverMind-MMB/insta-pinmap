// test/tiktok.test.mjs — TikTok videos (2.2.0): which links are TikTok's, the caption through
// TikTok's oEmbed endpoint (fetch stubbed, synthetic IDs and names), and the way into Confirm place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, linkIs, pinLook, sourceColor, linkSourceName, SUPPORTED_SOURCES } from '../web/js/sources.js';
import {
  isTikTokLink, tiktokVideo, tiktokLink, tiktokDay, tiktokEmbed, readTikTok, findTikTokPost, TIKTOK_OEMBED,
} from '../web/js/tiktok.js';

/** A synthetic TikTok ID made on `day` (its top 32 bits are the Unix time). */
const ttId = (day, low = 4242) => ((BigInt(Date.parse(`${day}T12:00:00Z`) / 1000) << 32n) + BigInt(low)).toString();
const ID = ttId('2026-10-12');
const OTHER_ID = ttId('2026-09-01', 99);
const USER = 'synthetic.user';
const VIDEO = `https://www.tiktok.com/@${USER}/video/${ID}`;
const oembedUrl = (link) => `${TIKTOK_OEMBED}?url=${encodeURIComponent(link)}`;

/** What TikTok's oEmbed answers for a video (the fields the app reads, plus some it doesn't). */
function oembedAnswer({ id = ID, user = USER, title = 'Synthetic caption #foodtok', type = 'video' } = {}) {
  return {
    version: '1.0', type: type === 'video' ? 'video' : 'rich', title, author_url: `https://www.tiktok.com/@${user}`,
    author_name: 'Synthetic Name', provider_name: 'TikTok', thumbnail_url: 'https://p16.example/x.image?x-signature=y',
    author_unique_id: user, embed_product_id: type === 'video' ? id : user, embed_type: type,
  };
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const REFUSED = () => jsonResponse({ message: 'Something went wrong', code: 400 }, 400);

/** A fetch stub: `routes(url)` gives a Response (or throws); every URL asked is recorded. */
function stubFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    return routes(String(url));
  };
  fn.calls = calls;
  return fn;
}

/* ---------- Which links are TikTok's: their prefix (sources.js) ---------- */

test('sourceOf: TikTok video, photo and short links are TikTok\'s; lookalikes are not', () => {
  for (const link of [
    VIDEO, `https://www.tiktok.com/@${USER}/photo/${ID}`, `https://m.tiktok.com/v/${ID}.html`,
    'https://vm.tiktok.com/ZMsynth01/', 'https://vt.tiktok.com/ZSsynth02/', 'https://www.tiktok.com/t/ZTsynth03/',
    `tiktok.com/@${USER}/video/${ID}`, `https://www.tiktok.com/@${USER}`,
  ]) {
    assert.equal(sourceOf(link), 'tiktok', link);
    assert.equal(isTikTokLink(link), true, link);
  }
  for (const link of ['https://nottiktok.com/@a/video/1', 'https://tiktok.com.evil.example/@a/video/1', 'https://vm.tiktok.com.evil.example/x']) {
    assert.equal(sourceOf(link), null, link);
  }
});

test('the TikTok group: short links are vm./vt.tiktok.com and tiktok.com/t/; the animation shows its name; its colour', () => {
  for (const link of ['https://vm.tiktok.com/ZMsynth01/', 'https://vt.tiktok.com/ZSsynth02/', 'https://www.tiktok.com/t/ZTsynth03/', 'https://m.tiktok.com/t/ZTsynth03']) {
    assert.equal(linkIs(link, 'short'), true, link);
  }
  for (const link of [VIDEO, `https://www.tiktok.com/@${USER}`]) assert.equal(linkIs(link, 'short'), false, link);
  assert.deepEqual(pinLook('tiktok'), { logo: '', caption: 'TikTok' });
  assert.equal(sourceColor('tiktok'), '#5a5f8f');
  assert.equal(linkSourceName(VIDEO), 'TikTok');
  assert.equal(linkSourceName('https://www.instagram.com/p/ABC123/'), 'Instagram');
  assert.equal(linkSourceName('https://www.pinterest.com/pin/1/'), '');
});

test('the unsupported-link dialog lists TikTok links for the input bar (Settings → Import takes the same links)', () => {
  const items = (id) => SUPPORTED_SOURCES.find((g) => g.id === id).items;
  for (const item of ['tiktok.com/@…/video/…', 'vm.tiktok.com/…', 'vt.tiktok.com/…', 'tiktok.com/t/…']) {
    assert.ok(items('bar').includes(item), item);
  }
  assert.match(items('several')[0], /everything the input bar takes/);
});

/* ---------- Reading a link ---------- */

test('tiktokVideo: user, ID and kind of video and photo links, with or without the sharing query; null for the rest', () => {
  assert.deepEqual(tiktokVideo(VIDEO), { user: USER, id: ID, kind: 'video' });
  assert.deepEqual(tiktokVideo(`https://www.tiktok.com/@${USER}/video/${ID}?is_from_webapp=1&sender_device=pc&_r=1`), { user: USER, id: ID, kind: 'video' });
  assert.deepEqual(tiktokVideo(`https://www.tiktok.com/@${USER}/photo/${ID}/`), { user: USER, id: ID, kind: 'photo' });
  assert.deepEqual(tiktokVideo(`https://www.tiktok.com/@/video/${ID}?_r=1&_d=secSynthetic`), { user: '', id: ID, kind: 'video' });
  assert.deepEqual(tiktokVideo(`https://m.tiktok.com/v/${ID}.html`), { user: '', id: ID, kind: 'video' });
  assert.deepEqual(tiktokVideo(`https://www.tiktok.com/embed/v2/${ID}`), { user: '', id: ID, kind: 'video' });
  assert.deepEqual(tiktokVideo(`tiktok.com/@${USER}/video/${ID}`), { user: USER, id: ID, kind: 'video' });
  for (const link of [
    `https://www.tiktok.com/@${USER}`, 'https://www.tiktok.com/tag/foodtok', 'https://www.tiktok.com/', 'https://vm.tiktok.com/ZMsynth01/',
    'https://www.tiktok.com/@a/video/12x', `https://www.instagram.com/@${USER}/video/${ID}`, '', null,
  ]) {
    assert.equal(tiktokVideo(link), null, String(link));
  }
});

test('tiktokLink and tiktokEmbed: the link kept on the pin, and the embed for the "couldn\'t read" notice', () => {
  assert.equal(tiktokLink({ user: USER, id: ID, kind: 'video' }), VIDEO);
  assert.equal(tiktokLink({ user: USER, id: ID, kind: 'photo' }), `https://www.tiktok.com/@${USER}/photo/${ID}`);
  assert.equal(tiktokLink({ user: '', id: ID }), `https://www.tiktok.com/@/video/${ID}`);
  assert.equal(tiktokEmbed(VIDEO), `https://www.tiktok.com/embed/v2/${ID}`);
  assert.equal(tiktokEmbed('https://vm.tiktok.com/ZMsynth01/'), null);
  assert.equal(tiktokEmbed('https://www.instagram.com/p/ABC123/'), null);
});

test('tiktokDay: the day a TikTok ID was made, from its top 32 bits; "" for anything implausible', () => {
  assert.equal(tiktokDay(ID), '2026-10-12');
  assert.equal(tiktokDay(OTHER_ID), '2026-09-01');
  for (const id of ['', '12', 'abc', '1'.repeat(30), ttId('2010-01-01'), ttId('2099-01-01'), undefined]) {
    assert.equal(tiktokDay(id), '', String(id));
  }
});

/* ---------- The caption through oEmbed ---------- */

test('readTikTok: a video link asks oEmbed once, as a /video/ link, and brings caption, username, link and posted day', async () => {
  const fetch = stubFetch(() => jsonResponse(oembedAnswer({ title: 'Lunch 📍 Trattoria Sintetica, Bologna 🇮🇹 #foodtok' })));
  const resolve = async () => assert.fail('no Worker for a full link');
  const tt = await readTikTok(`${VIDEO}?is_from_webapp=1`, { fetch, resolve });
  assert.deepEqual(fetch.calls, [oembedUrl(VIDEO)]);
  assert.deepEqual(tt, {
    ok: true, id: ID, url: VIDEO, username: USER, postedAt: '2026-10-12',
    caption: 'Lunch 📍 Trattoria Sintetica, Bologna 🇮🇹 #foodtok',
  });
});

test('readTikTok: a photo link is asked as a /video/ link (oEmbed refuses /photo/) and kept as a /photo/ link', async () => {
  const fetch = stubFetch((url) => (url.includes('%2Fphoto%2F') ? REFUSED() : jsonResponse(oembedAnswer())));
  const tt = await readTikTok(`https://www.tiktok.com/@${USER}/photo/${ID}`, { fetch });
  assert.deepEqual(fetch.calls, [oembedUrl(VIDEO)]);
  assert.equal(tt.ok, true);
  assert.equal(tt.url, `https://www.tiktok.com/@${USER}/photo/${ID}`);
});

test('readTikTok: a short link oEmbed takes as it is needs no Worker', async () => {
  const short = 'https://vt.tiktok.com/ZSsynth02/';
  const fetch = stubFetch(() => jsonResponse(oembedAnswer()));
  const tt = await readTikTok(short, { fetch, resolve: async () => assert.fail('no Worker needed') });
  assert.deepEqual(fetch.calls, [oembedUrl(short)]);
  assert.equal(tt.ok, true);
  assert.equal(tt.url, VIDEO, 'the link from the video ID and username');
  assert.equal(tt.id, ID);
});

test('readTikTok: a short link oEmbed refuses is expanded by the Worker once and asked again as a /video/ link', async () => {
  const short = 'https://vm.tiktok.com/ZMsynth01/';
  const expanded = `https://www.tiktok.com/@/video/${ID}?_r=1&_d=secSynthetic`;
  const fetch = stubFetch((url) => (url === oembedUrl(short) ? REFUSED() : jsonResponse(oembedAnswer())));
  const resolved = [];
  const tt = await readTikTok(short, { fetch, resolve: async (link) => { resolved.push(link); return { ok: true, url: expanded }; } });
  assert.deepEqual(resolved, [short]);
  assert.deepEqual(fetch.calls, [oembedUrl(short), oembedUrl(`https://www.tiktok.com/@/video/${ID}`)]);
  assert.equal(tt.ok, true);
  assert.equal(tt.url, VIDEO);
});

test('readTikTok: a dead short link (TikTok sends it to its home page) or one the Worker can\'t resolve has no video', async () => {
  for (const [answer, message] of [
    [{ ok: true, url: 'https://www.tiktok.com/?_r=1' }, /doesn't lead to a TikTok video/],
    [{ ok: true, url: 'https://www.tiktok.com/@synthetic.user' }, /doesn't lead to a TikTok video/],
    [{ ok: false, message: 'No internet. Try again later.' }, /No internet/],
  ]) {
    const fetch = stubFetch(REFUSED);
    const tt = await readTikTok('https://vm.tiktok.com/ZMsynth01/', { fetch, resolve: async () => answer });
    assert.equal(tt.ok, false);
    assert.equal(tt.id, '', 'no video to keep');
    assert.match(tt.message, message);
    assert.equal(fetch.calls.length, 1);
  }
});

test('readTikTok: oEmbed refusing a video link, an answer that is no video, and no network', async () => {
  const refused = await readTikTok(VIDEO, { fetch: stubFetch(REFUSED), resolve: async () => assert.fail('no Worker for a full link') });
  assert.equal(refused.ok, false);
  assert.equal(refused.id, ID, 'the video is still known');
  assert.equal(refused.url, VIDEO);
  assert.equal(refused.postedAt, '2026-10-12');
  assert.match(refused.message, /private or deleted/);

  // A short link to a profile: oEmbed answers, but with no video.
  const profile = await readTikTok('https://vm.tiktok.com/ZMsynth01/', { fetch: stubFetch(() => jsonResponse(oembedAnswer({ type: 'profile' }))) });
  assert.equal(profile.ok, false);
  assert.equal(profile.id, '');
  assert.match(profile.message, /isn't a video/);

  const offline = await readTikTok(VIDEO, { fetch: stubFetch(() => { throw new TypeError('Failed to fetch'); }) });
  assert.equal(offline.ok, false);
  assert.equal(offline.reason, 'network');
  assert.match(offline.message, /No internet/);
  assert.equal(offline.id, ID);
});

test('findTikTokPost: a pin\'s post with the same video ID, whatever link form it was saved as', () => {
  const db = { pins: [
    { id: 'a', posts: [{ url: 'https://www.instagram.com/p/ABC123/' }] },
    { id: 'b', posts: [{ url: `https://www.tiktok.com/@old.name/video/${ID}` }] },
  ] };
  assert.equal(findTikTokPost(db, ID)?.pin.id, 'b');
  assert.equal(findTikTokPost(db, OTHER_ID), null);
});

/* ---------- The input bar: TikTok link → caption → Confirm place ---------- */

const { startAdd } = await import('../web/js/router.js');
const { wireConfirm } = await import('../web/js/confirm.js');
const { store, normalizeDb } = await import('../web/js/store.js');

function fakeUi() {
  const toasts = [];
  return { toasts, ui: { toast: (text, kind) => toasts.push([text, kind]), hideToast: () => {} } };
}

/** A document just big enough for the confirm dialog (as in addflow.test.mjs); no preview map. */
function confirmDocument() {
  const descendants = (n) => (n.children || []).flatMap((c) => [c, ...descendants(c)]);
  const make = (tag = '') => {
    const on = {};
    return {
      tag, hidden: false, open: false, disabled: false, checked: false, value: '', textContent: '', innerHTML: '', scrollTop: 0,
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [],
      setAttribute() {}, focus() {}, select() {},
      appendChild(kid) { this.children.push(kid); return kid; },
      append(...kids) { this.children.push(...kids); },
      replaceChildren(...kids) { this.children = kids; },
      querySelector(sel) {
        return sel === 'input:checked' ? descendants(this).find((n) => n.tag === 'input' && n.checked) || null : make();
      },
      querySelectorAll: () => [],
      addEventListener(type, fn) { (on[type] ??= []).push(fn); },
      fire(type) { for (const fn of on[type] || []) fn({ preventDefault() {} }); },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire('close'); },
    };
  };
  const els = new Map();
  return {
    getElementById: (id) => (id === 'confirm-map' ? null : els.get(id) ?? els.set(id, make()).get(id)),
    createElement: (tag) => make(tag), createTextNode: () => ({}), querySelectorAll: () => [],
  };
}

/** The place search answers with one synthetic place. */
const PHOTON = { features: [{ geometry: { coordinates: [11.3426, 44.4949] },
  properties: { name: 'Trattoria Sintetica', city: 'Bologna', country: 'Italy', countrycode: 'IT', osm_key: 'amenity', osm_value: 'restaurant' } }] };

/** fetch for oEmbed (`oembed`), the Worker's /api/resolve (`resolve`) and the place search. */
function appFetch({ oembed = () => jsonResponse(oembedAnswer({ title: 'Lunch 📍 Trattoria Sintetica, Bologna 🇮🇹 #foodtok #bologna' })), resolve } = {}) {
  return stubFetch((url) => {
    if (url.startsWith(TIKTOK_OEMBED)) return oembed(url);
    if (url.startsWith('/api/resolve')) return resolve ? jsonResponse(resolve(url)) : assert.fail(`no resolve expected: ${url}`);
    if (url.includes('photon')) return jsonResponse(PHOTON);
    return jsonResponse([]);
  });
}

async function withConfirm(fn) {
  const doc = confirmDocument();
  globalThis.document = doc;
  store.db = normalizeDb({});
  try {
    return await fn(doc);
  } finally {
    delete globalThis.document;
    clearTimeout(store._saveTimer);
    store._saveTimer = null;
  }
}

test('the input bar: a TikTok video opens Confirm place with its caption, hashtags as tags and the posted day; Drop pin keeps the link', async () => {
  await withConfirm(async (doc) => {
    const fetch = appFetch();
    globalThis.fetch = fetch;
    const looks = [];
    const { toasts, ui } = fakeUi();
    const appEnv = { ...ui, redraw() {}, inputDone() {}, pinwheel: (l) => looks.push(l), showUnsupported: () => assert.fail('a supported link') };
    wireConfirm(appEnv);
    await startAdd(`Look at this! ${VIDEO}?is_from_webapp=1`, appEnv);
    assert.deepEqual(toasts[0], ['Reading the video …', 'busy']);
    assert.equal(fetch.calls[0], oembedUrl(VIDEO), 'oEmbed straight from the phone');
    assert.ok(!fetch.calls.some((u) => u.startsWith('/api/')), 'no Worker');
    assert.equal(doc.getElementById('dlg-confirm').open, true);
    assert.equal(doc.getElementById('confirm-user').textContent, `@${USER}`);
    assert.match(doc.getElementById('confirm-caption').textContent, /Trattoria Sintetica/);
    assert.equal(doc.getElementById('confirm-error').hidden, true);
    const suggested = doc.getElementById('confirm-tags-suggested').children.map((li) => li.children[0].textContent);
    assert.ok(suggested.includes('#foodtok'), suggested.join(' '));
    assert.ok(fetch.calls.some((u) => u.includes('photon') && u.includes('Trattoria')), 'the caption\'s place is searched');
    assert.equal(doc.getElementById('confirm-title').value, 'Trattoria Sintetica');
    assert.equal(looks.length, 0);

    doc.getElementById('confirm-save').fire('click');
    assert.equal(store.db.pins.length, 1);
    const pin = store.db.pins[0];
    assert.equal(pin.source, 'tiktok');
    assert.equal(store.pinColor(pin), '#5a5f8f');
    assert.equal(pin.posts.length, 1);
    assert.equal(pin.posts[0].url, VIDEO);
    assert.equal(pin.posts[0].username, USER);
    assert.equal(pin.posts[0].postedAt, '2026-10-12');
    assert.match(pin.posts[0].caption, /#foodtok/);
    assert.deepEqual(looks, [{ logo: '', caption: 'TikTok' }]);
  });
});

test('the input bar: a short link oEmbed refuses goes through the Worker\'s /api/resolve, then oEmbed again', async () => {
  await withConfirm(async (doc) => {
    const short = 'https://vm.tiktok.com/ZMsynth01/';
    const fetch = appFetch({
      oembed: (url) => (url === oembedUrl(short) ? REFUSED() : jsonResponse(oembedAnswer())),
      resolve: () => ({ ok: true, url: `https://www.tiktok.com/@/video/${ID}?_r=1` }),
    });
    globalThis.fetch = fetch;
    const { ui } = fakeUi();
    await startAdd(short, { ...ui, showUnsupported: () => assert.fail('a supported link') });
    assert.deepEqual(fetch.calls.slice(0, 3), [
      oembedUrl(short), `/api/resolve?url=${encodeURIComponent(short)}`, oembedUrl(`https://www.tiktok.com/@/video/${ID}`),
    ]);
    assert.equal(doc.getElementById('dlg-confirm').open, true);
  });
});

test('the input bar: a dead short link, or a TikTok link that is no video, gets an error toast and no dialog', async () => {
  for (const [text, routes] of [
    ['https://vm.tiktok.com/ZMsynth01/', { oembed: REFUSED, resolve: () => ({ ok: true, url: 'https://www.tiktok.com/?_r=1' }) }],
    [`https://www.tiktok.com/@${USER}`, { oembed: () => assert.fail('nothing to ask for a profile') }],
    ['https://www.tiktok.com/tag/foodtok', { oembed: () => assert.fail('nothing to ask for a hashtag') }],
  ]) {
    await withConfirm(async (doc) => {
      globalThis.fetch = appFetch(routes);
      const { toasts, ui } = fakeUi();
      await startAdd(text, { ...ui, showUnsupported: () => assert.fail('a supported link') });
      assert.equal(doc.getElementById('dlg-confirm').open, false, text);
      assert.equal(toasts.at(-1)[1], 'error', text);
    });
  }
});

test('the input bar: oEmbed refusing a video still opens Confirm place, with the notice and TikTok\'s embed', async () => {
  await withConfirm(async (doc) => {
    globalThis.fetch = appFetch({ oembed: REFUSED });
    const { ui } = fakeUi();
    await startAdd(VIDEO, ui);
    assert.equal(doc.getElementById('dlg-confirm').open, true);
    assert.equal(doc.getElementById('confirm-error').hidden, false);
    assert.equal(doc.getElementById('confirm-error-title').textContent, 'Could not read the TikTok text');
    assert.match(doc.getElementById('confirm-error-text').textContent, /private or deleted/);
    assert.match(doc.getElementById('confirm-embed').innerHTML, new RegExp(`src="https://www\\.tiktok\\.com/embed/v2/${ID}"`));
  });
});

test('the input bar: a TikTok video already on a pin opens that pin, before and after expanding a short link', async () => {
  for (const [text, routes] of [
    [`https://m.tiktok.com/v/${ID}.html`, { oembed: () => assert.fail('known already') }],
    ['https://vt.tiktok.com/ZSsynth02/', {}],
  ]) {
    const fetch = appFetch(routes);
    globalThis.fetch = fetch;
    store.db = normalizeDb({ pins: [{ id: 'saved', lat: 1, lon: 2, title: 'Saved place', posts: [{ url: `https://www.tiktok.com/@old.name/video/${ID}` }] }] });
    const { toasts, ui } = fakeUi();
    const detail = [];
    await startAdd(text, { ...ui, showDetail: (id) => detail.push(id), showUnsupported: () => assert.fail('a supported link') });
    assert.match(toasts.at(-1)[0], /already saved this post: "Saved place"/, text);
    assert.deepEqual(detail, ['saved'], text);
  }
});

test('the input bar takes one TikTok video; with another link it goes to Settings → Import, where the video is read into the list', async () => {
  const LL_LINK = 'https://maps.apple.com/?ll=48.1371,11.5754&q=Synthetic%20Cafe';
  for (const text of [`${VIDEO}\nhttps://vm.tiktok.com/ZMsynth01/`, `${LL_LINK}\n${VIDEO}`]) {
    globalThis.fetch = stubFetch(() => assert.fail('nothing fetched'));
    const { toasts, ui } = fakeUi();
    const handed = [];
    await startAdd(text, { ...ui, showImport: () => assert.fail('no import from the input bar'), importPaste: (t) => handed.push(t) });
    assert.deepEqual(handed, [text], text);
    assert.deepEqual(toasts, [], text);
  }
  const { addFromSettings } = await import('../web/js/batch.js');
  store.db = normalizeDb({});
  globalThis.fetch = appFetch();
  const { ui } = fakeUi();
  const imports = [];
  await addFromSettings({ value: `${LL_LINK}\n${VIDEO}` }, { ...ui, showImport: (e) => imports.push(e) }, () => {});
  const [cafe, video] = imports[0];
  assert.equal(cafe.name, 'Synthetic Cafe');
  assert.deepEqual([video.name, video.source, video.checked, video.check, video.post.url], ['Trattoria Sintetica', 'tiktok', false, true, VIDEO]);
  assert.match(video.warning, /^Check this place/);
});

/* ---------- The pin's posts ---------- */

test('Remove post on a TikTok post removes only that post', () => {
  store.db = normalizeDb({ pins: [{ id: 'p', lat: 1, lon: 2, title: 'X', posts: [
    { url: VIDEO }, { url: `https://www.tiktok.com/@${USER}/video/${OTHER_ID}` }, { url: 'https://www.instagram.com/p/ABC123/' },
  ] }] });
  try {
    store.removePost('p', VIDEO);
    assert.deepEqual(store.pin('p').posts.map((x) => x.url), [`https://www.tiktok.com/@${USER}/video/${OTHER_ID}`, 'https://www.instagram.com/p/ABC123/']);
  } finally {
    clearTimeout(store._saveTimer);
    store._saveTimer = null;
  }
});

/* ---------- The post key tt:<id> (dedupe.js, store.js) ---------- */

const { postKey, findPost, buildIndex } = await import('../web/js/dedupe.js');
const { mergeDb } = await import('../web/js/store.js');

test('postKey: a TikTok video or photo is "tt:<id>", whatever link form; short links and profiles have none', () => {
  assert.equal(postKey(VIDEO), `tt:${ID}`);
  assert.equal(postKey(`https://m.tiktok.com/v/${ID}.html`), `tt:${ID}`);
  assert.equal(postKey(`https://www.tiktok.com/@${USER}/photo/${ID}?is_from_webapp=1`), `tt:${ID}`);
  assert.equal(postKey(`https://www.tiktok.com/embed/v2/${ID}`), `tt:${ID}`);
  assert.equal(postKey('https://vm.tiktok.com/ZMsynth01/'), null);
  assert.equal(postKey(`https://www.tiktok.com/@${USER}`), null);
});

test('findPost, buildIndex and attachPost know a TikTok video saved before, also from data without the key', () => {
  // Pins saved before the key existed carry shortcode: '' (makePost had no key for TikTok).
  const db = buildIndex(normalizeDb({ pins: [
    { id: 'a', lat: 1, lon: 2, title: 'Old', posts: [{ url: `https://www.tiktok.com/@old.name/video/${ID}`, shortcode: '' }] },
  ] }));
  assert.equal(db.postIndex[`tt:${ID}`], 'a');
  assert.equal(findPost(db, `https://www.tiktok.com/@${USER}/photo/${ID}`)?.pin.id, 'a');
  assert.equal(db.pins[0].posts[0].shortcode, `tt:${ID}`, 'old data gets the key when it is read');
  store.db = db;
  try {
    store.attachPost('a', { url: VIDEO });
    assert.equal(store.pin('a').posts.length, 1, 'the same video in another link form is not added again');
    store.attachPost('a', { url: `https://www.tiktok.com/@${USER}/video/${OTHER_ID}` });
    assert.equal(store.pin('a').posts.length, 2);
    assert.equal(store.pin('a').posts[1].shortcode, `tt:${OTHER_ID}`);
    store.removePost('a', `https://m.tiktok.com/v/${ID}.html`);
    assert.deepEqual(store.pin('a').posts.map((x) => x.shortcode), [`tt:${OTHER_ID}`], 'removed by its key');
  } finally {
    clearTimeout(store._saveTimer);
    store._saveTimer = null;
  }
});

test('mergeDb: a backup pin whose TikTok video is already saved elsewhere is skipped, old data included', () => {
  const local = normalizeDb({ pins: [{ id: 'a', lat: 1, lon: 2, title: 'Here', posts: [{ url: VIDEO, shortcode: '' }] }] });
  local.pins[0].posts[0].shortcode = ''; // as an app before the key kept it
  const incoming = { pins: [{ id: 'b', lat: 5, lon: 6, title: 'There', posts: [{ url: `https://www.tiktok.com/@x/photo/${ID}`, shortcode: '' }] }] };
  const { db, skipped } = mergeDb(local, incoming);
  assert.equal(skipped, 1);
  assert.deepEqual(db.pins.map((p) => p.id), ['a']);
});
