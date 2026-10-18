import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocationTag } from './iglocation.js';
import { fetchPost } from './instagram.js';
import { handleRequest } from './index.js';

/*
 * Synthetic pages shaped like the post page Instagram gives Googlebot (checked 2026-10-18):
 * meta tags in the head, then ~400 KB further on a JSON script with the "more posts" list
 * (slim objects: code, seo_canonical_url, display_uri) and after it the post's own media
 * object: "code", "taken_at", "media_type", … and then the flat location dict.
 * No real post data: codes, names, users and coordinates are made up.
 */
const HEAD = `<html><head>
<meta name="description" content="12 likes, 3 comments - synthetic.user on May 1, 2026: &quot;Lunch with a view&quot;" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/synthetic.jpg" />
</head>`;

/** `location`: the raw text after "location": (a dict as Instagram writes it, or null). */
function postPage(code, { location = 'null', related = [], padding = 400000 } = {}) {
  const more = related.map((r) => `{"node":{"code":"${r.code}","seo_canonical_url":null,"display_uri":"https://scontent.cdninstagram.com/v/r.jpg"${r.location ? `,"location":${r.location}` : ''}},"cursor":null}`).join(',');
  const media = `{"pk":"1000000000000000001","code":"${code}","taken_at":1777600000,"media_type":1,"product_type":"feed","coauthor_producers":[],"ai_label_info":[],"location":${location},"clips_metadata":null,"like_count":12,"caption":{"text":"Lunch with a view","created_at":1777600000}}`;
  return `${HEAD}<body><script>${'x'.repeat(padding)}</script><script type="application/json" data-sjs>{"more":[${more}],"items":[${media}]}</script></body></html>`;
}

const dict = (fields) => `{"__typename":"XDTLocationDict",${fields},"profile_pic_url":null}`;
const BISTRO = dict('"pk":4242,"lat":47.5012345678,"lng":9.7487654321,"name":"Synthetic Bistro"');

test('readLocationTag: name and coordinates of the post\'s own location tag', () => {
  assert.deepEqual(readLocationTag(postPage('SynthAbc123', { location: BISTRO }), 'SynthAbc123'),
    { name: 'Synthetic Bistro', lat: 47.5012345678, lon: 9.7487654321 });
});

test('readLocationTag: \\uXXXX escapes are decoded, braces and quotes inside the name do not end the dict', () => {
  const loc = dict('"pk":7,"lat":-33.25,"lng":-70.5,"name":"Caf\\u00e9 \\"Zur Kurve\\" {Nord} \\ud83c\\udf55"');
  assert.deepEqual(readLocationTag(postPage('SynthAbc123', { location: loc }), 'SynthAbc123'),
    { name: 'Café "Zur Kurve" {Nord} 🍕', lat: -33.25, lon: -70.5 });
});

test('readLocationTag: an address comes along only when the dict has one', () => {
  const loc = dict('"pk":7,"lat":48.1,"lng":11.5,"name":"Synthetic Hall","address":"  Teststra\\u00dfe 1,\\n 12345 Testtown "');
  assert.deepEqual(readLocationTag(postPage('SynthAbc123', { location: loc }), 'SynthAbc123'),
    { name: 'Synthetic Hall', lat: 48.1, lon: 11.5, address: 'Teststraße 1, 12345 Testtown' });
  const empty = dict('"pk":7,"lat":48.1,"lng":11.5,"name":"Synthetic Hall","address":""');
  assert.equal('address' in readLocationTag(postPage('SynthAbc123', { location: empty }), 'SynthAbc123'), false);
});

test('readLocationTag: no tag, or a tag without usable coordinates or name, gives null', () => {
  const none = (location) => readLocationTag(postPage('SynthAbc123', { location }), 'SynthAbc123');
  assert.equal(none('null'), null);
  assert.equal(none(dict('"pk":7,"lat":null,"lng":null,"name":"Synthetic Town"')), null);
  assert.equal(none(dict('"pk":7,"name":"Synthetic Town"')), null);
  assert.equal(none(dict('"pk":7,"lat":0,"lng":0,"name":"Null Island"')), null);
  assert.equal(none(dict('"pk":7,"lat":91.5,"lng":9.5,"name":"Too North"')), null);
  assert.equal(none(dict('"pk":7,"lat":47.5,"lng":-180.5,"name":"Too West"')), null);
  assert.equal(none(dict('"pk":7,"lat":"x","lng":9.5,"name":"Bad"')), null);
  assert.equal(none(dict('"pk":7,"lat":47.5,"lng":9.5,"name":"   "')), null);
  assert.equal(none(dict('"pk":7,"lat":47.5,"lng":9.5')), null);
  assert.equal(readLocationTag('', 'SynthAbc123'), null);
  assert.equal(readLocationTag(null, 'SynthAbc123'), null);
});

test('readLocationTag: a broken or endless dict gives null instead of throwing', () => {
  const page = (tail) => `${HEAD}{"code":"SynthAbc123","location":{"__typename":"XDTLocationDict"${tail}`;
  assert.equal(readLocationTag(page(',"lat":47.5,"lng":9.5,"name":"Cut'), 'SynthAbc123'), null);
  assert.equal(readLocationTag(page(',"lat":47.5,"lng":9.5,"name":"Long' + 'a'.repeat(20000) + '"}'), 'SynthAbc123'), null);
  assert.equal(readLocationTag(page(',"lat":47.5,lng:9.5,"name":"Bad JSON"}'), 'SynthAbc123'), null);
});

test('readLocationTag: another post\'s tag is never taken for this post', () => {
  const other = dict('"pk":9,"lat":40.1,"lng":-3.7,"name":"Somebody Else\'s Place"');
  // A tagged post in the "more posts" list, this post untagged.
  assert.equal(readLocationTag(postPage('SynthAbc123', { related: [{ code: 'OtherPost99', location: other }] }), 'SynthAbc123'), null);
  // Both tagged: this post's own tag wins.
  assert.equal(readLocationTag(postPage('SynthAbc123', { location: BISTRO, related: [{ code: 'OtherPost99', location: other }] }), 'SynthAbc123').name, 'Synthetic Bistro');
  // A page about another code altogether.
  assert.equal(readLocationTag(postPage('OtherPost99', { location: BISTRO }), 'SynthAbc123'), null);
});

test('readLocationTag: very long names and addresses are shortened, control characters removed', () => {
  const loc = dict(`"pk":7,"lat":47.5,"lng":9.5,"name":"${'N'.repeat(300)}\\u0007","address":"${'A'.repeat(400)}"`);
  const r = readLocationTag(postPage('SynthAbc123', { location: loc }), 'SynthAbc123');
  assert.equal(r.name, 'N'.repeat(200));
  assert.equal(r.address.length, 300);
});

/* ---------- fetchPost and /api/ig ---------- */

const pageFetch = (pages) => async () => {
  const next = pages.shift();
  return new Response(next.body ?? '', { status: next.status ?? 200 });
};

test('fetchPost: the location tag far behind </head> comes along with caption and image', async () => {
  const r = await fetchPost('SynthAbc123', pageFetch([{ body: postPage('SynthAbc123', { location: BISTRO }) }]));
  assert.equal(r.ok, true);
  assert.equal(r.caption, 'Lunch with a view');
  assert.equal(r.username, 'synthetic.user');
  assert.deepEqual(r.location, { name: 'Synthetic Bistro', lat: 47.5012345678, lon: 9.7487654321 });
});

test('fetchPost: a post without a tag, or read by the second crawler without one, has no location key', async () => {
  const untagged = await fetchPost('SynthAbc123', pageFetch([{ body: postPage('SynthAbc123') }]));
  assert.equal(untagged.ok, true);
  assert.equal('location' in untagged, false);
  const second = await fetchPost('SynthAbc123', pageFetch([{ status: 429 }, { body: HEAD }]));
  assert.equal(second.ok, true);
  assert.equal('location' in second, false);
});

let address = 0;
async function askIg(code, page, extra = {}) {
  const { solveTicket, ticketMinute } = await import('../web/js/ticket.js');
  const minute = ticketMinute();
  const nonce = solveTicket(code, minute, 8);
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    return String(url).startsWith('https://www.instagram.com/p/') ? new Response(page, { status: 200 }) : new Response('', { status: 404 });
  };
  address++;
  const req = new Request(`https://pinmap.example/api/ig?code=${code}${extra.noTicket ? '' : `&m=${minute}&n=${nonce}`}`, {
    headers: { 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': `10.1.0.${address}` },
  });
  const res = await handleRequest(req, { WORK_DIFFICULTY: '8', ASSETS: { fetch: async () => new Response('asset') } }, { fetch });
  return { res, body: await res.json(), calls };
}

test('/api/ig: the answer carries the location tag; nothing about the link is logged', async () => {
  const logged = [];
  const saved = {};
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[k] = console[k];
    console[k] = (...args) => logged.push(args);
  }
  let body;
  try {
    ({ body } = await askIg('SynthAbc123', postPage('SynthAbc123', { location: BISTRO })));
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(body.ok, true);
  assert.deepEqual(body.locationTag, { name: 'Synthetic Bistro', lat: 47.5012345678, lon: 9.7487654321 });
  assert.equal(body.location, 'Synthetic Bistro', "`location` stays the tag's name, as before 2.2.0");
  assert.deepEqual(logged, []);
});

test("/api/ig: apps from before 2.2.0 (which pass `location` on as a place name) get the tag's name as their top candidate", async () => {
  const { placeCandidates } = await import('../web/js/extract.js');
  const { body } = await askIg('SynthAbc123', postPage('SynthAbc123', { location: BISTRO }));
  // 2.0.10 and 2.1.0 (installed apps update only by hand): placeCandidates(caption, { username, location: ig.location }).
  const old = placeCandidates(body.caption, { username: body.username, location: body.location });
  assert.equal(typeof body.location, 'string');
  assert.equal(old.candidates[0].text, 'Synthetic Bistro');
  assert.ok(old.candidates.every((c) => !c.text.includes('[object')), 'never "[object Object]"');
});

test('/api/ig: without a tag the answer is exactly the old one', async () => {
  const { body } = await askIg('SynthAbc123', postPage('SynthAbc123'));
  assert.deepEqual(Object.keys(body).sort(), ['caption', 'ok', 'postedAt', 'shortcode', 'thumb', 'username']);
});

test('/api/ig: still no answer and no Instagram request without a work ticket', async () => {
  const { res, body, calls } = await askIg('SynthAbc123', postPage('SynthAbc123', { location: BISTRO }), { noTicket: true });
  assert.equal(res.status, 403);
  assert.equal(body.location, undefined);
  assert.equal(body.locationTag, undefined);
  assert.deepEqual(calls, []);
});
