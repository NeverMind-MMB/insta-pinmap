// test/batch.test.mjs — Settings → Import takes posts too: read one after another, one row each (web/js/batch.js, postflow.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { addFromSettings, BATCH_PACE, pasteItems } = await import('../web/js/batch.js');
const { READ_TIMEOUT } = await import('../web/js/postflow.js');
const { store, normalizeDb } = await import('../web/js/store.js');

/* All names, codes and places are made up. */
const IG_TAGGED = 'https://www.instagram.com/p/SynthTag001/';
const IG_TEXT = 'https://www.instagram.com/p/SynthTxt002/';
const IG_NOTHING = 'https://www.instagram.com/p/SynthNil003/';
const YT = 'AbCdEfGh_-1';
const LL_LINK = 'https://maps.apple.com/?ll=48.1371,11.5754&q=Synthetic%20Cafe';

/** The work ticket is solved in a Web Worker; here it answers at once. */
globalThis.Worker = class {
  postMessage() { queueMicrotask(() => this.onmessage({ data: { nonce: 1 } })); }
  terminate() {}
};
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
})();

const feature = (name, lat, lon) => ({
  geometry: { coordinates: [lon, lat] },
  properties: { name, city: 'Testtown', country: 'Testland', countrycode: 'TL', osm_key: 'amenity', osm_value: 'cafe' },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const IG_ANSWERS = {
  SynthTag001: { ok: true, shortcode: 'SynthTag001', username: 'synthetic.user', caption: 'Lunch!', locationTag: { name: 'Synthetic Bistro', lat: 47.5, lon: 9.7, address: 'Teststraße 1' } },
  SynthTxt002: { ok: true, shortcode: 'SynthTxt002', username: 'synthetic.user', caption: '📍 Harbour Cafe, Testtown' },
  SynthNil003: { ok: true, shortcode: 'SynthNil003', username: 'synthetic.user', caption: 'Nice day' },
};

/**
 * /api/ig answers IG_ANSWERS (or `ig(code)`), /api/post `post`, Photon `places(q)` ('hang': never).
 * Records every request with the time it started.
 */
function stubNetwork({ ig = (code) => json(IG_ANSWERS[code] || { ok: false, reason: 'not-found', message: 'Gone.' }), post = null, places = () => [] } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push({ u, at: Date.now() });
    if (u.startsWith('/api/ig')) return ig(new URL(u, 'https://app.example').searchParams.get('code'));
    if (u.startsWith('/api/post')) return json(post || { ok: false, reason: 'not-found', message: "Couldn't read this video." });
    if (u.startsWith('https://www.youtube.com/oembed')) return new Response('', { status: 404 });
    if (u.includes('photon')) {
      const found = places(new URL(u).searchParams.get('q'));
      return found === 'hang' ? new Promise(() => {}) : json({ features: found });
    }
    return json([]);
  };
  return calls;
}

async function importInSettings(text, { pins = [] } = {}) {
  store.db = normalizeDb({ pins });
  const toasts = [];
  const opened = [];
  const field = { value: text };
  await addFromSettings(field, {
    toast: (t, kind) => toasts.push([t, kind]), hideToast() {},
    showImport: (e, n, g, notes) => opened.push({ e, n, g, notes }),
    showUnsupported: (...args) => opened.push({ unsupported: args }),
  }, () => {});
  return { opened, toasts, field };
}

const saved = { gapMs: BATCH_PACE.gapMs, limitWaitMs: BATCH_PACE.limitWaitMs };
const quick = () => Object.assign(BATCH_PACE, { gapMs: 0, limitWaitMs: 0 });
const restore = () => Object.assign(BATCH_PACE, saved);

test('posts in Settings → Import: the tagged place checked, the text\'s best match unchecked to check, a post without a place a row with the reason', async () => {
  quick();
  try {
    stubNetwork({ places: (q) => (q.startsWith('Harbour Cafe') ? [feature('Harbour Cafe', 48.2, 11.6)] : []) });
    const { opened, toasts, field } = await importInSettings([IG_TAGGED, IG_TEXT, IG_NOTHING, LL_LINK].join('\n'));
    const { e, n } = opened[0];
    assert.deepEqual(e.map((r) => [r.name, r.checked, Boolean(r.check), Boolean(r.unplaced)]), [
      ['Synthetic Bistro', true, false, false],
      ['Harbour Cafe', false, true, false],
      ['Instagram post by @synthetic.user', false, false, true],
      ['Synthetic Cafe', undefined, false, false],
    ]);
    assert.deepEqual([e[0].lat, e[0].lon, e[0].source, e[0].post.url], [47.5, 9.7, 'instagram', IG_TAGGED]);
    assert.match(e[0].warning, /location tag/);
    assert.match(e[1].warning, /^Check this place: found for "Harbour Cafe/);
    assert.equal(e[1].post.url, IG_TEXT, 'the post stays with its row');
    assert.match(e[2].warning, /found nothing for the post's text|No place found/);
    assert.equal(e[2].url, IG_NOTHING, 'its link, to open it');
    assert.equal(n, '');
    assert.equal(field.value, '');
    assert.deepEqual(toasts.map(([t]) => t), ['Reading 1 of 3 …', 'Reading 2 of 3 …', 'Reading 3 of 3 …']);
    assert.equal(store.db.pins.length, 0, 'nothing saved before Import selected');
  } finally {
    restore();
  }
});

test('posts are read one after another, each Worker route at most once per BATCH_PACE gap; the same post twice is read once', async () => {
  Object.assign(BATCH_PACE, { gapMs: 60, limitWaitMs: 0 });
  try {
    let open = 0;
    let most = 0;
    const calls = stubNetwork({
      ig: async (code) => {
        open++;
        most = Math.max(most, open);
        await new Promise((r) => setTimeout(r, 5));
        open--;
        return json(IG_ANSWERS[code]);
      },
    });
    const { opened } = await importInSettings([IG_TAGGED, `${IG_TAGGED}?igsh=share`, 'https://instagram.com/reel/SynthTxt002', IG_NOTHING].join('\n'));
    const asked = calls.filter((c) => c.u.startsWith('/api/ig'));
    assert.equal(asked.length, 3, 'the repeat is not read again');
    assert.equal(most, 1, 'never two at once');
    for (let i = 1; i < asked.length; i++) assert.ok(asked[i].at - asked[i - 1].at >= 55, `gap ${asked[i].at - asked[i - 1].at} ms`);
    assert.deepEqual(opened[0].e.map((r) => r.url), [IG_TAGGED, 'https://www.instagram.com/p/SynthTxt002/', IG_NOTHING]);
  } finally {
    restore();
  }
});

test('"too many requests" from the Worker: the import waits, then tries that post once more', async () => {
  quick();
  try {
    let first = true;
    const calls = stubNetwork({
      ig: (code) => {
        if (first) {
          first = false;
          return json({ ok: false, reason: 'rate-limit', message: 'Too many requests. Wait a minute and try again.' }, 429);
        }
        return json(IG_ANSWERS[code]);
      },
    });
    const { opened, toasts } = await importInSettings(`${IG_TAGGED}\n${LL_LINK}`);
    assert.equal(calls.filter((c) => c.u.startsWith('/api/ig')).length, 2);
    assert.equal(opened[0].e[0].name, 'Synthetic Bistro');
    assert.ok(toasts.some(([t]) => /waiting a minute/.test(t)), JSON.stringify(toasts));
  } finally {
    restore();
  }
});

test('a post already on a pin is a row that says so; a place search that hangs never holds up the import', async () => {
  quick();
  const timeout = READ_TIMEOUT.ms;
  READ_TIMEOUT.ms = 30;
  try {
    stubNetwork({ places: () => 'hang' });
    const pins = [{ id: 'p1', lat: 1, lon: 2, title: 'Saved place', posts: [{ url: IG_TAGGED }] }];
    const { opened } = await importInSettings(`${IG_TAGGED}\n${IG_TEXT}`, { pins });
    const [known, slow] = opened[0].e;
    assert.deepEqual([known.unplaced, known.warning], [true, 'Already saved: "Saved place".']);
    assert.deepEqual([slow.unplaced, slow.warning], [true, 'The place search took too long.']);
  } finally {
    READ_TIMEOUT.ms = timeout;
    restore();
  }
});

test('a YouTube video whose location tag is found by its address is checked: the tag counts as the tagged place', async () => {
  quick();
  try {
    stubNetwork({
      post: { ok: true, kind: 'youtube', url: `https://www.youtube.com/watch?v=${YT}`, title: 'Pasta day', text: 'We ate at Trattoria Sintetica', author: 'Synthetic Channel',
        location: { name: 'Trattoria Sintetica', address: 'Via Finta 1, Testopoli' } },
      places: (q) => (q.includes('Via Finta') ? [feature('Trattoria Sintetica', 40.85, 14.26)] : []),
    });
    const { opened } = await importInSettings(`https://youtu.be/${YT}\n${LL_LINK}`);
    const [video] = opened[0].e;
    assert.deepEqual([video.name, video.checked, video.source, video.post.url], ['Trattoria Sintetica', true, 'youtube', `https://www.youtube.com/watch?v=${YT}`]);
  } finally {
    restore();
  }
});

test('only links of sites this version doesn\'t read: the unsupported dialog (naming every site), nothing imported, the text kept', async () => {
  stubNetwork();
  let r = await importInSettings('https://www.pinterest.com/pin/123456789/');
  assert.deepEqual(r.opened, [{ unsupported: ['https://www.pinterest.com/pin/123456789/'] }]);
  r = await importInSettings('https://www.pinterest.com/pin/1/\nhttps://vimeo.com/2');
  assert.deepEqual(r.opened, [{ unsupported: ['https://www.pinterest.com/pin/1/', 'Links from pinterest.com and vimeo.com', ''] }], 'several sites: no sentence as a GitHub search');
  assert.match(r.field.value, /vimeo/);
});

test('pasteItems: each different link once, and lines without a link that hold coordinates, a geo: link or a Plus Code', () => {
  const items = pasteItems([
    'My trip', LL_LINK, LL_LINK, '48.2001, 11.6001', 'geo:47.1,11.2', '8FWH4HX8+QH', 'Open 10.30 18.00', `${IG_TAGGED} and ${IG_TEXT}`,
  ].join('\n'));
  assert.deepEqual(items.map((i) => i.link || i.coords.kind), [LL_LINK, 'point', 'point', 'point', IG_TAGGED, IG_TEXT]);
});

/* ---------- A batch that runs: one at a time, stopped by closing Settings ---------- */

const { batchRunning, cancelBatch } = await import('../web/js/batch.js');

test('while a batch reads, a second Read is refused; closing Settings stops it before the next item, and no import list opens', async () => {
  quick();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = stubNetwork({ ig: async (code) => { await gate; return json(IG_ANSWERS[code]); } });
    store.db = normalizeDb({});
    const toasts = [];
    const opened = [];
    const env = { toast: (t, kind) => toasts.push([t, kind]), hideToast: () => toasts.push(['hidden']), showImport: (e) => opened.push(e) };
    const first = addFromSettings({ value: `${IG_TAGGED}\n${IG_TEXT}\n${LL_LINK}` }, env, () => {});
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(batchRunning(), true);
    const second = { value: LL_LINK };
    await addFromSettings(second, env, () => {});
    assert.match(toasts.at(-1)[0], /still being read/);
    assert.equal(second.value, LL_LINK, 'kept');
    cancelBatch(); // Settings closed
    release();
    await first;
    assert.equal(batchRunning(), false);
    assert.equal(calls.filter((c) => c.u.startsWith('/api/ig')).length, 1, 'the second post is not read');
    assert.deepEqual(opened, [], 'no import list after the stop');
    assert.deepEqual(toasts.at(-1), ['hidden'], 'the progress toast goes');
  } finally {
    restore();
  }
});

test('a finished batch never replaces an import list that is open by then', async () => {
  quick();
  try {
    stubNetwork();
    store.db = normalizeDb({});
    const toasts = [];
    const opened = [];
    const field = { value: `${LL_LINK}\n48.2001, 11.6001` };
    await addFromSettings(field, {
      toast: (t, kind) => toasts.push([t, kind]), hideToast() {}, showImport: (e) => opened.push(e), importOpen: () => true,
    }, () => {});
    assert.deepEqual(opened, []);
    assert.match(toasts.at(-1)[0], /import list is still open/);
    assert.match(field.value, /48\.2001/, 'the text stays for later');
  } finally {
    restore();
  }
});

test('Worker routes are paced in a batch too: /api/resolve and /api/list calls each at most once per BATCH_PACE gap', async () => {
  Object.assign(BATCH_PACE, { gapMs: 60, limitWaitMs: 0 });
  try {
    const calls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calls.push({ u, at: Date.now() });
      if (u.startsWith('/api/resolve')) return json({ ok: true, url: `https://www.google.com/maps/place/Synthetic+Spot/@45.4,9.2,17z/data=!3d45.${calls.length}!4d9.1` });
      if (u.startsWith('/api/list')) return json({ ok: true, title: 'L', total: 1, places: [{ name: `Synthetic ${calls.length}`, lat: 40 + calls.length, lon: 9 }] });
      return json([]);
    };
    await importInSettings([
      'https://maps.app.goo.gl/synthA', 'https://maps.app.goo.gl/synthB',
      'https://www.google.com/maps/placelists/list/SyntheticListId_000000001', 'https://www.google.com/maps/placelists/list/SyntheticListId_000000002',
    ].join('\n'));
    for (const route of ['/api/resolve', '/api/list']) {
      const at = calls.filter((c) => c.u.startsWith(route)).map((c) => c.at);
      assert.equal(at.length, 2, route);
      assert.ok(at[1] - at[0] >= 55, `${route}: gap ${at[1] - at[0]} ms`);
    }
  } finally {
    restore();
  }
});

test('"too many requests" from /api/post (YouTube, TikTok) is carried through: the row is read again a minute later, also when oEmbed filled in the text', async () => {
  quick();
  try {
    const TT_ID = '7561234567890123456';
    const tiktok = `https://www.tiktok.com/@synthetic.user/video/${TT_ID}`;
    const asked = { yt: 0, tt: 0 };
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('/api/post')) {
        const which = u.includes('youtu') ? 'yt' : 'tt';
        asked[which]++;
        if (asked[which] === 1) return json({ ok: false, reason: 'rate-limit', message: 'Too many requests. Wait a minute and try again.' }, 429);
        return json(which === 'yt'
          ? { ok: true, kind: 'youtube', url: `https://www.youtube.com/watch?v=${YT}`, title: 'Pasta', text: '', author: 'Synthetic Channel', location: { name: 'Trattoria Sintetica', lat: 40.85, lon: 14.26 } }
          : { ok: true, kind: 'tiktok', text: 'x', location: { name: 'Synthetic Bistro', lat: 47.5, lon: 9.7 } });
      }
      if (u.startsWith('https://www.youtube.com/oembed')) return json({ title: 'Pasta at Trattoria Sintetica', author_name: 'Synthetic Channel' });
      if (u.startsWith('https://www.tiktok.com/oembed')) return json({ title: 'Lunch', author_unique_id: 'synthetic.user', embed_product_id: TT_ID, embed_type: 'video' });
      return json({ features: [] });
    };
    const { opened } = await importInSettings(`https://youtu.be/${YT}\n${tiktok}`);
    assert.deepEqual(asked, { yt: 2, tt: 2 });
    assert.deepEqual(opened[0].e.map((r) => [r.name, r.checked]), [['Trattoria Sintetica', true], ['Synthetic Bistro', true]]);
  } finally {
    restore();
  }
});
