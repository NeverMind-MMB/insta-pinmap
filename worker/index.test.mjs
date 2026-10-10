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
