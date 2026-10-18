// worker/list.test.mjs — /api/list: a Google Maps list, read whole (worker/googlelist.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest } from './index.js';
import { parseGoogleList } from './googlelist.js';

/* ---------- Synthetic answers in the shape of Google's getlist (no real list data) ---------- */

const LIST_ID = 'SyntheticListId_0123456789';
const OWNER = ['Synthetic Owner', 'https://lh3.example/owner-avatar', '100000000000000000001'];
const ADDER = [['Synthetic Adder', 'https://lh3.example/adder-avatar', '100000000000000000002']];
const NOTE_WRITER = [['Synthetic Note Writer', 'https://lh3.example/writer-avatar', '100000000000000000003']];

/** One place as getlist sends it: p[1] = [.., .., '', .., address, [.., .., lat, lon], ftid], p[2] name, p[3] note. */
function gPlace({ name = '', note = '', address = '', lat = null, lon = null, ftid = ['1111', '2222'] } = {}) {
  const p = Array(15).fill(null);
  p[1] = [null, null, '', null, address, lat === null ? null : [null, null, lat, lon], ftid];
  p[2] = name;
  p[3] = note;
  p[12] = ADDER;
  p[14] = 0;
  p[15] = NOTE_WRITER;
  return p;
}

/** getlist's answer: the ")]}'" line, then [L]; title L[4], description L[5], places L[8], total L[12], owner L[3]. */
function gAnswer({ title = 'Synthetic List', description = 'Synthetic description', places = [], total = places.length } = {}) {
  const L = Array(21).fill(null);
  L[0] = [LIST_ID, 1, null, 1, 1];
  L[1] = 4;
  L[2] = [2, 2, `https://www.google.com/maps/placelists/list/${LIST_ID}`];
  L[3] = OWNER;
  L[4] = title;
  L[5] = description;
  L[8] = places;
  L[12] = total;
  return `)]}'\n${JSON.stringify([L])}`;
}

const TWO_PLACES = gAnswer({
  title: 'Synthetic Trip',
  places: [
    gPlace({ name: 'Synthetic Cafe', note: 'Try the cake', address: 'Teststreet 1, Testtown', lat: 47.1111111, lon: 11.2222222, ftid: ['3520191882892382209', '4961797344968275473'] }),
    gPlace({ name: 'Synthetic\nBar  One', lat: -33.5, lon: 151.25, ftid: ['3520191522657299505', '-7048023691230893300'] }),
  ],
});

/* ---------- Requests ---------- */

let address = 0;

function fakeLimit(limit) {
  const hits = new Map();
  return { limit: async ({ key }) => { const n = (hits.get(key) || 0) + 1; hits.set(key, n); return { success: n <= limit }; } };
}

function bindings(extra = {}) {
  return { WORK_DIFFICULTY: '20', ASSETS: { fetch: async () => new Response('asset') }, LIST_LIMIT: fakeLimit(1000), ...extra };
}

/** A request from the app itself (same origin), from its own address. */
function listRequest(link, ip) {
  address++;
  const query = link === undefined ? '' : `?link=${encodeURIComponent(link)}`;
  return new Request(`https://pinmap.example/api/list${query}`, {
    headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': ip || `10.7.${Math.floor(address / 250)}.${address % 250}` },
  });
}

/** deps.fetch answering every call with `body` and `status`; records the calls. */
function googleFetch(body, status = 200, headers = {}) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response(body, { status, headers }); };
  return { fetch, calls };
}

const PLACELIST_LINK = `https://www.google.com/maps/placelists/list/${LIST_ID}?g_ep=synthetic&g_st=ic`;
const RESOLVED_LINK = `https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2s${LIST_ID}!3e3?g_ep=synthetic`;

test('/api/list: a placelists link — one getlist request to www.google.com, the list as JSON', async () => {
  const deps = googleFetch(TWO_PLACES);
  const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), deps);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^application\/json/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(deps.calls.length, 1);
  const { url, init } = deps.calls[0];
  assert.equal(new URL(url).origin, 'https://www.google.com');
  assert.equal(new URL(url).pathname, '/maps/preview/entitylist/getlist');
  assert.ok(url.includes(`!1s${LIST_ID}!`), url);
  assert.ok(url.includes('!4i1000!'), 'asks for up to 1,000 places');
  assert.ok(!url.includes('!4i3000'), url);
  assert.equal(init.redirect, 'manual', 'never follows Google elsewhere');
  assert.deepEqual(await res.json(), {
    ok: true,
    title: 'Synthetic Trip',
    total: 2,
    places: [
      { name: 'Synthetic Cafe', lat: 47.1111111, lon: 11.2222222, address: 'Teststreet 1, Testtown', note: 'Try the cake', url: 'https://www.google.com/maps?cid=4961797344968275473' },
      { name: 'Synthetic Bar One', lat: -33.5, lon: 151.25, address: '', note: '', url: 'https://www.google.com/maps?cid=11398720382478658316' },
    ],
  });
});

test('/api/list: the address a maps.app.goo.gl list link resolves to (…!11m2!2s<id>!3e3) works too, also on google.de and maps.google.com', async () => {
  for (const link of [RESOLVED_LINK, `https://www.google.de/maps/placelists/list/${LIST_ID}`, `https://maps.google.com/maps/placelists/list/${LIST_ID}`]) {
    const deps = googleFetch(TWO_PLACES);
    const res = await handleRequest(listRequest(link), bindings(), deps);
    assert.equal(res.status, 200, link);
    assert.equal(deps.calls.length, 1, link);
    assert.ok(deps.calls[0].url.startsWith('https://www.google.com/maps/preview/entitylist/getlist?'), link);
    assert.ok(deps.calls[0].url.includes(`!1s${LIST_ID}!`), link);
  }
});

test('/api/list: nothing about the list\'s owner, who added a place or who wrote a note leaves the Worker', async () => {
  const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), googleFetch(TWO_PLACES));
  const text = await res.text();
  for (const secret of [...OWNER, ...ADDER[0], ...NOTE_WRITER[0], 'Synthetic description', 'lh3.example']) {
    assert.ok(!text.includes(secret), secret);
  }
});

test('/api/list: 400 for anything that is no Google Maps list link, without any request', async () => {
  for (const link of [
    undefined, '', 'not a link', 'https://maps.app.goo.gl/synthList', // a short link: the app resolves it first
    'https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z',
    'https://www.google.com/maps/placelists/list/short',
    `https://evil.example/maps/placelists/list/${LIST_ID}`,
    `https://www.google.com.evil.example/maps/placelists/list/${LIST_ID}`,
    `https://www.instagram.com/p/ABC123/?x=/placelists/list/${LIST_ID}`,
    `ftp://www.google.com/maps/placelists/list/${LIST_ID}`,
  ]) {
    const deps = googleFetch(TWO_PLACES);
    const res = await handleRequest(listRequest(link), bindings(), deps);
    assert.equal(res.status, 400, String(link));
    const body = await res.json();
    assert.equal(body.ok, false, String(link));
    assert.equal(body.reason, 'not-a-list', String(link));
    assert.deepEqual(deps.calls, [], String(link));
  }
});

test('/api/list: a list Google doesn\'t show (private, deleted, made up) is 404 with a clear message', async () => {
  const deps = googleFetch(`)]}'\n[null,null,[4,"${LIST_ID}"]]`);
  const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), deps);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'not-found');
  assert.match(body.message, /Anyone with the link/);
});

test('/api/list: Google failing (error status, a redirect, junk, no network) is 502 with a fixed message', async () => {
  const cases = [
    googleFetch('server error', 500),
    googleFetch('', 429),
    googleFetch(null, 302, { Location: 'https://consent.google.com/ml?continue=x' }),
    googleFetch('<html>captcha</html>'),
    googleFetch(")]}'\n{\"not\":\"a list\"}"),
    { fetch: async () => { throw new Error('secret internal detail'); }, calls: [] },
  ];
  for (const deps of cases) {
    const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), deps);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'upstream');
    assert.ok(body.message && !body.message.includes('secret'));
    assert.ok(deps.calls.length <= 1, 'one request, no retry');
  }
});

test('/api/list: 1,000 places of a longer list come through with its total, so the app can say "Google sent 1000 of the 2500"', async () => {
  const places = Array.from({ length: 1000 }, (_, i) =>
    gPlace({ name: `Synthetic Place ${i}`, note: 'Synthetic note '.repeat(8), address: `Teststreet ${i}, Testtown`, lat: 47 + i / 10000, lon: 11 + i / 10000 }));
  const answer = gAnswer({ places, total: 2500 });
  assert.ok(answer.length > 300000, `a realistic size (${answer.length})`);
  const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), googleFetch(answer));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.places.length, 1000);
  assert.equal(body.total, 2500);
});

const SIZE_LIMIT = 1_500_000;

test('/api/list: an answer bigger than about 1.5 MB is not read whole: 502 with a message, nothing parsed', async () => {
  const note = 'x'.repeat(1900);
  const places = Array.from({ length: 1000 }, (_, i) => gPlace({ name: `Synthetic Place ${i}`, note, lat: 47, lon: 11 }));
  const answer = gAnswer({ places });
  assert.ok(answer.length > SIZE_LIMIT, String(answer.length));
  for (const headers of [{}, { 'Content-Length': String(answer.length) }]) {
    const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), googleFetch(answer, 200, headers));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'too-big');
    assert.match(body.message, /too big/);
    assert.match(body.message, /Takeout/);
  }
});

test('/api/list: an endless answer is cut off after about 1.5 MB (the stream is cancelled, not read to its end)', async () => {
  let sent = 0;
  let cancelled = false;
  const chunk = new TextEncoder().encode(`)]}'\n[[${'"x",'.repeat(16000)}`);
  const stream = new ReadableStream({
    pull(controller) { sent += chunk.length; controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  const fetch = async () => new Response(stream, { status: 200 });
  const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), { fetch });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).reason, 'too-big');
  assert.ok(cancelled, 'the rest of the answer is refused');
  assert.ok(sent < SIZE_LIMIT + 4 * chunk.length, `read ${sent} bytes`);
});

test('/api/list: an answer just under the size limit is read', async () => {
  const note = 'x'.repeat(1900);
  const places = Array.from({ length: 600 }, (_, i) => gPlace({ name: `Synthetic Place ${i}`, note, lat: 47, lon: 11 }));
  const answer = gAnswer({ places });
  assert.ok(answer.length < SIZE_LIMIT && answer.length > 1_000_000, String(answer.length));
  const res = await handleRequest(listRequest(PLACELIST_LINK), bindings(), googleFetch(answer));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).places.length, 600);
});

test('/api/list: its own per-address limit (LIST_LIMIT) gives 429', async () => {
  const b = bindings({ LIST_LIMIT: fakeLimit(1) });
  assert.equal((await handleRequest(listRequest(PLACELIST_LINK, '10.8.8.8'), b, googleFetch(TWO_PLACES))).status, 200);
  const deps = googleFetch(TWO_PLACES);
  const res = await handleRequest(listRequest(PLACELIST_LINK, '10.8.8.8'), b, deps);
  assert.equal(res.status, 429);
  assert.equal((await res.json()).reason, 'rate-limit');
  assert.deepEqual(deps.calls, []);
});

test('/api/list: without the binding, 20 per address and minute, counted apart from /api/resolve', async () => {
  const noBinding = { ASSETS: bindings().ASSETS };
  const ip = '10.8.9.9';
  const resolveFetch = async () => new Response(null, { status: 302, headers: { Location: 'https://www.google.com/maps/@1,2,3z' } });
  const resolveRequest = () => new Request(`https://pinmap.example/api/resolve?url=${encodeURIComponent('https://goo.gl/a')}`,
    { headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': ip } });
  for (let i = 0; i < 20; i++) await handleRequest(resolveRequest(), noBinding, { fetch: resolveFetch });
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await handleRequest(listRequest(PLACELIST_LINK, ip), noBinding, googleFetch(TWO_PLACES))).status);
  assert.deepEqual(statuses, [...Array(20).fill(200), 429]);
});

test('/api/list: requests from other sites are refused before anything is fetched', async () => {
  const deps = googleFetch(TWO_PLACES);
  const req = new Request(`https://pinmap.example/api/list?link=${encodeURIComponent(PLACELIST_LINK)}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal((await handleRequest(req, bindings(), deps)).status, 403);
  assert.deepEqual(deps.calls, []);
});

test('/api/list: nothing is logged, links included', async () => {
  const kinds = ['log', 'info', 'warn', 'error', 'debug'];
  const saved = kinds.map((k) => console[k]);
  const logged = [];
  for (const k of kinds) console[k] = (...args) => logged.push(args);
  try {
    await handleRequest(listRequest(PLACELIST_LINK), bindings(), googleFetch(TWO_PLACES));
    await handleRequest(listRequest(PLACELIST_LINK), bindings(), googleFetch('junk', 500));
    await handleRequest(listRequest('https://example.com/'), bindings(), googleFetch(TWO_PLACES));
  } finally {
    kinds.forEach((k, i) => { console[k] = saved[i]; });
  }
  assert.deepEqual(logged, []);
});

test('wrangler.toml declares LIST_LIMIT: namespace 1003, 20 per minute', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const block = toml.split('[[ratelimits]]').find((b) => b.includes('name = "LIST_LIMIT"'));
  assert.ok(block, 'LIST_LIMIT block');
  assert.match(block, /namespace_id = "1003"/);
  assert.match(block, /simple = \{ limit = 20, period = 60 \}/);
  const ids = [...toml.matchAll(/namespace_id = "(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'every namespace_id once');
});

/* ---------- Reading getlist's answer ---------- */

test('parseGoogleList: places without coordinates keep their name (lat/lon null); places without name, address and coordinates are left out', () => {
  const list = parseGoogleList(gAnswer({
    places: [
      gPlace({ name: 'No Coordinates Place', address: 'Somewhere 2' }),
      gPlace({ name: 'Out Of Range', lat: 91, lon: 11 }),
      gPlace({ name: '', address: '', lat: null }),
      gPlace({ name: '', address: 'Only Address 3, Testtown', lat: 48.5, lon: 11.5, ftid: null }),
      'junk',
    ],
    total: 5,
  }));
  assert.equal(list.total, 5);
  assert.deepEqual(list.places, [
    { name: 'No Coordinates Place', lat: null, lon: null, address: 'Somewhere 2', note: '', url: 'https://www.google.com/maps?cid=2222' },
    { name: 'Out Of Range', lat: null, lon: null, address: '', note: '', url: 'https://www.google.com/maps?cid=2222' },
    { name: '', lat: 48.5, lon: 11.5, address: 'Only Address 3, Testtown', note: '', url: 'https://www.google.com/maps/search/?api=1&query=48.5%2C11.5' },
  ]);
});

test('parseGoogleList: an empty list, a missing title, and answers that are no list', () => {
  assert.deepEqual(parseGoogleList(gAnswer({ title: null, places: null, total: null })), { title: '', total: 0, places: [] });
  for (const text of ['', 'junk', ")]}'\n[null]", ")]}'\n[]", ")]}'\n{}", null]) assert.equal(parseGoogleList(text), null, String(text));
});

test('parseGoogleList: overlong texts are cut', () => {
  const list = parseGoogleList(gAnswer({ title: 'T'.repeat(500), places: [gPlace({ name: 'N'.repeat(500), note: 'x'.repeat(5000), lat: 1, lon: 2 })] }));
  assert.ok(list.title.length <= 200);
  assert.ok(list.places[0].name.length <= 200);
  assert.ok(list.places[0].note.length <= 2000);
});
