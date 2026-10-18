// worker/tiktok.test.mjs — /api/resolve expands TikTok short links (2.2.0), for the ones TikTok's
// oEmbed refuses as they are. Synthetic codes and IDs; fetch is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.js';

const BINDINGS = { WORK_DIFFICULTY: '20', ASSETS: { fetch: async () => new Response('asset') } };
let address = 0;

/** A request from the app itself, from its own address so rate limits never mix between tests. */
function resolveRequest(link) {
  address++;
  return new Request(`https://pinmap.example/api/resolve?url=${encodeURIComponent(link)}`, {
    headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': `10.1.0.${address}` },
  });
}

/** Fake fetch: `routes` maps a URL to [status, location]; records every call. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const [status, location] = routes[url] || [404, null];
    return new Response(status >= 300 && status < 400 ? null : 'body', { status, headers: location ? { Location: location } : {} });
  };
  fn.calls = calls;
  return fn;
}

const VIDEO = 'https://www.tiktok.com/@synthetic.user/video/7560000000000004242?_r=1&_t=ZS-synthetic';

test('resolve: vm.tiktok.com, vt.tiktok.com and tiktok.com/t/ short links end at the video link, which is not fetched', async () => {
  for (const short of ['https://vm.tiktok.com/ZMsynth01/', 'https://vt.tiktok.com/ZSsynth02/', 'https://www.tiktok.com/t/ZTsynth03/', 'https://m.tiktok.com/t/ZTsynth04/']) {
    const fetch = fakeFetch({ [short]: [301, VIDEO] });
    const res = await handleRequest(resolveRequest(short), BINDINGS, { fetch });
    assert.deepEqual(await res.json(), { ok: true, url: VIDEO }, short);
    assert.deepEqual(fetch.calls, [short], `${short}: only the short link is fetched`);
  }
});

test('resolve: a dead TikTok short link ends at TikTok\'s home page (the app then says it leads to no video)', async () => {
  const short = 'https://vm.tiktok.com/ZMdead01/';
  const fetch = fakeFetch({ [short]: [302, 'https://www.tiktok.com/?_r=1'] });
  const res = await handleRequest(resolveRequest(short), BINDINGS, { fetch });
  assert.deepEqual(await res.json(), { ok: true, url: 'https://www.tiktok.com/?_r=1' });
  assert.equal(fetch.calls.length, 1);
});

test('resolve: other tiktok.com pages and lookalike hosts are refused without any fetch', async () => {
  const fetch = fakeFetch({});
  for (const link of [
    VIDEO, 'https://www.tiktok.com/@synthetic.user', 'https://www.tiktok.com/', 'https://www.tiktok.com/tag/t/x',
    'https://vm.tiktok.com.evil.example/ZMx/', 'https://tiktok.com.evil.example/t/ZTx/', 'https://nottiktok.com/t/ZTx/',
  ]) {
    const res = await handleRequest(resolveRequest(link), BINDINGS, { fetch });
    assert.equal((await res.json()).ok, false, link);
  }
  assert.equal(fetch.calls.length, 0);
});
