import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideToGeoJSON, outputName } from '../tools/apple-guide.mjs';
import { readFile } from '../web/js/importers.js';

const APPLE_UG = 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5nElcaM0hvbHpzY2h1aGVyc3RyYcOfZSAzNiwgOTA0MzkgTsO8cm5iZXJnLCBEZXV0c2NobGFuZCISCak0vB8SuUhAEcvv2d9%2BGSZAKgxIaXZlIEdhbWluZz8SDQiuTRDUhIiNx%2FL9oDgSURo1R3Jvw59lbmhhaW5lciBTdHJhw59lIDE4OCwgMDExMjkgRHJlc2RlbiwgRGV1dHNjaGxhbmQiEgna1vjlEYxJQBErmInXrHArQCoENDA0PxJrGjxPbHltcGlhcGFyaywgVG9uaS1NZXJrZW5zLVdlZyA0LCA4MDgwOSBNw7xuY2hlbiwgRGV1dHNjaGxhbmQiEgmZbbTiuhVIQBHGXDAhvhQnQCoXUmVkIEJ1bGwgR2FtaW5nIEdhcmRlbj8SDgiuTRDq57OmgKKGic8BEg4Irk0Qxeiv6pCt5ZyIARINCK5NEMrCuI7%2Bh6LKORINCK5NEI%2BtreyGx%2Fe1TxINCK5NEIrU7sq7pqLZMBIOCK5NEML2otPY%2BsCgzgE%3D';
const IDS = [
  '4053793356543820372', '14921016072022586346', '9816041141257892933', '4149090964667769162',
  '5722912085441730191', '3509017914921167370', '14862164460984384322',
];

function placePage(name, lat, lon, city) {
  return `<!DOCTYPE html><html><head><title>${name} in ${city} - Apple Maps</title>
<meta property="place:location:latitude" content="${lat}">
<meta property="place:location:longitude" content="${lon}">
<meta property="og:title" content="${name}"></head><body></body></html>`;
}

/** Fake maps.apple.com: answers every auid with a place page, except the ids in `failing`. */
function fakeApple({ failing = [] } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const id = new URL(url).searchParams.get('auid');
    if (failing.includes(id)) throw new TypeError('fetch failed');
    const i = IDS.indexOf(id);
    const res = new Response(placePage(`Place ${i}`, 48 + i / 10, 9 + i / 10, 'Fellbach, Germany'), { status: 200 });
    Object.defineProperty(res, 'url', { value: `https://maps.apple.com/place?place-id=I${id}` });
    return res;
  };
  fn.calls = calls;
  return fn;
}

test('apple-guide: inline places plus 7 looked-up places give 10 features, one request per second', async () => {
  const fetch = fakeApple();
  const pauses = [];
  const r = await guideToGeoJSON(APPLE_UG, { fetch, sleep: async (ms) => pauses.push(ms) });
  assert.equal(r.title, 'Epic Gamering');
  assert.equal(r.total, 7);
  assert.equal(r.found, 7);
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.geojson.type, 'FeatureCollection');
  assert.equal(r.geojson.features.length, 10);
  const [first, , , fourth] = r.geojson.features;
  assert.deepEqual(first.geometry.type, 'Point');
  assert.equal(first.properties.name, 'Hive Gaming');
  assert.match(first.properties.address, /Holzschuherstraße 36/);
  assert.equal(first.properties.source, 'apple-guide');
  assert.deepEqual(fourth, {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [9, 48] },
    properties: { name: 'Place 0', address: 'Fellbach, Germany', source: 'apple-guide' },
  });
  assert.deepEqual(fetch.calls.map((c) => c.url), IDS.map((id) => `https://maps.apple.com/place?auid=${id}`), 'in guide order');
  assert.match(fetch.calls[0].init.headers['User-Agent'], /^Mozilla\/5\.0/);
  assert.deepEqual(pauses, Array(6).fill(1000), '1 s between requests, none after the last');
});

test('apple-guide: a failing id is listed as unresolved, the rest still comes out', async () => {
  const r = await guideToGeoJSON(APPLE_UG, { fetch: fakeApple({ failing: [IDS[2]] }), sleep: async () => {} });
  assert.equal(r.found, 6);
  assert.deepEqual(r.unresolved, [IDS[2]]);
  assert.equal(r.geojson.features.length, 9);
});

test('apple-guide: a non-200 answer, a page without coordinates or a redirect off maps.apple.com counts as not found', async () => {
  const fetch = async (url) => {
    const id = new URL(url).searchParams.get('auid');
    if (id === IDS[0]) return new Response('no', { status: 403 });
    if (id === IDS[1]) return Object.defineProperty(new Response('<head><title>Apple Maps</title></head>'), 'url', { value: url });
    const res = new Response(placePage('X', 1, 2, 'Y'));
    Object.defineProperty(res, 'url', { value: id === IDS[2] ? 'https://evil.example/x' : url });
    return res;
  };
  const r = await guideToGeoJSON(APPLE_UG, { fetch, sleep: async () => {} });
  assert.deepEqual(r.unresolved, IDS.slice(0, 3));
  assert.equal(r.found, 4);
});

test("apple-guide: the app's file import reads the produced GeoJSON", async () => {
  const r = await guideToGeoJSON(APPLE_UG, { fetch: fakeApple(), sleep: async () => {} });
  const file = new File([JSON.stringify(r.geojson)], outputName(r.title));
  const { entries } = await readFile(file);
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.slice(0, 4).map((e) => e.name), ['Hive Gaming', '404', 'Red Bull Gaming Garden', 'Place 0']);
  assert.equal(entries[3].address, 'Fellbach, Germany');
  assert.equal(entries[3].lat, 48);
  assert.equal(entries[3].lon, 9);
  assert.ok(entries.every((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon) && e.warning === ''));
});

test('apple-guide: output name from the guide title, safe for every file system', () => {
  assert.equal(outputName('Epic Gamering'), 'Epic Gamering.geojson');
  assert.equal(outputName(''), 'apple-guide.geojson');
  assert.equal(outputName('  a/b:c*?"<>|d  '), 'a b c d.geojson');
  assert.equal(outputName('...'), 'apple-guide.geojson');
});
