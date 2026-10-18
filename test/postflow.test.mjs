// test/postflow.test.mjs — YouTube and Facebook links in the app: post keys, and link → /api/post → Confirm place.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { startAdd, wireConfirm } = await import('../web/js/addflow.js');
const { store, normalizeDb, mergeDb } = await import('../web/js/store.js');
const { postKey, findPost, buildIndex } = await import('../web/js/dedupe.js');

const YT = 'AbCdEfGh_-1';
const WATCH = `https://www.youtube.com/watch?v=${YT}`;
const REEL = 'https://www.facebook.com/reel/987654321098765/';

/* ---------- Post keys (dedupe.js, store.js) ---------- */

test('postKey: Instagram stays the bare shortcode; YouTube yt:<id>, Facebook posts fb:<id>; share links and pages none', () => {
  assert.equal(postKey('https://www.instagram.com/p/ABC123xyz/'), 'ABC123xyz');
  assert.equal(postKey(`https://youtu.be/${YT}?si=x`), `yt:${YT}`);
  assert.equal(postKey(WATCH), `yt:${YT}`);
  assert.equal(postKey(REEL), 'fb:987654321098765');
  assert.equal(postKey('https://www.facebook.com/share/r/SynThCode1/'), null);
  assert.equal(postKey('https://www.facebook.com/SyntheticCafe'), null);
  assert.equal(postKey('https://example.com/p/abc'), null);
});

test('findPost and buildIndex know YouTube and Facebook posts, whatever form the link has', () => {
  const db = buildIndex(normalizeDb({ pins: [
    { id: 'a', lat: 1, lon: 2, title: 'Video place', posts: [{ url: WATCH }] },
    { id: 'b', lat: 3, lon: 4, title: 'Reel place', posts: [{ url: REEL }] },
  ] }));
  assert.equal(db.postIndex[`yt:${YT}`], 'a');
  assert.equal(db.postIndex['fb:987654321098765'], 'b');
  assert.equal(findPost(db, `https://youtu.be/${YT}?si=x`)?.pin.id, 'a');
  assert.equal(findPost(db, `https://m.youtube.com/shorts/${YT}`)?.pin.id, 'a');
  assert.equal(findPost(db, 'https://m.facebook.com/reel/987654321098765/?mibextid=x')?.pin.id, 'b');
  assert.equal(findPost(db, 'https://www.youtube.com/watch?v=ZzZzZzZzZz9'), null);
  assert.equal(db.pins[0].posts[0].shortcode, `yt:${YT}`, 'the key is stored with the post');
});

test('attachPost keeps one copy of a video; removePost removes only that post', () => {
  store.db = normalizeDb({ pins: [{ id: 'p', lat: 1, lon: 2, title: 'Spot', posts: [
    { url: 'https://www.instagram.com/p/ABC123xyz/' }, { url: WATCH }, { url: REEL },
  ] }] });
  try {
    store.attachPost('p', { url: `https://youtu.be/${YT}` });
    assert.equal(store.pin('p').posts.length, 3, 'the same video in another link form is not added again');
    store.removePost('p', `https://youtu.be/${YT}`);
    assert.deepEqual(store.pin('p').posts.map((x) => x.url), ['https://www.instagram.com/p/ABC123xyz/', REEL]);
    store.attachPost('p', { url: 'https://www.facebook.com/share/r/SynThCode1/' });
    store.attachPost('p', { url: 'https://www.facebook.com/share/r/SynThCode2/' });
    store.removePost('p', 'https://www.facebook.com/share/r/SynThCode1/');
    assert.deepEqual(store.pin('p').posts.map((x) => x.url),
      ['https://www.instagram.com/p/ABC123xyz/', REEL, 'https://www.facebook.com/share/r/SynThCode2/'], 'a post without a key goes by its link');
  } finally {
    clearTimeout(store._saveTimer);
    store._saveTimer = null;
  }
});

test('mergeDb: a new pin whose YouTube video is already saved elsewhere is skipped', () => {
  const local = normalizeDb({ pins: [{ id: 'a', lat: 1, lon: 2, title: 'Here', posts: [{ url: WATCH }] }] });
  const incoming = { pins: [{ id: 'b', lat: 5, lon: 6, title: 'There', posts: [{ url: `https://youtu.be/${YT}` }] }] };
  const { db, skipped } = mergeDb(local, incoming);
  assert.equal(skipped, 1);
  assert.deepEqual(db.pins.map((p) => p.id), ['a']);
});

/* ---------- The add flow ---------- */

/** Stands in for the ticket worker: answers at once (the stubbed /api/post checks no ticket). */
class InstantTicketWorker {
  postMessage() { setTimeout(() => this.onmessage({ data: { nonce: 7 } })); }
  terminate() {}
}

/** A document just big enough for the confirm dialog; without #confirm-map the preview map stays off. */
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

const feature = (name, lat, lon) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { name, city: 'Testopoli', countrycode: 'IT', osm_key: 'amenity', osm_value: 'restaurant' },
});

/**
 * Stubs the network: /api/post answers `post` (status `postStatus`), YouTube's oEmbed `oembed`
 * (404 when null), Photon `places(query)`. Returns every requested address.
 */
function stubNetwork({ post = { ok: false, reason: 'not-found', message: "Couldn't read this video." }, postStatus = 200, oembed = null, places = () => [] }) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('/api/post?')) return json(post, postStatus);
    if (u.startsWith('https://www.youtube.com/oembed?')) return oembed ? json(oembed) : new Response('Not Found', { status: 404 });
    if (u.startsWith('https://photon.komoot.io/')) return json({ features: places(new URL(u).searchParams.get('q')) });
    if (u.startsWith('https://nominatim.openstreetmap.org/')) return json([]);
    return new Response('nothing', { status: 404 });
  };
  return calls;
}

/** Runs `fn` with a fresh confirm dialog, an empty collection and the instant ticket worker. */
async function withConfirm(fn, pins = []) {
  const doc = confirmDocument();
  globalThis.document = doc;
  globalThis.Worker = InstantTicketWorker;
  store.db = normalizeDb({ pins });
  const toasts = [];
  const looks = [];
  const details = [];
  const env = {
    toast: (text, kind) => toasts.push([text, kind]), hideToast() {}, redraw() {}, inputDone() {},
    pinwheel: (look) => looks.push(look), showDetail: (id) => details.push(id),
    showUnsupported: () => assert.fail('YouTube and Facebook links are supported'),
  };
  wireConfirm(env);
  try {
    await fn({ doc, env, toasts, looks, details, el: (id) => doc.getElementById(id) });
  } finally {
    delete globalThis.document;
    delete globalThis.Worker;
    clearTimeout(store._saveTimer);
    store._saveTimer = null;
  }
}

const VIDEO = {
  ok: true, kind: 'youtube', url: WATCH, title: 'Pasta in Testopoli',
  text: 'We ate carbonara at Trattoria Sintetica.\nSubscribe for more!\nFollow me on Synthgram', author: 'Synthetic Channel',
  publishedAt: '2026-03-14', thumb: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
  location: { name: 'Trattoria Sintetica', address: 'Via Finta, 1, 00000 Testopoli, Italy', placeId: 'ChIJSyntheticPlaceId0000001' },
};

test('YouTube: the description and the location tag; the tag with its address is searched first, the pin keeps the video', async () => {
  await withConfirm(async ({ el, env, toasts, looks }) => {
    const calls = stubNetwork({ post: VIDEO, places: (q) => (q.includes('Via Finta') ? [feature('Trattoria Sintetica', 40.85, 14.26)] : []) });
    await startAdd(`Watch this: https://youtu.be/${YT}?si=SyntheticShare`, env);
    const post = calls.find((u) => u.startsWith('/api/post?'));
    const q = new URL(post, 'https://opin.example').searchParams;
    assert.equal(q.get('url'), `https://youtu.be/${YT}?si=SyntheticShare`);
    assert.match(q.get('m'), /^\d+$/);
    assert.equal(q.get('n'), '7');
    assert.deepEqual(toasts[0], ['Reading the video …', 'busy']);
    assert.equal(el('dlg-confirm').open, true);
    assert.equal(el('confirm-user').textContent, 'Synthetic Channel', 'a channel name, no "@"');
    assert.match(el('confirm-caption').textContent, /^Pasta in Testopoli\n\nWe ate carbonara/);
    assert.equal(el('confirm-thumb').src, `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`);
    const searched = calls.filter((u) => u.startsWith('https://photon')).map((u) => new URL(u).searchParams.get('q'));
    assert.equal(searched[0], 'Trattoria Sintetica, Via Finta, 1, 00000 Testopoli, Italy');
    assert.equal(searched[1], 'Trattoria Sintetica');
    assert.ok(!searched.some((s) => /Synthgram/.test(s)), 'nothing from below "Subscribe"');
    assert.equal(el('confirm-title').value, 'Trattoria Sintetica');
    assert.equal(el('confirm-error').hidden, true);

    el('confirm-save').fire('click');
    const [pin] = store.db.pins;
    assert.equal(pin.source, 'youtube');
    assert.equal(pin.title, 'Trattoria Sintetica');
    assert.equal(pin.lat, 40.85);
    assert.deepEqual(pin.posts.map((p) => [p.url, p.username, p.postedAt, p.shortcode]), [[WATCH, 'Synthetic Channel', '2026-03-14', `yt:${YT}`]]);
    assert.equal(pin.color, undefined, 'Auto: YouTube\'s colour');
    assert.deepEqual(looks, [{ logo: '/icons/sources/youtube.png', caption: '' }]);
  });
});

test('YouTube: when the Worker can\'t read the video, the title comes from YouTube\'s oEmbed, without an error box', async () => {
  await withConfirm(async ({ el, env }) => {
    const calls = stubNetwork({
      oembed: { title: 'Gelato at Synthetic Square, Testopoli', author_name: 'Synthetic Channel', thumbnail_url: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg` },
      places: () => [feature('Synthetic Square', 40.8, 14.2)],
    });
    await startAdd(`https://www.youtube.com/shorts/${YT}`, env);
    const oembed = calls.find((u) => u.startsWith('https://www.youtube.com/oembed?'));
    assert.equal(new URL(oembed).searchParams.get('url'), WATCH);
    assert.equal(el('confirm-error').hidden, true);
    assert.equal(el('confirm-caption').textContent, 'Gelato at Synthetic Square, Testopoli');
    assert.equal(el('confirm-user').textContent, 'Synthetic Channel');
    assert.ok(calls.some((u) => u.startsWith('https://photon')), 'candidates from the title');
  });
});

test('YouTube: when oEmbed fails too, the error box names YouTube and shows the video without cookies', async () => {
  await withConfirm(async ({ el, env }) => {
    stubNetwork({ post: { ok: false, reason: 'http-429', message: "Couldn't read this video." } });
    await startAdd(`https://youtu.be/${YT}`, env);
    assert.equal(el('confirm-error').hidden, false);
    assert.equal(el('confirm-error-title').textContent, 'Could not read the YouTube video');
    assert.equal(el('confirm-error-text').textContent, "Couldn't read this video.");
    assert.match(el('confirm-embed').innerHTML, new RegExp(`src="https://www\\.youtube-nocookie\\.com/embed/${YT}"`));
    assert.equal(el('dlg-confirm').open, true);
  });
});

test('Facebook page: exact coordinates and address from the page, no place search; the page link goes in the note', async () => {
  await withConfirm(async ({ el, env, looks }) => {
    const calls = stubNetwork({ post: {
      ok: true, kind: 'facebook-page', url: 'https://www.facebook.com/SyntheticCafe/', title: 'Synthetic Cafe', text: '',
      location: { name: 'Synthetic Cafe', lat: 48.1234567, lon: 11.7654321, address: 'Testweg 1, 12345 Testhausen, Germany' },
    } });
    await startAdd('https://m.facebook.com/SyntheticCafe', env);
    assert.deepEqual(calls.filter((u) => !u.startsWith('/api/post?')), [], 'nothing searched');
    assert.equal(el('confirm-title').value, 'Synthetic Cafe');
    assert.equal(el('confirm-note').value, 'https://www.facebook.com/SyntheticCafe/');
    assert.equal(el('confirm-coords').textContent, '48.12346, 11.76543');
    el('confirm-save').fire('click');
    const [pin] = store.db.pins;
    assert.deepEqual([pin.source, pin.title, pin.address, pin.note, pin.posts.length],
      ['facebook', 'Synthetic Cafe', 'Testweg 1, 12345 Testhausen, Germany', 'https://www.facebook.com/SyntheticCafe/', 0]);
    assert.deepEqual(looks, [{ logo: '/icons/sources/facebook.png', caption: '' }]);
  });
});

test('Facebook post: its text gives the candidates; the pin keeps the post under its canonical link', async () => {
  await withConfirm(async ({ el, env }) => {
    const calls = stubNetwork({
      post: { ok: true, kind: 'facebook', url: REEL, title: '', text: 'Sunset dinner 📍 Seehaus Sintetico, Testhausen #lake', author: 'Synthetic Page', publishedAt: '2026-03-14' },
      places: (q) => (q.startsWith('Seehaus Sintetico') ? [feature('Seehaus Sintetico', 47.9, 11.4)] : []),
    });
    await startAdd('https://www.facebook.com/share/r/SynThCode1/', env);
    assert.equal(new URL(calls[0], 'https://opin.example').searchParams.get('url'), 'https://www.facebook.com/share/r/SynThCode1/');
    assert.equal(el('confirm-user').textContent, 'Synthetic Page');
    assert.equal(el('confirm-title').value, 'Seehaus Sintetico');
    el('confirm-save').fire('click');
    const [pin] = store.db.pins;
    assert.equal(pin.source, 'facebook');
    assert.deepEqual(pin.posts.map((p) => [p.url, p.shortcode, p.caption]), [[REEL, 'fb:987654321098765', 'Sunset dinner 📍 Seehaus Sintetico, Testhausen #lake']]);
  });
});

test('a video or post saved before: says so before asking the Worker, or once the share link turned out to be it', async () => {
  const pins = [{ id: 'saved', lat: 1, lon: 2, title: 'Saved place', posts: [{ url: WATCH }, { url: REEL }] }];
  await withConfirm(async ({ env, toasts, details, el }) => {
    const calls = stubNetwork({});
    await startAdd(`https://youtu.be/${YT}?si=x`, env);
    assert.deepEqual(calls, []);
    assert.match(toasts.at(-1)[0], /already saved this post: "Saved place"/);
    assert.deepEqual(details, ['saved']);

    stubNetwork({ post: { ok: true, kind: 'facebook', url: REEL, title: '', text: 'Again', author: 'Synthetic Page' } });
    await startAdd('https://fb.watch/SynThW1/', env);
    assert.match(toasts.at(-1)[0], /already saved this post/);
    assert.deepEqual(details, ['saved', 'saved']);
    assert.equal(el('dlg-confirm').open, false);
  }, pins);
});

test('a YouTube link that is no video, or a Facebook link that is no post or page: an error toast, nothing fetched', async () => {
  await withConfirm(async ({ env, toasts }) => {
    const calls = stubNetwork({});
    await startAdd('https://www.youtube.com/@synthetic.channel', env);
    assert.deepEqual(toasts.at(-1), ["This YouTube link isn't a video.", 'error']);
    await startAdd('https://www.facebook.com/groups/', env);
    assert.deepEqual(toasts.at(-1), ["This Facebook link isn't a public post, reel or page.", 'error']);
    assert.deepEqual(calls, []);
  });
});

test('a Facebook page the Worker can\'t read: an error toast, no dialog', async () => {
  await withConfirm(async ({ env, toasts, el }) => {
    stubNetwork({ post: { ok: false, reason: 'login', message: "Couldn't read this Facebook page." } });
    await startAdd('https://www.facebook.com/SyntheticCafe', env);
    assert.deepEqual(toasts.at(-1), ["Couldn't read this Facebook page.", 'error']);
    assert.equal(el('dlg-confirm').open, false);
  });
});
