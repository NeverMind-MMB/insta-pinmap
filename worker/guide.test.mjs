import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRequest } from './index.js';
import { ugLink, pbText, pbIdRef, pbPin } from '../test/ug.mjs';

const GUIDE = ugLink([pbText(1, 'Synthetic Guide'), pbIdRef(9902, '1001'), pbPin('Pin?', 'Street 1, Town', 47.1, 11.1), pbIdRef(6489, '1002')]);
const PINS_ONLY = ugLink([pbText(1, 'Pins'), pbPin('Pin?', 'Street 1, Town', 47.1, 11.1)]);
let address = 0;

function fakeLimit(limit) {
  const hits = new Map();
  return { limit: async ({ key }) => { const n = (hits.get(key) || 0) + 1; hits.set(key, n); return { success: n <= limit }; } };
}

function bindings(extra = {}) {
  return { WORK_DIFFICULTY: '20', ASSETS: { fetch: async () => new Response('asset') }, GUIDE_LIMIT: fakeLimit(1000), ...extra };
}

/** A request as the Shortcut sends it (no Sec-Fetch-Site), from its own address. */
function guideRequest(link, ip) {
  address++;
  const query = link === undefined ? '' : `?link=${encodeURIComponent(link)}`;
  return new Request(`https://pinmap.example/api/guide${query}`, { headers: { 'CF-Connecting-IP': ip || `10.2.0.${address}` } });
}

/** deps.fetch that fails the test if the Worker ever contacts anyone (Apple included). */
function noFetch() {
  const calls = [];
  const fetch = async (url) => { calls.push(url); throw new Error('no fetch expected'); };
  return { fetch, calls };
}

test('/api/guide: one place link per Apple ID (POIs and regions), guide order, plain text, no Apple request', async () => {
  const deps = noFetch();
  const res = await handleRequest(guideRequest(GUIDE), bindings(), deps);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^text\/plain/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(await res.text(), 'https://maps.apple.com/place?auid=1001\nhttps://maps.apple.com/place?auid=1002');
  assert.deepEqual(deps.calls, []);
});

test('/api/guide: the maps.apple.com/guides?user= form works too', async () => {
  const user = new URL(GUIDE).searchParams.get('ug').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await handleRequest(guideRequest(`https://maps.apple.com/guides?user=${user}`), bindings(), noFetch());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'https://maps.apple.com/place?auid=1001\nhttps://maps.apple.com/place?auid=1002');
});

test('/api/guide: 400 with a short plain message for junk, a missing link or a guide without Apple IDs', async () => {
  for (const link of [undefined, '', 'not a link', 'https://example.com/?ug=abc', 'https://www.instagram.com/p/ABC/', PINS_ONLY]) {
    const deps = noFetch();
    const res = await handleRequest(guideRequest(link), bindings(), deps);
    assert.equal(res.status, 400, String(link));
    assert.match(res.headers.get('Content-Type'), /^text\/plain/);
    assert.ok((await res.text()).length > 0);
    assert.deepEqual(deps.calls, []);
  }
});

/** Synthetic guide whose base64 holds a '+' (%2B in the link): POI 1016, region 2002. */
const PLUS_GUIDE = ugLink([pbText(1, 'Plus Guide'), pbIdRef(9902, '1016'), pbIdRef(6489, '2002')]);
const PLUS_LINES = 'https://maps.apple.com/place?auid=1016\nhttps://maps.apple.com/place?auid=2002';

test('/api/guide: a guide link with %2B works URL-encoded, passed as-is, or decoded once ("+" turned into a space)', async () => {
  assert.ok(PLUS_GUIDE.includes('%2B'), 'the test link must contain %2B');
  const asIs = (link) => new Request(`https://pinmap.example/api/guide?link=${link}`, { headers: { 'CF-Connecting-IP': `10.4.0.${++address}` } });
  for (const req of [
    guideRequest(PLUS_GUIDE),                                   // encoded once (what a URL Encode action gives)
    asIs(PLUS_GUIDE),                                           // the Shortcut glued the raw link in
    asIs(`${PLUS_GUIDE}&lang=en`),                              // raw, with a further parameter of the guide link
    guideRequest(decodeURIComponent(PLUS_GUIDE)),               // the link itself decoded once: ug=…+…
  ]) {
    const res = await handleRequest(req, bindings(), noFetch());
    assert.equal(res.status, 200, req.url);
    assert.equal(await res.text(), PLUS_LINES, req.url);
  }
});

test('/api/guide: its own per-address limit gives 429', async () => {
  const b = bindings({ GUIDE_LIMIT: fakeLimit(1) });
  assert.equal((await handleRequest(guideRequest(GUIDE, '10.3.3.3'), b, noFetch())).status, 200);
  assert.equal((await handleRequest(guideRequest(GUIDE, '10.3.3.3'), b, noFetch())).status, 429);
});

test('wrangler.toml declares the GUIDE_LIMIT rate limit', () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /name = "GUIDE_LIMIT"/);
});
