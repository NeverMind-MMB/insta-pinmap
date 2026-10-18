// test/maplinks.test.mjs — links from other map apps (web/js/maplinks.js): OpenStreetMap, Organic Maps / CoMaps,
// Waze, HERE WeGo, Mapy and Bing Maps. Synthetic places only; the codes are made by the encoders below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readMapAppLink, decodeOsmShortCode, decodeGe0, decodeGeohash, withShareText, needsMapAppLookup,
  lookUpMapAppEntry, isMapAppStandIn,
} from '../web/js/maplinks.js';
import { readLink } from '../web/js/importers.js';
import { sourceOf, linkIs } from '../web/js/sources.js';

/* ---------- Encoders, so the tests can make their own synthetic codes ---------- */

const OSM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~';
/** A port of OSM's ShortLink.encode (lib/short_link.rb). */
function osmShortCode(lat, lon, zoom) {
  const x = Math.floor(((lon + 180) * 2 ** 32) / 360);
  const y = Math.floor(((lat + 90) * 2 ** 32) / 180);
  let c = 0n;
  for (let i = 31; i >= 0; i--) {
    c = (c << 1n) | BigInt(Math.floor(x / 2 ** i) & 1);
    c = (c << 1n) | BigInt(Math.floor(y / 2 ** i) & 1);
  }
  let s = '';
  for (let i = 0; i < Math.ceil((zoom + 8) / 3); i++) s += OSM_CHARS[Number((c >> BigInt(58 - 6 * i)) & 63n)];
  return s + '-'.repeat((zoom + 8) % 3);
}

const GE0_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Organic Maps' ge0 encoder: a zoom character, then 9 characters of interleaved latitude and longitude bits. */
function ge0Code(lat, lon, zoom = 16) {
  const latI = Math.round(((lat + 90) / 180) * (2 ** 30 - 1));
  const lonI = Math.round(((lon + 180) / 360) * 2 ** 30) % 2 ** 30;
  let code = GE0_CHARS[Math.round((zoom - 4) * 4)];
  for (let shift = 27; shift >= 3; shift -= 3) {
    const la = Math.floor(latI / 2 ** shift) & 7;
    const lo = Math.floor(lonI / 2 ** shift) & 7;
    code += GE0_CHARS[(((la >> 2) & 1) << 5) | (((lo >> 2) & 1) << 4) | (((la >> 1) & 1) << 3) |
      (((lo >> 1) & 1) << 2) | ((la & 1) << 1) | (lo & 1)];
  }
  return code;
}

const GEOHASH_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat, lon, length = 10) {
  const lat_ = [-90, 90];
  const lon_ = [-180, 180];
  let hash = '';
  let even = true;
  let bits = 0;
  let value = 0;
  while (hash.length < length) {
    const range = even ? lon_ : lat_;
    const mid = (range[0] + range[1]) / 2;
    const v = even ? lon : lat;
    value = value * 2 + (v >= mid ? 1 : 0);
    if (v >= mid) range[0] = mid; else range[1] = mid;
    even = !even;
    if (++bits === 5) {
      hash += GEOHASH_CHARS[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const near = (actual, want, tolerance = 1e-5) => assert.ok(Math.abs(actual - want) < tolerance, `${actual} ≈ ${want}`);
const read = (link) => readMapAppLink(link);
const CENTER = 'Coordinate comes from the map center.';

/* ---------- Decoders ---------- */

test('OSM short codes: the documented example and synthetic codes round-trip (to about a pixel at their zoom)', () => {
  // The example on the OSM wiki's Shortlink page; OSM's own redirect gives 51.510998010635376, 0.05499601364135742.
  const p = decodeOsmShortCode('0EEQjEEb');
  near(p.lat, 51.510998010635376, 1e-12);
  near(p.lon, 0.05499601364135742, 1e-12);
  assert.equal(p.zoom, 16);
  for (const [lat, lon, zoom] of [[47.123456, 11.654321, 18], [-33.5, -70.25, 15], [64.1, -21.9, 17]]) {
    const q = decodeOsmShortCode(osmShortCode(lat, lon, zoom));
    near(q.lat, lat, 1e-3);
    near(q.lon, lon, 1e-3);
    assert.equal(q.zoom, zoom, `${lat},${lon} at ${zoom}`);
  }
  assert.equal(decodeOsmShortCode(''), null);
  assert.equal(decodeOsmShortCode('AAAAAAAAAAAAA'), null, 'longer than 32 bits');
});

test('ge0 codes (Organic Maps, CoMaps): the research example and synthetic codes, to about 0.15 m', () => {
  const p = decodeGe0('0yxdjqU7NK');
  near(p.lat, 34.711931);
  near(p.lon, 33.143929);
  for (const [lat, lon] of [[47.123456, 11.654321], [-33.912345, 18.4321], [60.5, -150.25]]) {
    const q = decodeGe0(ge0Code(lat, lon));
    near(q.lat, lat, 2e-6);
    near(q.lon, lon, 2e-6);
  }
  for (const bad of ['', 'A', 'AAAAAAAAAAA', 'abc$def']) assert.equal(decodeGe0(bad), null, bad);
});

test('geohash (Waze): the classic example and synthetic hashes', () => {
  const p = decodeGeohash('ezs42');
  near(p.lat, 42.605, 0.03);
  near(p.lon, -5.603, 0.03);
  const q = decodeGeohash(geohash(47.123456, 11.654321, 10));
  near(q.lat, 47.123456, 1e-5);
  near(q.lon, 11.654321, 1e-5);
  for (const bad of ['', 'ab1a', 'ezs42!']) assert.equal(decodeGeohash(bad), null, bad);
});

/* ---------- OpenStreetMap ---------- */

test('OpenStreetMap: a marker (mlat/mlon) is the exact point; #map= and lat/lon are the map center', () => {
  let e = read('https://www.openstreetmap.org/?mlat=47.12345&mlon=11.54321#map=17/47.12345/11.54321');
  assert.deepEqual([e.name, e.lat, e.lon, e.source, e.warning], ['OpenStreetMap place', 47.12345, 11.54321, 'osm-link', '']);
  e = read('https://www.openstreetmap.org/#map=16/47.2/-11.3');
  assert.deepEqual([e.lat, e.lon, e.warning], [47.2, -11.3, CENTER]);
  e = read('https://www.openstreetmap.org/#map=16/47.2/11.3&layers=C');
  assert.deepEqual([e.lat, e.lon], [47.2, 11.3]);
  e = read('https://www.openstreetmap.org/?lat=47.4&lon=11.6&zoom=15');
  assert.deepEqual([e.lat, e.lon, e.warning], [47.4, 11.6, CENTER]);
});

test('OpenStreetMap short links: osm.org/go/<code> decodes offline; with ?m it is the marker', () => {
  const code = osmShortCode(47.123456, 11.654321, 18);
  let e = read(`https://osm.org/go/${code}?m=`);
  near(e.lat, 47.123456, 1e-4);
  near(e.lon, 11.654321, 1e-4);
  assert.equal(e.warning, '');
  e = read(`https://www.openstreetmap.org/go/${code}`);
  assert.equal(e.warning, CENTER);
  e = read('https://osm.org/go/0EEQjEEb@');
  near(e.lat, 51.510998, 1e-5);
});

test('OpenStreetMap objects (node/way/relation, also behind a short link) wait for a lookup', () => {
  for (const link of [
    'https://www.openstreetmap.org/node/1234567890',
    'https://www.openstreetmap.org/way/42#map=19/47.1/11.1',
    'https://openstreetmap.org/relation/7/',
    `https://osm.org/go/${osmShortCode(47.1, 11.1, 17)}?node=99`,
  ]) {
    const e = read(link);
    assert.deepEqual([e.name, e.lat, e.lon, e.source], ['OpenStreetMap place', null, null, 'osm-link'], link);
    assert.match(e.warning, /looked up/i, link);
    assert.equal(needsMapAppLookup(e), true, link);
  }
});

test('OpenStreetMap search links search for their text; other OSM pages name no place', () => {
  const e = read('https://www.openstreetmap.org/search?query=Synthetic%20Cafe%20Testtown');
  assert.deepEqual([e.name, e.lat, needsMapAppLookup(e)], ['Synthetic Cafe Testtown', null, false]);
  const p = read('https://www.openstreetmap.org/search?query=47.1%2C%2011.2');
  assert.deepEqual([p.lat, p.lon], [47.1, 11.2]);
  for (const link of ['https://www.openstreetmap.org/user/synthetic', 'https://www.openstreetmap.org/', 'https://www.openstreetmap.org/#map=16/0/0']) {
    assert.throws(() => read(link), /OpenStreetMap link has no coordinates or place name/, link);
  }
});

/* ---------- Organic Maps / CoMaps ---------- */

test('Organic Maps and CoMaps: the ge0 code in the link, its name with underscores for spaces', () => {
  const code = ge0Code(47.123456, 11.654321);
  let e = read(`https://omaps.app/${code}/Synthetic_Cafe`);
  assert.deepEqual([e.name, e.source, e.warning], ['Synthetic Cafe', 'organic-maps-link', '']);
  near(e.lat, 47.123456, 2e-6);
  near(e.lon, 11.654321, 2e-6);
  e = read(`https://comaps.at/${code}/Caf%C3%A9_am_See`);
  assert.deepEqual([e.name, e.source], ['Café am See', 'comaps-link']);
  e = read(`http://ge0.me/${code}/Synthetic%20Lab`);
  assert.deepEqual([e.name, e.source], ['Synthetic_Lab', 'organic-maps-link'], 'a space in the link is an underscore in the name');
  e = read(`https://omaps.app/${code}`);
  assert.equal(e.name, 'Organic Maps place');
});

test('Organic Maps and CoMaps: the newer lat,lon forms', () => {
  let e = read('https://omaps.app/47.1,11.2/Synthetic_Hut?z=14');
  assert.deepEqual([e.name, e.lat, e.lon], ['Synthetic Hut', 47.1, 11.2]);
  e = read('https://comaps.at/map?ll=47.1,11.2&n=Synthetic%20Hut');
  assert.deepEqual([e.name, e.lat, e.lon], ['Synthetic Hut', 47.1, 11.2]);
  e = read('https://omaps.app/map?ll=-47.1,-11.2');
  assert.deepEqual([e.name, e.lat, e.lon], ['Organic Maps place', -47.1, -11.2]);
  for (const link of ['https://omaps.app/', 'https://comaps.at/map', 'https://omaps.app/map?ll=0,0']) {
    assert.throws(() => read(link), /has no coordinates or place name/, link);
  }
});

/* ---------- Waze ---------- */

test('Waze: the geohash the app shares (waze.com/ul/h…), and live-map?h=', () => {
  const hash = geohash(47.123456, 11.654321, 10);
  for (const link of [`https://waze.com/ul/h${hash}`, `https://www.waze.com/ul/h${hash}`, `https://www.waze.com/live-map?h=${hash}`]) {
    const e = read(link);
    near(e.lat, 47.123456);
    near(e.lon, 11.654321);
    assert.deepEqual([e.name, e.source, e.warning], ['Waze place', 'waze-link', ''], link);
  }
});

test('Waze: ll=, to=ll. and latlng= are exact; q= is search text; venue links have no coordinates', () => {
  for (const link of [
    'https://waze.com/ul?ll=47.1,11.2&navigate=yes',
    'https://ul.waze.com/ul?ll=47.10000000%2C11.20000000&navigate=yes&utm_source=waze_website',
    'https://www.waze.com/live-map/directions?to=ll.47.1%2C11.2',
    'https://www.waze.com/live-map/directions?latlng=47.1%2C11.2',
  ]) {
    const e = read(link);
    assert.deepEqual([e.lat, e.lon, e.warning], [47.1, 11.2, ''], link);
  }
  assert.equal(read('https://waze.com/ul?ll=47.1,11.2&q=Synthetic%20Cafe').name, 'Synthetic Cafe');
  const search = read('https://waze.com/ul?q=Synthetic%20Cafe');
  assert.deepEqual([search.name, search.lat], ['Synthetic Cafe', null]);
  for (const link of ['https://www.waze.com/ul?venue_id=1.2.3', 'https://www.waze.com/live-map/directions?to=place.w.1.2.3', 'https://waze.com/']) {
    assert.throws(() => read(link), /Waze link has no coordinates or place name/, link);
  }
});

/* ---------- HERE WeGo ---------- */

test('HERE WeGo: share.here.com/l/lat,lon[,name], the s- and e- codes, and ?map= as the map center', () => {
  let e = read('https://share.here.com/l/47.1,11.2,Synthetic%20Cafe');
  assert.deepEqual([e.name, e.lat, e.lon, e.source, e.warning], ['Synthetic Cafe', 47.1, 11.2, 'here-link', '']);
  e = read('https://share.here.com/l/47.1,11.2');
  assert.deepEqual([e.name, e.lat, e.lon], ['HERE WeGo place', 47.1, 11.2]);
  e = read(`https://share.here.com/p/s-${b64('id=;lat=47.123;lon=11.456;n=Synthetic Bäckerei')}`);
  assert.deepEqual([e.name, e.lat, e.lon], ['Synthetic Bäckerei', 47.123, 11.456]);
  e = read(`https://wego.here.com/p/s-${b64('id=;lat=47.123;lon=11.456;n=Synthetic Cafe')}?map=47.12,11.45,16`);
  assert.deepEqual([e.name, e.lat, e.lon, e.warning], ['Synthetic Cafe', 47.123, 11.456, ''], 'the code wins over the map');
  e = read(`https://share.here.com/p/e-${b64(JSON.stringify({ version: '1.0.3', providerId: 'x', latitude: -38.5, longitude: 145.25 }))}`);
  assert.deepEqual([e.name, e.lat, e.lon], ['HERE WeGo place', -38.5, 145.25]);
  e = read('https://wego.here.com/?map=47.1,11.2,15');
  assert.deepEqual([e.lat, e.lon, e.warning], [47.1, 11.2, CENTER]);
  e = read('https://wego.here.com/?q=Synthetic%20Cafe');
  assert.deepEqual([e.name, e.lat], ['Synthetic Cafe', null]);
  for (const link of ['https://wego.here.com/', 'https://share.here.com/p/s-bm90aGluZw==']) {
    assert.throws(() => read(link), /HERE WeGo link has no coordinates or place name/, link);
  }
});

/* ---------- Mapy ---------- */

test('Mapy: x/y (map center, on the place when one is open), source=coor&id=lon,lat exact, q= search text', () => {
  let e = read('https://mapy.com/en/zakladni?x=11.2&y=47.1&z=17');
  assert.deepEqual([e.name, e.lat, e.lon, e.source, e.warning], ['Mapy place', 47.1, 11.2, 'mapy-link', CENTER]);
  e = read('https://mapy.com/en/turisticka?source=coor&id=11.21%2C47.11&x=11.2&y=47.1&z=17');
  assert.deepEqual([e.lat, e.lon, e.warning], [47.11, 11.21, '']);
  e = read('https://mapy.cz/turisticka?source=base&id=1234&x=11.2&y=47.1&z=17');
  assert.deepEqual([e.lat, e.lon, e.warning], [47.1, 11.2, ''], 'the map is centered on the open place');
  e = read('https://en.mapy.cz/zakladni?q=Synthetic%20Cafe&x=11.2&y=47.1&z=12');
  assert.deepEqual([e.name, e.lat], ['Synthetic Cafe', null], 'a search: its text, not the map center');
  assert.throws(() => read('https://mapy.com/en/'), /Mapy link has no coordinates or place name/);
});

test('Mapy short links (mapy.com/s/…, mapy.cz/s/…) are short links the helper expands', () => {
  for (const link of ['https://mapy.com/s/abcdefgh', 'https://mapy.cz/s/abcdefgh', 'https://www.mapy.com/s/abcdefgh', 'https://en.mapy.cz/s/abcdefgh']) {
    const e = read(link);
    assert.deepEqual([e.name, e.lat, e.source], ['Mapy place', null, 'mapy-link'], link);
    assert.match(e.warning, /Short link/, link);
    assert.equal(linkIs(link, 'short'), true, link);
    assert.equal(needsMapAppLookup(e), true, link);
  }
  assert.equal(linkIs('https://mapy.com/en/zakladni?x=11.2&y=47.1', 'short'), false);
});

/* ---------- Bing Maps ---------- */

test('Bing Maps: ppois= and sp=point. are exact with their name; cp= is the map center, where1= its name', () => {
  let e = read('https://www.bing.com/maps?ppois=47.123_11.456_Synthetic%20Cafe_YN0000x1~&cp=47.1~11.4&lvl=16');
  assert.deepEqual([e.name, e.lat, e.lon, e.source, e.warning], ['Synthetic Cafe', 47.123, 11.456, 'bing-link', '']);
  e = read('https://www.bing.com/maps?sp=point.47.1_11.2_Synthetic%20Cafe');
  assert.deepEqual([e.name, e.lat, e.lon], ['Synthetic Cafe', 47.1, 11.2]);
  e = read('https://www.bing.com/maps?cp=47.1~11.2&lvl=16');
  assert.deepEqual([e.name, e.lat, e.lon, e.warning], ['Bing Maps place', 47.1, 11.2, CENTER]);
  e = read('https://www.bing.com/maps?cp=47.1%7E11.2&where1=Synthetic%20Cafe%2C%20Testtown');
  assert.deepEqual([e.name, e.lat, e.lon], ['Synthetic Cafe, Testtown', 47.1, 11.2]);
  e = read('https://www.bing.com/maps?q=Synthetic+Cafe');
  assert.deepEqual([e.name, e.lat], ['Synthetic Cafe', null]);
  assert.throws(() => read('https://www.bing.com/maps'), /Bing Maps link has no coordinates or place name/);
});

/* ---------- Routing: prefix first, then the reader ---------- */

test('readLink reads every map app link as one place; links of no map app are not read here', () => {
  const r = readLink('https://share.here.com/l/47.1,11.2,Synthetic%20Cafe');
  assert.equal(r.name, 'Synthetic Cafe');
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.appleIds, []);
  assert.throws(() => readMapAppLink('https://www.google.com/maps/place/X/@1,2,3z'), /not a map app link/);
});

test('lookalike hosts are no map app links', () => {
  for (const link of [
    'https://openstreetmap.org.evil.example/node/1', 'https://evilopenstreetmap.org/#map=16/47.1/11.2', 'https://notosm.org/go/abc',
    'https://wiki.openstreetmap.org/wiki/Shortlink', 'https://omaps.app.evil.example/abc/X', 'https://notomaps.app/abc',
    'https://comaps.at.evil.example/abc', 'https://notwaze.com/ul?ll=1,2', 'https://waze.com.evil.example/ul?ll=1,2',
    'https://share.here.com.evil.example/l/1,2', 'https://evilhere.com/l/1,2', 'https://here.com/l/1,2',
    'https://mapy.com.evil.example/s/abc', 'https://notmapy.cz/?x=1&y=2', 'https://mapy.cz.evil.example/?x=1&y=2',
    'https://bing.com.evil.example/maps?cp=1~2', 'https://www.bing.com/search?q=maps', 'https://notbing.com/maps?cp=1~2',
  ]) {
    assert.equal(sourceOf(link), null, link);
    assert.throws(() => readLink(link), Error, link);
  }
});

/* ---------- Share text around the link ---------- */

test('share text: Waze\'s "drive to <name>:" names the place; Mapy\'s "<name> <lat>N, <lon>W" gives name and exact point', () => {
  const hash = geohash(47.123456, 11.654321, 10);
  const waze = read(`https://waze.com/ul/h${hash}`);
  assert.equal(withShareText(waze, `Use Waze to drive to Synthetic Cafe, Teststreet 1: https://waze.com/ul/h${hash}`).name,
    'Synthetic Cafe, Teststreet 1');
  // The input bar is one line: a line break between text and link is simply gone.
  assert.equal(withShareText(waze, `Use Waze to drive to Synthetic Cafe:https://waze.com/ul/h${hash}`).name, 'Synthetic Cafe');
  const named = read(`https://waze.com/ul?ll=47.1,11.2&q=Own%20Name`);
  assert.equal(withShareText(named, 'Use Waze to drive to Other: https://waze.com/ul?ll=47.1,11.2&q=Own%20Name').name, 'Own Name',
    'a name in the link stays');

  const short = read('https://mapy.com/s/abcdefgh');
  const e = withShareText(short, 'Synthetic Hut Testvalley 47.1234567N, 11.7654321W https://mapy.com/s/abcdefgh');
  assert.deepEqual([e.name, e.lat, e.lon, e.warning, e.url], ['Synthetic Hut Testvalley', 47.1234567, -11.7654321, '', 'https://mapy.com/s/abcdefgh']);
  assert.equal(needsMapAppLookup(e), false, 'nothing left to resolve');
  const glued = withShareText(short, 'Synthetic Hut 47.1234567N, 11.7654321Ehttps://mapy.com/s/abcdefgh');
  assert.deepEqual([glued.name, glued.lat, glued.lon], ['Synthetic Hut', 47.1234567, 11.7654321]);
  const south = withShareText(short, '12.5S, 130.25E https://mapy.com/s/abcdefgh');
  assert.deepEqual([south.name, south.lat, south.lon], ['Mapy place', -12.5, 130.25]);

  assert.equal(withShareText(short, 'https://mapy.com/s/abcdefgh'), short, 'no text: as it was');
  const google = { name: 'Google place', lat: null, lon: null, url: 'https://maps.app.goo.gl/x', source: 'google-link' };
  assert.equal(withShareText(google, 'Use Waze to drive to X: https://maps.app.goo.gl/x'), google, 'only map app links');
});

test('stand-in names: one per app, recognized as no real name', () => {
  for (const name of ['OpenStreetMap place', 'Organic Maps place', 'CoMaps place', 'Waze place', 'HERE WeGo place', 'Mapy place', 'Bing Maps place']) {
    assert.equal(isMapAppStandIn(name), true, name);
  }
  for (const name of ['Synthetic Cafe', 'Google place', '', undefined]) assert.equal(isMapAppStandIn(name), false, String(name));
});

/* ---------- Lookups: OpenStreetMap objects and Mapy short links ---------- */

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const now = (fn) => fn();

/** fetch answering by URL prefix; records every URL. */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    for (const [prefix, answer] of Object.entries(routes)) if (u.startsWith(prefix)) return answer(u);
    return json([], 404);
  };
  return calls;
}

test('lookup: an OSM object gets name, address and point from Nominatim', async () => {
  const calls = stubFetch({
    'https://nominatim.openstreetmap.org/lookup': () => json([{ lat: '47.1234', lon: '11.5678', name: 'Synthetic Peak', display_name: 'Synthetic Peak, Testtown, Testland' }]),
  });
  const busy = [];
  const done = await lookUpMapAppEntry(read('https://www.openstreetmap.org/way/4242'), { queue: now, busy: (t) => busy.push(t) });
  assert.equal(done.ok, true);
  assert.deepEqual([done.entry.name, done.entry.lat, done.entry.lon, done.entry.address, done.entry.warning, done.entry.source],
    ['Synthetic Peak', 47.1234, 11.5678, 'Synthetic Peak, Testtown, Testland', '', 'osm-link']);
  assert.equal(done.entry.url, 'https://www.openstreetmap.org/way/4242');
  assert.deepEqual(calls, ['https://nominatim.openstreetmap.org/lookup?osm_ids=W4242&format=jsonv2']);
  assert.match(busy[0], /OpenStreetMap/);
});

test('lookup: a node Nominatim doesn\'t know comes from the OSM API; an unnamed one keeps the stand-in name', async () => {
  let calls = stubFetch({
    'https://nominatim.openstreetmap.org/': () => json([]),
    'https://api.openstreetmap.org/api/0.6/node/77.json': () => json({ elements: [{ type: 'node', id: 77, lat: 47.5, lon: 11.5, tags: { name: 'Synthetic Bench' } }] }),
  });
  let done = await lookUpMapAppEntry(read('https://www.openstreetmap.org/node/77'), { queue: now });
  assert.deepEqual([done.ok, done.entry.name, done.entry.lat, done.entry.lon], [true, 'Synthetic Bench', 47.5, 11.5]);
  assert.equal(calls.length, 2);
  calls = stubFetch({
    'https://nominatim.openstreetmap.org/': () => json([]),
    'https://api.openstreetmap.org/': () => json({ elements: [{ type: 'node', id: 78, lat: 47.6, lon: 11.6 }] }),
  });
  done = await lookUpMapAppEntry(read('https://www.openstreetmap.org/node/78'), { queue: now });
  assert.deepEqual([done.entry.name, done.entry.lat], ['OpenStreetMap place', 47.6]);
});

test('lookup: an OSM object nobody knows falls back to the map center in its link, else fails', async () => {
  stubFetch({ 'https://nominatim.openstreetmap.org/': () => json([]) });
  let done = await lookUpMapAppEntry(read('https://www.openstreetmap.org/way/42#map=19/47.1/11.1'), { queue: now });
  assert.deepEqual([done.ok, done.entry.lat, done.entry.lon, done.entry.warning], [true, 47.1, 11.1, CENTER]);
  done = await lookUpMapAppEntry(read('https://www.openstreetmap.org/relation/42'), { queue: now });
  assert.equal(done.ok, false);
  assert.match(done.message, /OpenStreetMap/);
  globalThis.fetch = async () => { throw new Error('offline'); };
  done = await lookUpMapAppEntry(read('https://www.openstreetmap.org/way/42'), { queue: now });
  assert.equal(done.ok, false, 'no network: a message, no exception');
});

test('lookup: a Mapy short link is expanded by the helper, then read', async () => {
  const sent = [];
  const resolve = async (url) => {
    sent.push(url);
    return { ok: true, url: 'https://mapy.com/en/turisticka?source=coor&id=11.21%2C47.11&x=11.2&y=47.1&z=17' };
  };
  const busy = [];
  const done = await lookUpMapAppEntry(read('https://mapy.cz/s/abcdefgh'), { resolve, busy: (t) => busy.push(t) });
  assert.deepEqual([done.ok, done.entry.lat, done.entry.lon, done.entry.name, done.entry.warning], [true, 47.11, 11.21, 'Mapy place', '']);
  assert.equal(done.entry.url, 'https://mapy.cz/s/abcdefgh', 'the link stays the one the user gave');
  assert.deepEqual(sent, ['https://mapy.cz/s/abcdefgh']);
  assert.match(busy[0], /short link/);
});

test('lookup: a Mapy short link that leads nowhere, or somewhere unreadable, fails with a message', async () => {
  for (const answer of [
    { ok: false, message: "This short link doesn't lead anywhere." },
    { ok: true, url: 'https://mapy.cz/s/abcdefgh' },
    { ok: true, url: 'https://evil.example/?x=11.2&y=47.1' },
    { ok: true, url: 'https://mapy.com/en/' },
  ]) {
    const done = await lookUpMapAppEntry(read('https://mapy.cz/s/abcdefgh'), { resolve: async () => answer });
    assert.equal(done.ok, false, JSON.stringify(answer));
    assert.match(done.message, /short link/, JSON.stringify(answer));
  }
});
