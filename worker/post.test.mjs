// worker/post.test.mjs — /api/post: YouTube and Facebook pages (synthetic fixtures shaped like the real pages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readPost, parseWatchPage, parsePlaceTitle, parseFacebookPost, parseFacebookAbout, readText, placeIdOf,
} from './post.js';
import { handleRequest } from './index.js';

const YT = 'AbCdEfGh_-1';
const PLACE_ID = 'ChIJSyntheticPlaceId0000001';
const esc = (s) => JSON.stringify(s).slice(1, -1);

/** searchEndpoint.params as YouTube writes it: a protobuf with the Place ID, base64, URL-encoded. */
function placeParams(placeId) {
  const proto = String.fromCharCode(0x12, placeId.length + 6, 0xb8, 0x01, 0x01, 0xc2, 0x01, placeId.length) + placeId;
  return encodeURIComponent(Buffer.from(proto, 'latin1').toString('base64'));
}

function locationRun(name, placeId = PLACE_ID) {
  return `{"runs":[{"text":"${name.toUpperCase()}","navigationEndpoint":{"clickTrackingParams":"SynthClick==",` +
    `"commandMetadata":{"webCommandMetadata":{"url":"/results?search_query=${encodeURIComponent(name)}","webPageType":"WEB_PAGE_TYPE_SEARCH"}},` +
    `"searchEndpoint":{"query":"${esc(name)}","params":"${placeParams(placeId)}"}}}],` +
    `"accessibility":{"accessibilityData":{"label":"Link to a location restricted search for videos geo tagged with ${esc(name)}"}}}`;
}

const HASHTAG_RUN = '{"runs":[{"text":"#synthetic","navigationEndpoint":{"clickTrackingParams":"SynthClick==",' +
  '"browseEndpoint":{"browseId":"FEhashtag","params":"EglzeW50aGV0aWM%3D"}}},{"text":" "},{"text":"#testtown"}]}';

/** A watch page as YouTube serves it to a desktop browser, cut down to what the reader looks at. */
function watchPage({ id = YT, title = 'Pasta in Testopoli', description = 'We ate at Trattoria Sintetica.', owner = 'Synthetic Channel',
  publishDate = '2026-03-14T08:00:00-07:00', superTitle = null } = {}) {
  return `<!DOCTYPE html><html lang="en"><head><title>${title} - YouTube</title></head><body>
<meta property="og:title" content="${title.replace(/"/g, '&quot;')}">
<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${id}","title":"${esc(title)}","lengthSeconds":"60",` +
    `"shortDescription":"${esc(description)}","isCrawlable":true},"microformat":{"playerMicroformatRenderer":{` +
    `"publishDate":"${publishDate}","ownerChannelName":"${esc(owner)}","uploadDate":"${publishDate}"}}};</script>
<script>var ytInitialData = {"contents":{"videoPrimaryInfoRenderer":{${superTitle ? `"superTitleLink":${superTitle},` : ''}` +
    `"dateText":{"simpleText":"Mar 14, 2026"}}},"searchEndpoint":{"query":"Not This Place","params":"${placeParams('ChIJNotThisPlace0000000000')}"}};</script>
${'<div>padding</div>'.repeat(50)}</body></html>`;
}

const placePage = (title) => `<!DOCTYPE html><html><head><meta content="Find local businesses" name="Description">` +
  `<meta content="${title}" itemprop="name"><meta content="${title}" property="og:title"></head><body>${'x'.repeat(500)}</body></html>`;

const FB_TEXT = 'Pasta night at Trattoria Sintetica in Testopoli! Come by on Friday, we cook until midnight. 📍 Via Finta 1 #pasta #testopoli';

/** A Facebook post page as Googlebot gets it: og tags (text cut at ~200 characters) plus the post JSON. */
function facebookPostPage({ ogTitle = 'Synthetic Page', ogUrl = 'https://www.facebook.com/SyntheticPage/posts/pasta-night/1234567890123456/',
  text = FB_TEXT, ogDescription = `${FB_TEXT.slice(0, 60)}...`, json = true, created = 1773480000 } = {}) {
  return `<!DOCTYPE html><html><head><meta property="og:title" content="${ogTitle}" />` +
    `<meta property="og:description" content="${ogDescription}" /><meta property="og:url" content="${ogUrl}" />` +
    `<meta property="og:image" content="https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1" /></head><body>` +
    `<script type="application/json">{"comet":{"other":"${'z'.repeat(2000)}"}}</script>` +
    (json ? `<script type="application/json">{"node":{"creation_time":${created},"message":{"text":"${esc(text)}"},` +
      `"actors":[{"__typename":"User","__isEntity":"User","name":"Synthetic Page","id":"100000000000001"}]}}</script>` : '') +
    `<script type="application/json">{"comments":[{"message":{"text":"A synthetic comment"}}]}</script></body></html>`;
}

/** A page's about page as Googlebot gets it. */
function facebookAboutPage({ coords = true } = {}) {
  return `<!DOCTYPE html><html><head><meta property="og:title" content="Synthetic Cafe | Testhausen" />` +
    `<meta property="og:url" content="https://www.facebook.com/SyntheticCafe/" /></head><body>` +
    `<script type="application/json">{"profile_fields":{"nodes":[{"title":{"ranges":[],"color_ranges":[],"text":"Testweg 1, 12345 Testhausen, Germany"},` +
    `"field_type":"address","list_item_groups":[{"list_items":[{"text":{"text":"Address"}}]}],"renderer":{"__typename":"AddressMapProfileFieldRenderer"},` +
    `"should_show_static_map":true${coords ? ',"map_pin_coordinates":{"latitude":48.1234567,"longitude":11.7654321}' : ''}},` +
    `{"title":{"text":"+00 0000 000000"},"field_type":"profile_phone"}]}}</script>${'<p>more</p>'.repeat(100)}</body></html>`;
}

/** Fake fetch: `routes` maps a URL to a Response factory or [status, location]; records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = routes[String(url)];
    if (typeof route === 'function') return route(init);
    if (Array.isArray(route)) return new Response(null, { status: route[0], headers: route[1] ? { Location: route[1] } : {} });
    if (typeof route === 'string') return new Response(route, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('not here', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const WATCH_URL = `https://www.youtube.com/watch?v=${YT}&hl=en`;
const PLACE_URL = `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}&hl=en`;
const ALLOWED_HOSTS = new Set(['www.youtube.com', 'www.google.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch']);

/* ---------- YouTube ---------- */

test('parseWatchPage: full description, title, channel, day and the creator\'s location tag (name + Place ID)', () => {
  const description = 'Line one about Trattoria Sintetica.\n\n"Quoted" and \\ backslash é 😋\nSubscribe!';
  const page = parseWatchPage(watchPage({ description, superTitle: locationRun('Trattoria Sintetica') }), YT);
  assert.deepEqual(page, {
    title: 'Pasta in Testopoli', text: description, author: 'Synthetic Channel', publishedAt: '2026-03-14',
    location: { name: 'Trattoria Sintetica', placeId: PLACE_ID },
  });
});

test('parseWatchPage: a superTitleLink of hashtags is no location; another video\'s page is nothing', () => {
  assert.equal(parseWatchPage(watchPage({ superTitle: HASHTAG_RUN }), YT).location, null);
  assert.equal(parseWatchPage(watchPage(), YT).location, null);
  assert.equal(parseWatchPage(watchPage({ id: 'ZzZzZzZzZz9' }), YT), null, 'a page for another video (or a consent page) is not this video');
  assert.equal(parseWatchPage('<html><body>Before you continue to YouTube</body></html>', YT), null);
});

test('placeIdOf: the Place ID in searchEndpoint.params, by its protobuf length; none for other params', () => {
  assert.equal(placeIdOf(placeParams(PLACE_ID)), PLACE_ID);
  assert.equal(placeIdOf(decodeURIComponent(placeParams(PLACE_ID)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), PLACE_ID, 'base64url too');
  assert.equal(placeIdOf('EglzeW50aGV0aWM%3D'), '');
  assert.equal(placeIdOf('%%%not base64'), '');
});

test('parsePlaceTitle: Google\'s "<name> · <address>" og:title; nothing for a generic map page', () => {
  assert.deepEqual(parsePlaceTitle(placePage('Trattoria Sintetica · Via Finta, 1, 00000 Testopoli, Italy')),
    { name: 'Trattoria Sintetica', address: 'Via Finta, 1, 00000 Testopoli, Italy' });
  assert.equal(parsePlaceTitle(placePage('Google Maps')), null);
  assert.equal(parsePlaceTitle('<html><head></head></html>'), null);
});

test('readPost YouTube: the watch page (desktop browser, consent cookie), then Google\'s place page for the address', async () => {
  const fetch = fakeFetch({
    [WATCH_URL]: watchPage({ superTitle: locationRun('Trattoria Sintetica') }),
    [PLACE_URL]: placePage('Trattoria Sintetica · Via Finta, 1, 00000 Testopoli, Italy'),
  });
  const post = await readPost(`https://youtu.be/${YT}?si=SyntheticShare`, fetch);
  assert.deepEqual(post, {
    ok: true, kind: 'youtube', url: `https://www.youtube.com/watch?v=${YT}`,
    title: 'Pasta in Testopoli', text: 'We ate at Trattoria Sintetica.', author: 'Synthetic Channel', publishedAt: '2026-03-14',
    thumb: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
    location: { name: 'Trattoria Sintetica', address: 'Via Finta, 1, 00000 Testopoli, Italy', placeId: PLACE_ID },
  });
  assert.deepEqual(fetch.calls.map((c) => c.url), [WATCH_URL, PLACE_URL]);
  const [watch, place] = fetch.calls.map((c) => c.init);
  assert.match(watch.headers['User-Agent'], /^Mozilla\/5\.0 \(Windows/);
  assert.equal(watch.headers.Cookie, 'SOCS=CAI');
  assert.equal(watch.redirect, 'manual');
  assert.match(place.headers['User-Agent'], /^facebookexternalhit\/1\.1/);
  assert.equal(place.redirect, 'manual');
});

test('readPost YouTube: no location tag, no second request; the place page failing keeps name and Place ID', async () => {
  const plain = fakeFetch({ [WATCH_URL]: watchPage() });
  const post = await readPost(`https://www.youtube.com/shorts/${YT}`, plain);
  assert.equal(post.ok, true);
  assert.equal('location' in post, false);
  assert.equal(plain.calls.length, 1);

  const noPlace = fakeFetch({ [WATCH_URL]: watchPage({ superTitle: locationRun('Testopoli') }), [PLACE_URL]: [500] });
  assert.deepEqual((await readPost(`https://www.youtube.com/watch?v=${YT}`, noPlace)).location, { name: 'Testopoli', placeId: PLACE_ID });
  const generic = fakeFetch({ [WATCH_URL]: watchPage({ superTitle: locationRun('Testopoli') }), [PLACE_URL]: placePage('Google Maps') });
  assert.deepEqual((await readPost(`https://www.youtube.com/watch?v=${YT}`, generic)).location, { name: 'Testopoli', placeId: PLACE_ID });
});

test('readPost YouTube: a redirect (consent page), an error or another page is ok:false, nothing else fetched', async () => {
  for (const route of [[302, 'https://consent.youtube.com/m?continue=x'], [429], watchPage({ id: 'ZzZzZzZzZz9' })]) {
    const fetch = fakeFetch({ [WATCH_URL]: route });
    const post = await readPost(`https://www.youtube.com/watch?v=${YT}`, fetch);
    assert.equal(post.ok, false, JSON.stringify(route));
    assert.equal(post.message, "Couldn't read this video.");
    assert.deepEqual(fetch.calls.map((c) => c.url), [WATCH_URL]);
  }
  const throwing = async () => { throw new Error('secret internal detail'); };
  const post = await readPost(`https://www.youtube.com/watch?v=${YT}`, throwing);
  assert.equal(post.ok, false);
  assert.equal(post.reason, 'network');
  assert.ok(!JSON.stringify(post).includes('secret'));
});

/* ---------- Facebook ---------- */

test('parseFacebookPost: the full text from the post JSON when it starts like og:description; date, page and canonical link', () => {
  assert.deepEqual(parseFacebookPost(facebookPostPage()), {
    url: 'https://www.facebook.com/SyntheticPage/posts/pasta-night/1234567890123456/', title: 'Synthetic Page', text: FB_TEXT,
    author: 'Synthetic Page', publishedAt: '2026-03-14', imageUrl: 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1',
  });
});

test('parseFacebookPost: without the JSON (facebookexternalhit) or when it holds another text, og:description is the text', () => {
  const crawler = parseFacebookPost(facebookPostPage({ json: false }));
  assert.equal(crawler.text, FB_TEXT.slice(0, 60).trim());
  assert.equal(crawler.publishedAt, '');
  const other = parseFacebookPost(facebookPostPage({ text: 'A completely different text from another story' }));
  assert.equal(other.text, FB_TEXT.slice(0, 60).trim());
  assert.equal(other.publishedAt, '', 'its date belongs to that other story');
});

test('parseFacebookPost: a reel\'s og:title "<views> · <reactions> | <text>" gives no title; the author comes from the post JSON', () => {
  const page = parseFacebookPost(facebookPostPage({
    ogTitle: '1.2K views &#xb7; 34 reactions | Pasta night at Trattoria Sintetica', ogUrl: 'https://www.facebook.com/reel/987654321098765/',
  }));
  assert.equal(page.title, '');
  assert.equal(page.author, 'Synthetic Page');
  assert.equal(page.text, FB_TEXT);
  assert.equal(page.url, 'https://www.facebook.com/reel/987654321098765/');
});

test('parseFacebookAbout: name, exact coordinates and the address of a business page', () => {
  assert.deepEqual(parseFacebookAbout(facebookAboutPage()), {
    url: 'https://www.facebook.com/SyntheticCafe/', name: 'Synthetic Cafe',
    location: { name: 'Synthetic Cafe', lat: 48.1234567, lon: 11.7654321, address: 'Testweg 1, 12345 Testhausen, Germany' },
  });
  assert.deepEqual(parseFacebookAbout(facebookAboutPage({ coords: false })).location,
    { name: 'Synthetic Cafe', address: 'Testweg 1, 12345 Testhausen, Germany' });
  assert.equal(parseFacebookAbout('<html><head></head><body>Log in</body></html>'), null);
});

test('readPost Facebook post: Googlebot first (it gets the full text), the canonical link, only facebook.com fetched', async () => {
  const link = 'https://m.facebook.com/SyntheticPage/posts/1234567890123456?mibextid=abc';
  const fetch = fakeFetch({ 'https://www.facebook.com/SyntheticPage/posts/1234567890123456': facebookPostPage() });
  const post = await readPost(link, fetch);
  assert.deepEqual(post, {
    ok: true, kind: 'facebook', url: 'https://www.facebook.com/SyntheticPage/posts/pasta-night/1234567890123456/',
    title: 'Synthetic Page', text: FB_TEXT, author: 'Synthetic Page', publishedAt: '2026-03-14',
  });
  assert.match(fetch.calls[0].init.headers['User-Agent'], /^Googlebot/);
  assert.equal(fetch.calls[0].init.redirect, 'manual');
  assert.ok(fetch.calls.every((c) => new URL(c.url).hostname === 'www.facebook.com'), 'the og:image (fbsbx.com) is not fetched');
});

test('readPost Facebook: Googlebot refused, facebookexternalhit gets the og tags', async () => {
  const url = 'https://www.facebook.com/reel/987654321098765/';
  const fetch = fakeFetch({
    [url]: (init) => (init.headers['User-Agent'].startsWith('Googlebot')
      ? new Response('', { status: 403 })
      : new Response(facebookPostPage({ json: false, ogTitle: '5 views &#xb7; 1 reaction | Pasta', ogUrl: url }), { status: 200 })),
  });
  const post = await readPost(url, fetch);
  assert.equal(post.ok, true);
  assert.equal(post.text, FB_TEXT.slice(0, 60).trim());
  assert.equal(post.url, url);
  assert.deepEqual(fetch.calls.map((c) => c.init.headers['User-Agent'].split('/')[0]), ['Googlebot', 'facebookexternalhit']);
});

test('readPost Facebook share link: the redirect to the reel is followed inside facebook.com', async () => {
  const share = 'https://www.facebook.com/share/r/SynThCode1/';
  const reel = 'https://www.facebook.com/reel/987654321098765/';
  const fetch = fakeFetch({ [share]: [302, reel], [reel]: facebookPostPage({ ogUrl: reel, ogTitle: '5 views &#xb7; 1 reaction | Pasta' }) });
  const post = await readPost('https://m.facebook.com/share/r/SynThCode1/?mibextid=x', fetch);
  assert.equal(post.ok, true);
  assert.equal(post.url, reel);
  assert.deepEqual(fetch.calls.map((c) => c.url), [share, reel]);
});

test('readPost Facebook: a redirect away from facebook.com is never followed; a login wall is ok:false', async () => {
  const share = 'https://www.facebook.com/share/p/SynThCode2/';
  const away = fakeFetch({ [share]: [302, 'https://evil.example/steal'] });
  const post = await readPost(share, away);
  assert.equal(post.ok, false);
  assert.equal(post.message, "Couldn't read this Facebook post. Only public posts can be read.");
  assert.ok(away.calls.every((c) => new URL(c.url).hostname === 'www.facebook.com'));

  const login = fakeFetch({ [share]: [302, 'https://www.facebook.com/login/?next=x'] });
  assert.equal((await readPost(share, login)).ok, false);
  assert.ok(login.calls.length <= 4, 'stops at the login page');
});

test('readPost Facebook page: the about page (Googlebot) gives exact coordinates and the address', async () => {
  const fetch = fakeFetch({ 'https://www.facebook.com/SyntheticCafe/about/': facebookAboutPage() });
  const post = await readPost('https://www.facebook.com/SyntheticCafe', fetch);
  assert.deepEqual(post, {
    ok: true, kind: 'facebook-page', url: 'https://www.facebook.com/SyntheticCafe/', title: 'Synthetic Cafe', text: '',
    location: { name: 'Synthetic Cafe', lat: 48.1234567, lon: 11.7654321, address: 'Testweg 1, 12345 Testhausen, Germany' },
  });
  assert.match(fetch.calls[0].init.headers['User-Agent'], /^Googlebot/);
});

test('readPost Facebook page: profile.php redirects to the page name, whose about page is read', async () => {
  const fetch = fakeFetch({
    'https://www.facebook.com/profile.php?id=100000000000001&sk=about': [301, 'https://www.facebook.com/SyntheticCafe/'],
    'https://www.facebook.com/SyntheticCafe/about/': facebookAboutPage(),
  });
  const post = await readPost('https://www.facebook.com/profile.php?id=100000000000001', fetch);
  assert.equal(post.kind, 'facebook-page');
  assert.equal(post.location.lat, 48.1234567);
});

test('readPost Facebook page: a share link that lands on a page reads that page\'s about page', async () => {
  const fetch = fakeFetch({
    'https://www.facebook.com/share/SynThCode4/': [302, 'https://www.facebook.com/SyntheticCafe/'],
    'https://www.facebook.com/SyntheticCafe/': facebookPostPage({ ogTitle: 'Synthetic Cafe | Testhausen', ogUrl: 'https://www.facebook.com/SyntheticCafe/' }),
    'https://www.facebook.com/SyntheticCafe/about/': facebookAboutPage(),
  });
  const post = await readPost('https://www.facebook.com/share/SynThCode4/', fetch);
  assert.equal(post.kind, 'facebook-page');
  assert.equal(post.location.lon, 11.7654321);
});

test('readPost: links it doesn\'t read, and every request goes to an allowed host only', async () => {
  const fetch = fakeFetch({});
  for (const link of ['https://www.instagram.com/p/ABC/', 'https://www.youtube.com/@synthetic.channel', 'https://www.facebook.com/groups/', 'http://169.254.169.254/']) {
    const post = await readPost(link, fetch);
    assert.equal(post.ok, false, link);
    assert.equal(post.reason, 'bad-link', link);
  }
  assert.equal(fetch.calls.length, 0);
});

test('readText: stops reading once the marker and some text after it are in', async () => {
  let pulls = 0;
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(encoder.encode(pulls === 3 ? 'xx"map_pin_coordinates":{"latitude":1,"longitude":2}' : 'y'.repeat(1000)));
      if (pulls > 100) controller.close();
    },
  });
  const text = await readText(new Response(body), { stopAfter: '"map_pin_coordinates"', extra: 1500 });
  assert.ok(text.includes('"longitude":2}'));
  assert.ok(pulls < 10, String(pulls));
  const capped = await readText(new Response('z'.repeat(5000)), { maxBytes: 1000 });
  assert.ok(capped.length >= 1000 && capped.length <= 5000);
});

/* ---------- The route ---------- */

const BINDINGS = { WORK_DIFFICULTY: '8', ASSETS: { fetch: async () => new Response('asset') } };
let address = 0;
function apiRequest(path, ip) {
  address++;
  return new Request(`https://pinmap.example${path}`, {
    headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': ip || `10.4.0.${address}` },
  });
}
async function ticketPath(link, key) {
  const { solveTicket, ticketMinute } = await import('../web/js/ticket.js');
  const minute = ticketMinute();
  return `/api/post?url=${encodeURIComponent(link)}&m=${minute}&n=${solveTicket(key, minute, 8)}`;
}

test('/api/post without a ticket: 403 with difficulty and server minute, nothing fetched', async () => {
  const fetch = fakeFetch({});
  const res = await handleRequest(apiRequest(`/api/post?url=${encodeURIComponent(`https://youtu.be/${YT}`)}`), BINDINGS, { fetch });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('X-Work-Difficulty'), '8');
  assert.match(res.headers.get('X-Server-Minute'), /^\d+$/);
  assert.equal(fetch.calls.length, 0);
});

test('/api/post: the ticket is computed over the post key (yt:<id>), not the link; a ticket for another key is refused', async () => {
  const link = `https://youtu.be/${YT}?si=x`;
  const fetch = fakeFetch({ [WATCH_URL]: watchPage() });
  const ok = await handleRequest(apiRequest(await ticketPath(link, `yt:${YT}`)), BINDINGS, { fetch });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.title, 'Pasta in Testopoli');
  assert.equal(ok.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const wrong = await handleRequest(apiRequest(await ticketPath(link, 'yt:ZzZzZzZzZz9')), BINDINGS, { fetch });
  assert.equal(wrong.status, 403);
});

test('/api/post: a link that is no YouTube video or Facebook post, share or page: 400, nothing fetched', async () => {
  const fetch = fakeFetch({});
  for (const link of ['https://www.instagram.com/p/ABC/', 'https://evil.example/', '', 'https://www.facebook.com/groups/']) {
    const res = await handleRequest(apiRequest(`/api/post?url=${encodeURIComponent(link)}&m=1&n=1`), BINDINGS, { fetch });
    assert.equal(res.status, 400, link);
    assert.equal((await res.json()).reason, 'bad-link');
  }
  assert.equal(fetch.calls.length, 0);
});

test('/api/post: 20 a minute per address without the binding, counted apart from /api/ig', async () => {
  const fetch = fakeFetch({});
  const ip = '10.4.9.9';
  for (let i = 0; i < 20; i++) await handleRequest(apiRequest('/api/ig?code=abcde', ip), BINDINGS, { fetch });
  const statuses = [];
  for (let i = 0; i < 21; i++) {
    const res = await handleRequest(apiRequest(`/api/post?url=${encodeURIComponent(`https://youtu.be/${YT}`)}`, ip), BINDINGS, { fetch });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [...Array(20).fill(403), 429]);
});

test('/api/post: uses its own POST_LIMIT binding, keyed by address', async () => {
  const keys = [];
  const POST_LIMIT = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const res = await handleRequest(apiRequest(`/api/post?url=${encodeURIComponent(`https://youtu.be/${YT}`)}`, '10.4.8.8'),
    { ...BINDINGS, POST_LIMIT }, { fetch: fakeFetch({}) });
  assert.equal(res.status, 429);
  assert.deepEqual(keys, ['post:10.4.8.8']);
});

test('/api/post never logs: no console output while reading a link', async () => {
  const link = 'https://www.facebook.com/SyntheticCafe';
  const fetch = fakeFetch({ 'https://www.facebook.com/SyntheticCafe/about/': facebookAboutPage() });
  const said = [];
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[k] = console[k];
    console[k] = (...args) => said.push(args);
  }
  try {
    const res = await handleRequest(apiRequest(await ticketPath(link, 'fb:page:syntheticcafe')), BINDINGS, { fetch });
    assert.equal((await res.json()).kind, 'facebook-page');
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(said, []);
  assert.ok(fetch.calls.every((c) => ALLOWED_HOSTS.has(new URL(c.url).hostname)));
});

test('wrangler.toml declares POST_LIMIT: namespace 1004, 20 a minute', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const block = toml.split('[[ratelimits]]').find((b) => b.includes('"POST_LIMIT"'));
  assert.ok(block, 'POST_LIMIT block');
  assert.match(block, /namespace_id = "1004"/);
  assert.match(block, /simple = \{ limit = 20, period = 60 \}/);
});

/* ---------- TikTok: the video page's location tag (poi) ---------- */

const TT_ID = '7561234567890123456';
const TT_USER = 'synthetic.user';
const TT_PAGE_URL = `https://www.tiktok.com/@${TT_USER}/video/${TT_ID}`;
const TT_POI = {
  name: 'Trattoria Sintetica', address: 'Via Finta 1, 40100, Testopoli, Italia', city: 'Testopoli', province: '', country: '',
  id: '22000000000000001', fatherPoiId: '', fatherPoiName: 'Testopoli', type: 0, category: 'Food', cityCode: '1',
  countryCode: '2', ttTypeCode: '000000', typeCode: '', ttTypeNameTiny: 'Restaurant', ttTypeNameMedium: 'Restaurant', ttTypeNameSuper: 'Food',
};

/** A TikTok video page as a desktop browser gets it, cut down: the rehydration JSON with the video's itemStruct. */
function tiktokPage({ id = TT_ID, desc = 'Lunch with a view #foodtok #testopoli', poi = TT_POI, createTime = '1760270400' } = {}) {
  const item = {
    id, desc, createTime, scheduleTime: 0,
    video: { id, playAddr: `https://v16.example/video/${'y'.repeat(3000)}`, cover: 'https://p16.example/cover' },
    author: { id: '100000000000000001', uniqueId: TT_USER, nickname: 'Synthetic Name', signature: 'Food "and" travel' },
    music: { id: '1', title: 'original sound', authorName: 'Synthetic Name' },
    challenges: [{ id: '1', title: 'foodtok' }], stats: { diggCount: 1 },
    ...(poi ? { poi, contentLocation: { address: { addressLocality: poi.city, streetAddress: `${poi.name}, ${poi.address}` } } } : {}),
    locationCreated: 'IT', contents: [{ desc }],
  };
  const data = { __DEFAULT_SCOPE__: {
    'webapp.app-context': { language: 'en', region: 'IT' },
    'webapp.video-detail': { itemInfo: { itemStruct: item }, shareMeta: { title: 'Synthetic Name on TikTok', desc }, statusCode: 0, statusMsg: '' },
  } };
  return `<!DOCTYPE html><html lang="en"><head><title>Synthetic Name on TikTok</title></head><body>${'<div>x</div>'.repeat(200)}` +
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
}

const { parseTikTokPage } = await import('./post.js');

test('parseTikTokPage: caption, author, day and the location tag (name and address; TikTok gives no coordinates)', () => {
  assert.deepEqual(parseTikTokPage(tiktokPage(), TT_ID), {
    text: 'Lunch with a view #foodtok #testopoli', author: TT_USER, publishedAt: '2025-10-12',
    location: { name: 'Trattoria Sintetica', address: 'Via Finta 1, 40100, Testopoli, Italia' },
  });
  const cityOnly = parseTikTokPage(tiktokPage({ poi: { ...TT_POI, name: 'Testopoli', address: '', province: 'Testregion', country: 'Italia' } }), TT_ID);
  assert.deepEqual(cityOnly.location, { name: 'Testopoli', address: 'Testopoli, Testregion, Italia' }, 'a city-only tag');
  const withPoint = parseTikTokPage(tiktokPage({ poi: { ...TT_POI, latitude: '44.4949', longitude: 11.3426 } }), TT_ID);
  assert.deepEqual([withPoint.location.lat, withPoint.location.lon], [44.4949, 11.3426], 'coordinates, should TikTok ever send them');
  const zero = parseTikTokPage(tiktokPage({ poi: { ...TT_POI, latitude: 0, longitude: 0 } }), TT_ID);
  assert.equal('lat' in zero.location, false, 'never 0,0');
  assert.equal(parseTikTokPage(tiktokPage({ poi: null }), TT_ID).location, null, 'no tag');
  assert.equal(parseTikTokPage(tiktokPage({ poi: { ...TT_POI, name: '  ' } }), TT_ID).location, null, 'a tag without a name');
  assert.equal(parseTikTokPage(tiktokPage(), '7000000000000000001'), null, "another video's page");
  assert.equal(parseTikTokPage('<html><body>Please wait…</body></html>', TT_ID), null, 'a challenge page');
});

test('readPost TikTok: only the video page on www.tiktok.com (desktop browser), no redirects followed', async () => {
  const fetch = fakeFetch({ [TT_PAGE_URL]: tiktokPage() });
  const post = await readPost(`${TT_PAGE_URL}?is_from_webapp=1&sender_device=pc`, fetch);
  assert.deepEqual(post, {
    ok: true, kind: 'tiktok', url: TT_PAGE_URL, title: '', text: 'Lunch with a view #foodtok #testopoli', author: TT_USER,
    publishedAt: '2025-10-12', location: { name: 'Trattoria Sintetica', address: 'Via Finta 1, 40100, Testopoli, Italia' },
  });
  assert.deepEqual(fetch.calls.map((c) => c.url), [TT_PAGE_URL]);
  assert.match(fetch.calls[0].init.headers['User-Agent'], /^Mozilla\/5\.0 \(Windows/);
  assert.equal(fetch.calls[0].init.redirect, 'manual');
  // A link without the user name: TikTok's page answers for "@" too.
  const bare = fakeFetch({ [`https://www.tiktok.com/@/video/${TT_ID}`]: tiktokPage() });
  assert.equal((await readPost(`https://m.tiktok.com/v/${TT_ID}.html`, bare)).location.name, 'Trattoria Sintetica');
  // A photo post is asked as a video page.
  const photo = fakeFetch({ [TT_PAGE_URL]: tiktokPage() });
  assert.equal((await readPost(`https://www.tiktok.com/@${TT_USER}/photo/${TT_ID}`, photo)).url, `https://www.tiktok.com/@${TT_USER}/photo/${TT_ID}`);
});

test('readPost TikTok: a redirect, an error, a challenge page or a page without a tag; short links are not read here', async () => {
  for (const route of [[302, 'https://www.tiktok.com/login'], [403], () => new Response('<html>Please wait…</html>', { status: 200 })]) {
    const fetch = fakeFetch({ [TT_PAGE_URL]: route });
    const post = await readPost(TT_PAGE_URL, fetch);
    assert.equal(post.ok, false);
    assert.equal(post.message, "Couldn't read this TikTok video.");
    assert.equal(fetch.calls.length, 1, 'nothing else fetched');
  }
  const untagged = await readPost(TT_PAGE_URL, fakeFetch({ [TT_PAGE_URL]: tiktokPage({ poi: null }) }));
  assert.equal(untagged.ok, true);
  assert.equal('location' in untagged, false);
  const none = fakeFetch({});
  for (const link of ['https://vm.tiktok.com/ZMsynth01/', `https://www.tiktok.com/@${TT_USER}`, 'https://www.tiktok.com.evil.example/@x/video/1234567']) {
    assert.equal((await readPost(link, none)).reason, 'bad-link', link);
  }
  assert.equal(none.calls.length, 0);
});

test('/api/post: a TikTok video\'s ticket is computed over tt:<id>; a ticket for another key is refused', async () => {
  const fetch = fakeFetch({ [TT_PAGE_URL]: tiktokPage() });
  const ok = await handleRequest(apiRequest(await ticketPath(TT_PAGE_URL, `tt:${TT_ID}`)), BINDINGS, { fetch });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).location.name, 'Trattoria Sintetica');
  const wrong = await handleRequest(apiRequest(await ticketPath(TT_PAGE_URL, 'tt:7000000000000000001')), BINDINGS, { fetch });
  assert.equal(wrong.status, 403);
  for (const c of fetch.calls) assert.equal(new URL(c.url).hostname, 'www.tiktok.com');
});
