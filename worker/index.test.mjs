import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.js';

const MAX_HOPS = 5; // as in index.js

const BINDINGS = { WORK_DIFFICULTY: '20', ASSETS: { fetch: async () => new Response('asset') } };
let address = 0;

/** A request from the app itself, from its own address so rate limits never mix between tests. */
function apiRequest(path, headers = {}) {
  address++;
  return new Request(`https://pinmap.example${path}`, {
    headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': `10.0.0.${address}`, ...headers },
  });
}

function resolvePath(link) {
  return `/api/resolve?url=${encodeURIComponent(link)}`;
}

/** Fake fetch: `routes` maps a URL to [status, location]; records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const [status, location] = routes[url] || [404, null];
    const headers = location ? { Location: location } : {};
    return new Response(status === 204 || (status >= 300 && status < 400) ? null : 'body', { status, headers });
  };
  fn.calls = calls;
  return fn;
}

test('resolve: Google short link returns the final Google Maps address', async () => {
  const final = 'https://www.google.com/maps/place/Brandenburger+Tor/@52.5163,13.3777,17z';
  const fetch = fakeFetch({ 'https://maps.app.goo.gl/abc123': [302, final] });
  const res = await handleRequest(apiRequest(resolvePath('https://maps.app.goo.gl/abc123')), BINDINGS, { fetch });
  assert.deepEqual(await res.json(), { ok: true, url: final });
  assert.equal(fetch.calls.length, 1, 'the final address itself is never fetched');
  assert.equal(fetch.calls[0].init.redirect, 'manual');
  assert.match(fetch.calls[0].init.headers['User-Agent'], /^Mozilla\/5\.0/);
});

test('resolve: follows hops inside the short-link hosts and stops at a foreign host without fetching it', async () => {
  const fetch = fakeFetch({
    'https://goo.gl/maps/x': [301, 'https://maps.app.goo.gl/y'],
    'https://maps.app.goo.gl/y': [302, 'https://evil.example/internal?x=1'],
  });
  const res = await handleRequest(apiRequest(resolvePath('https://goo.gl/maps/x')), BINDINGS, { fetch });
  assert.deepEqual(await res.json(), { ok: true, url: 'https://evil.example/internal?x=1' });
  assert.deepEqual(fetch.calls.map((c) => c.url), ['https://goo.gl/maps/x', 'https://maps.app.goo.gl/y']);
});

test('resolve: relative Location and an Apple place page that ends on a short-link host', async () => {
  const fetch = fakeFetch({
    'https://maps.apple/p/abc': [301, 'https://maps.apple.com/place?ll=52.5,13.4&q=Spot'],
    'https://maps.apple.com/place?ll=52.5,13.4&q=Spot': [200, null],
  });
  const res = await handleRequest(apiRequest(resolvePath('https://maps.apple/p/abc')), BINDINGS, { fetch });
  assert.deepEqual(await res.json(), { ok: true, url: 'https://maps.apple.com/place?ll=52.5,13.4&q=Spot' });

  const relative = fakeFetch({ 'https://goo.gl/a': [302, '/b'], 'https://goo.gl/b': [302, 'https://www.google.com/maps/@1,2,3z'] });
  const res2 = await handleRequest(apiRequest(resolvePath('https://goo.gl/a')), BINDINGS, { fetch: relative });
  assert.deepEqual(await res2.json(), { ok: true, url: 'https://www.google.com/maps/@1,2,3z' });
});

test('resolve: stops after the hop limit', async () => {
  let n = 0;
  const fetch = async () => new Response(null, { status: 302, headers: { Location: `https://goo.gl/loop${++n}` } });
  const calls = [];
  const counting = async (url, init) => { calls.push(url); return fetch(url, init); };
  const res = await handleRequest(apiRequest(resolvePath('https://goo.gl/start')), BINDINGS, { fetch: counting });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.message, "Couldn't resolve this short link.");
  assert.equal(calls.length, MAX_HOPS);
});

test('resolve: no redirect (dead link) is ok:false, not the same address back', async () => {
  for (const status of [404, 200]) {
    const fetch = fakeFetch({ 'https://maps.app.goo.gl/dead': [status, null] });
    const res = await handleRequest(apiRequest(resolvePath('https://maps.app.goo.gl/dead')), BINDINGS, { fetch });
    assert.deepEqual(await res.json(), { ok: false, message: "This short link doesn't lead anywhere." });
  }
});

test('resolve: network errors give a fixed message without details', async () => {
  const fetch = async () => { throw new Error('secret internal detail'); };
  const res = await handleRequest(apiRequest(resolvePath('https://maps.app.goo.gl/x')), BINDINGS, { fetch });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.ok(!body.message.includes('secret'));
});

test('resolve: addresses outside the short-link hosts are refused without any fetch', async () => {
  const fetch = fakeFetch({});
  for (const link of ['https://www.google.com/maps/@1,2,3z', 'http://169.254.169.254/latest', 'https://goo.gl.evil.example/x', 'ftp://goo.gl/x', 'not a url']) {
    const res = await handleRequest(apiRequest(resolvePath(link)), BINDINGS, { fetch });
    assert.equal((await res.json()).ok, false, link);
  }
  assert.equal(fetch.calls.length, 0);
});

test('resolve: per-address limit, counted apart from /api/ig', async () => {
  const fetch = fakeFetch({ 'https://goo.gl/a': [302, 'https://www.google.com/maps/@1,2,3z'] });
  const headers = { 'CF-Connecting-IP': '10.9.9.9' };
  for (let i = 0; i < 20; i++) {
    await handleRequest(apiRequest('/api/ig?code=abcde', headers), BINDINGS, { fetch });
  }
  const statuses = [];
  for (let i = 0; i < 21; i++) {
    const res = await handleRequest(apiRequest(resolvePath('https://goo.gl/a'), headers), BINDINGS, { fetch });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses, [...Array(20).fill(200), 429]);
});

test('/api/ig without a ticket: 403 with difficulty and server minute', async () => {
  const fetch = fakeFetch({});
  const res = await handleRequest(apiRequest('/api/ig?code=abcde'), BINDINGS, { fetch });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('X-Work-Difficulty'), '20');
  assert.match(res.headers.get('X-Server-Minute'), /^\d+$/);
  assert.equal(fetch.calls.length, 0);
});

test('requests from other sites are refused', async () => {
  const fetch = fakeFetch({});
  for (const site of ['cross-site', 'same-site', 'none']) {
    const res = await handleRequest(apiRequest(resolvePath('https://goo.gl/a'), { 'Sec-Fetch-Site': site }), BINDINGS, { fetch });
    assert.equal(res.status, 403, site);
  }
  assert.equal(fetch.calls.length, 0);
});

test('every /api response carries X-Robots-Tag and X-App-Version', async () => {
  const fetch = fakeFetch({ 'https://goo.gl/a': [302, 'https://www.google.com/maps/@1,2,3z'] });
  const requests = [
    apiRequest('/api/ig'),
    apiRequest(resolvePath('https://goo.gl/a')),
    apiRequest(resolvePath('https://example.com/')),
    apiRequest('/api/nothing'),
    apiRequest('/api/ig', { 'Sec-Fetch-Site': 'cross-site' }),
    new Request('https://pinmap.example/api/ig', { method: 'POST' }),
  ];
  for (const req of requests) {
    const res = await handleRequest(req, BINDINGS, { fetch });
    assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow', req.url);
    assert.match(res.headers.get('X-App-Version'), /^\d+\.\d+\.\d+$/, req.url);
  }
});

test('everything outside /api/ goes to the static files', async () => {
  const res = await handleRequest(new Request('https://pinmap.example/index.html'), BINDINGS);
  assert.equal(await res.text(), 'asset');
});

test('/api/ig with a valid ticket: 200 carries X-Work-Difficulty', async () => {
  const { solveTicket, ticketMinute } = await import('../web/js/ticket.js');
  const minute = ticketMinute();
  const nonce = solveTicket('abcde', minute, 18);
  const path = `/api/ig?code=abcde&m=${minute}&n=${nonce}`;
  const fetch = fakeFetch({});
  const res = await handleRequest(apiRequest(path), { ...BINDINGS, WORK_DIFFICULTY: '18' }, { fetch });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Work-Difficulty'), '18');
  assert.ok(fetch.calls.length > 0, 'ticket accepted, Instagram was asked');
  const noVar = await handleRequest(apiRequest(path), { ASSETS: BINDINGS.ASSETS }, { fetch });
  assert.equal(noVar.status, 200);
  assert.equal(noVar.headers.get('X-Work-Difficulty'), '18');
  const missing = await handleRequest(apiRequest('/api/ig?code=abcde'), { ASSETS: BINDINGS.ASSETS }, { fetch });
  assert.equal(missing.status, 403);
  assert.equal(missing.headers.get('X-Work-Difficulty'), '18');
});

/* ---------- /api/apple-places ---------- */

/** The head of a real Apple Maps place page (trimmed), as served after the auid redirect. */
function appleHead({ name = 'Clutch23', lat = '48.8196266', lon = '9.2741936', title = 'Clutch23 in Fellbach, Germany - Apple Maps' } = {}) {
  return `<!DOCTYPE html>
<html lang="en-US" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>${title}</title>
<meta name="referrer" content="origin">
<link rel="canonical" href="https://maps.apple.com/place?place-id=I3841F79471A20254">
<meta property="place:location:latitude" content="${lat}">
<meta property="place:location:longitude" content="${lon}">
<meta property="og:title" content="${name}">
<meta property="og:image" content="https://snapshot.apple-mapkit.com/api/v1/snapshot?center=${lat},${lon}&amp;spn=0.009">
<meta name="description" content=" View details about ${name} on Apple Maps.">
</head><body><div id="app"><meta property="og:title" content="Body Title"></div></body></html>`;
}

/** Fake fetch for Apple: `pages` maps an auid to { html, finalUrl, status } or an Error to throw. */
function fakeApple(pages) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const id = new URL(url).searchParams.get('auid');
    const page = pages[id];
    if (page instanceof Error) throw page;
    if (!page) return new Response('not found', { status: 404 });
    const res = new Response(page.html ?? '', { status: page.status ?? 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(res, 'url', { value: page.finalUrl ?? `https://maps.apple.com/place?place-id=I${id}` });
    return res;
  };
  fn.calls = calls;
  return fn;
}

test('apple-places: reads name, coordinates and address from the place page head', async () => {
  const fetch = fakeApple({ '4053793356543820372': { html: appleHead() } });
  const res = await handleRequest(apiRequest('/api/apple-places?ids=4053793356543820372'), BINDINGS, { fetch });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.match(res.headers.get('X-App-Version'), /^\d+\.\d+\.\d+$/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await res.json(), {
    ok: true,
    places: [{ id: '4053793356543820372', ok: true, name: 'Clutch23', address: 'Fellbach, Germany', lat: 48.8196266, lon: 9.2741936 }],
  });
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'https://maps.apple.com/place?auid=4053793356543820372');
  assert.match(fetch.calls[0].init.headers['User-Agent'], /^Mozilla\/5\.0/);
});

test('apple-places: decodes entities; a name containing " in " keeps the address', async () => {
  const fetch = fakeApple({
    '1': { html: appleHead({ name: 'Caf&#233; &amp; Bar in Town', title: 'Caf&#233; &amp; Bar in Town in M&#252;nchen, Germany - Apple Maps' }) },
  });
  const body = await (await handleRequest(apiRequest('/api/apple-places?ids=1'), BINDINGS, { fetch })).json();
  assert.equal(body.places[0].name, 'Café & Bar in Town');
  assert.equal(body.places[0].address, 'München, Germany');
});

test('apple-places: several ids in order, one failing id does not fail the batch', async () => {
  const fetch = fakeApple({
    '1': { html: appleHead({ name: 'One' }) },
    '2': new Error('network down'),
    '3': { html: appleHead({ name: 'Three', title: 'Three in Berlin, Germany - Apple Maps' }) },
    '4': { html: '<html><head><title>Apple Maps</title></head></html>' },
    '5': { html: appleHead({ name: 'Five' }), finalUrl: 'https://evil.example/place' },
    '6': { html: appleHead({ name: 'Six', lat: 'abc' }) },
    '7': { html: appleHead({ name: 'Seven' }), status: 500 },
  });
  const res = await handleRequest(apiRequest('/api/apple-places?ids=1,2,3,4,5,6,7'), BINDINGS, { fetch });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.places.map((p) => [p.id, p.ok]), [
    ['1', true], ['2', false], ['3', true], ['4', false], ['5', false], ['6', false], ['7', false],
  ]);
  assert.equal(body.places[2].name, 'Three');
  assert.equal(body.places[2].address, 'Berlin, Germany');
  assert.deepEqual(body.places[1], { id: '2', ok: false });
  assert.deepEqual(body.places[4], { id: '5', ok: false }, 'redirect to a foreign host is not trusted');
  assert.deepEqual(fetch.calls.map((c) => c.url.split('=')[1]), ['1', '2', '3', '4', '5', '6', '7'], 'sequential, in order');
});

test('apple-places: the meta tags are read from the head only', async () => {
  const html = '<html><head><title>X - Apple Maps</title></head><body><meta property="og:title" content="Body">' +
    '<meta property="place:location:latitude" content="1"><meta property="place:location:longitude" content="2"></body></html>';
  const fetch = fakeApple({ '9': { html } });
  const body = await (await handleRequest(apiRequest('/api/apple-places?ids=9'), BINDINGS, { fetch })).json();
  assert.deepEqual(body.places, [{ id: '9', ok: false }]);
});

test('apple-places: refuses bad ids without fetching', async () => {
  const fetch = fakeApple({});
  const eleven = Array.from({ length: 11 }, (_, i) => String(i + 1)).join(',');
  for (const ids of ['', eleven, 'abc', '12,x3', '123456789012345678901', '1,,2', '-1', '1.5', '1%20']) {
    const res = await handleRequest(apiRequest(`/api/apple-places?ids=${ids}`), BINDINGS, { fetch });
    assert.equal(res.status, 400, ids);
    const body = await res.json();
    assert.equal(body.ok, false, ids);
    assert.equal(typeof body.message, 'string');
  }
  const missing = await handleRequest(apiRequest('/api/apple-places'), BINDINGS, { fetch });
  assert.equal(missing.status, 400);
  assert.equal(fetch.calls.length, 0);
  const ten = Array.from({ length: 10 }, (_, i) => String(i + 1)).join(',');
  const okRes = await handleRequest(apiRequest(`/api/apple-places?ids=${ten}`), BINDINGS, { fetch });
  assert.equal(okRes.status, 200);
  assert.equal(fetch.calls.length, 10);
});

test('apple-places: 10 requests per address and minute, counted apart from the other routes', async () => {
  const fetch = fakeApple({ '1': { html: appleHead() } });
  const headers = { 'CF-Connecting-IP': '10.8.8.8' };
  for (let i = 0; i < 20; i++) await handleRequest(apiRequest('/api/ig?code=abcde', headers), BINDINGS, { fetch });
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    const res = await handleRequest(apiRequest('/api/apple-places?ids=1', headers), BINDINGS, { fetch });
    statuses.push(res.status);
    if (res.status === 429) assert.equal((await res.json()).reason, 'rate-limit');
  }
  assert.deepEqual(statuses, [...Array(10).fill(200), 429]);
  assert.equal(fetch.calls.length, 10, 'no Apple request once over the limit');
});

test('apple-places: uses the APPLE_LIMIT binding with the apple: key when present', async () => {
  const keys = [];
  const APPLE_LIMIT = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const fetch = fakeApple({});
  const res = await handleRequest(apiRequest('/api/apple-places?ids=1', { 'CF-Connecting-IP': '10.7.7.7' }), { ...BINDINGS, APPLE_LIMIT }, { fetch });
  assert.equal(res.status, 429);
  assert.deepEqual(keys, ['apple:10.7.7.7']);
  assert.equal(fetch.calls.length, 0);
});

test('apple-places: refused from other sites', async () => {
  const fetch = fakeApple({});
  const res = await handleRequest(apiRequest('/api/apple-places?ids=1', { 'Sec-Fetch-Site': 'cross-site' }), BINDINGS, { fetch });
  assert.equal(res.status, 403);
  assert.equal(fetch.calls.length, 0);
});

import { readHead } from './applemaps.js';

/** A response whose body arrives in the given chunks; counts how many chunks were pulled. */
function chunkedResponse(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  const stats = { pulled: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return; }
      stats.pulled++;
      controller.enqueue(enc.encode(chunks[i++]));
    },
    cancel() { stats.cancelled = true; },
  }, { highWaterMark: 0 });
  return { res: new Response(body), stats };
}

test('readHead: finds </head> split across two chunks and stops reading there', async () => {
  const { res, stats } = chunkedResponse([
    '<html><head><title>A</title><meta property="og:title" content="A"></he',
    'ad><body>',
    '<meta property="og:title" content="Body">',
    '</body></html>',
  ]);
  const head = await readHead(res);
  assert.equal(head, '<html><head><title>A</title><meta property="og:title" content="A">');
  assert.equal(stats.pulled, 2, 'later chunks are not read');
  assert.equal(stats.cancelled, true);
});

test('readHead: </HEAD > with spaces split over chunks, and the byte cap still applies', async () => {
  const split = chunkedResponse(['<head>x</HE', 'AD  ', '>rest', 'more']);
  assert.equal(await readHead(split.res), '<head>x');
  assert.equal(split.stats.pulled, 3);

  const big = chunkedResponse(['<head>', 'a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)]);
  const head = await readHead(big.res, 150);
  assert.equal(big.stats.pulled, 3, 'stops once the cap is reached');
  assert.ok(head.startsWith('<head>a') && !head.includes('c'));
});
