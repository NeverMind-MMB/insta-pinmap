// test/sources.test.mjs — the "Supported links and files" list (web/js/sources.js), checked against the code that reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_SOURCES, ISSUES_URL, issuesSearchUrl, siteOf, linkIs } from '../web/js/sources.js';
import { isMapLink } from '../web/js/mapflow.js';
import { isInstagramLink } from '../web/js/dedupe.js';
import { isTikTokLink, tiktokVideo } from '../web/js/tiktok.js';
import { readLink, readFile } from '../web/js/importers.js';
import { googleListId } from '../web/js/googlelist.js';
import { isSocialLink, postRequestKey } from '../web/js/postlinks.js';
import { ugLink, pbText, pbIdRef, pbPin } from './ug.mjs';

const GUIDE = ugLink([pbText(1, 'Synthetic Guide'), pbIdRef(9902, '1001'), pbPin('Pin?', 'Street 1, Town', 47.1, 11.1)]);
const GUIDE_USER = 'https://maps.apple.com/guides?user=' +
  new URL(GUIDE).searchParams.get('ug').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Real-shaped links for every link form the lists name (synthetic places). */
const LINK_SAMPLES = {
  'instagram.com/p/…': ['https://www.instagram.com/p/ABC123xyz/'],
  'instagram.com/reel/…': ['https://www.instagram.com/reel/ABC123xyz/'],
  'maps.apple.com/… (places and guides)': ['https://maps.apple.com/?ll=48.1,11.5&q=Synthetic%20Cafe', GUIDE_USER],
  'guides.apple.com/…': [GUIDE],
  'maps.apple.com/… place links': ['https://maps.apple.com/place?coordinate=48.2,11.6&name=Spot'],
  'google.com/maps/…': ['https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721'],
  'maps.google.com/…': ['https://maps.google.com/?q=45.4719,9.1721'],
  'maps.app.goo.gl/…': ['https://maps.app.goo.gl/synthetic1'],
  'goo.gl/maps/…': ['https://goo.gl/maps/synthetic2'],
  'google.com/maps/placelists/… (shared lists)': ['https://www.google.com/maps/placelists/list/SyntheticListId_0123456789'],
  'openstreetmap.org/…': [
    'https://www.openstreetmap.org/?mlat=47.1&mlon=11.2#map=17/47.1/11.2', 'https://www.openstreetmap.org/#map=16/47.1/11.2',
    'https://www.openstreetmap.org/node/1234567890',
  ],
  'osm.org/go/…': ['https://osm.org/go/0EEQjEEb?m='],
  'omaps.app/… (Organic Maps)': ['https://omaps.app/0yxdjqU7NK/Synthetic_Cafe', 'https://omaps.app/47.1,11.2/Synthetic_Hut'],
  'comaps.at/… (CoMaps)': ['https://comaps.at/0yxdjqU7NK/Synthetic_Cafe', 'https://comaps.at/map?ll=47.1,11.2&n=Synthetic%20Hut'],
  'waze.com/…': ['https://waze.com/ul/hu0qt1v6ps2', 'https://ul.waze.com/ul?ll=47.1%2C11.2&navigate=yes',
    'https://www.waze.com/live-map/directions?to=ll.47.1%2C11.2'],
  'share.here.com/…': ['https://share.here.com/l/47.1,11.2,Synthetic%20Cafe'],
  'wego.here.com/…': ['https://wego.here.com/?map=47.1,11.2,15'],
  'mapy.com/…': ['https://mapy.com/en/zakladni?x=11.2&y=47.1&z=17', 'https://mapy.com/s/abcdefgh'],
  'mapy.cz/…': ['https://mapy.cz/turisticka?source=coor&id=11.2%2C47.1&x=11.2&y=47.1&z=17', 'https://mapy.cz/s/abcdefgh'],
  'bing.com/maps…': ['https://www.bing.com/maps?cp=47.1~11.2&where1=Synthetic%20Cafe', 'https://www.bing.com/maps?ppois=47.1_11.2_Synthetic%20Cafe_x~'],
  'binged.it/… (Bing Maps short links)': ['https://binged.it/3SynThX'],
  'ge0://…, om://…, cm://… (Organic Maps and CoMaps app links)': ['ge0://0yxdjqU7NK/Synthetic_Cafe', 'om://0yxdjqU7NK/Synthetic_Cafe', 'cm://0yxdjqU7NK/Synthetic_Cafe'],
  'tiktok.com/@…/video/…': ['https://www.tiktok.com/@synthetic.user/video/7560000000000004242'],
  'vm.tiktok.com/…': ['https://vm.tiktok.com/ZMsynth01/'],
  'vt.tiktok.com/…': ['https://vt.tiktok.com/ZSsynth02/'],
  'tiktok.com/t/…': ['https://www.tiktok.com/t/ZTsynth03/'],
  // Coordinates, geo: URIs and Plus Codes (coords.js): no links, but the input bar reads them.
  'geo:…': ['geo:48.1372,11.5755', 'geo:0,0?q=48.1372,11.5755(Synthetic%20Cafe)'],
  'coordinates (latitude first)': ['48.1372, 11.5755', `48°08'14"N 11°34'32"E`],
  'Plus Codes': ['8FWH4HPM+QR', '4HX8+QH Synthetic Town'],
  'youtube.com/watch?v=…': ['https://www.youtube.com/watch?v=AbCdEfGh_-1', 'https://m.youtube.com/watch?v=AbCdEfGh_-1'],
  'youtube.com/shorts/…': ['https://youtube.com/shorts/AbCdEfGh_-1?si=Synthetic'],
  'youtube.com/live/…': ['https://www.youtube.com/live/AbCdEfGh_-1'],
  'youtu.be/…': ['https://youtu.be/AbCdEfGh_-1?si=Synthetic'],
  'facebook.com/… (public posts, reels and pages)': [
    'https://www.facebook.com/SyntheticPage/posts/1234567890123456', 'https://www.facebook.com/reel/987654321098765/',
    'https://www.facebook.com/share/r/SynThCode1/', 'https://www.facebook.com/SyntheticCafe',
  ],
  'fb.watch/…': ['https://fb.watch/SynThW1/'],
};
const { readCoords } = await import('../web/js/coords.js');

const group = (id) => SUPPORTED_SOURCES.find((g) => g.id === id);

test('Supported links and files: three groups — one link at a time, several links at once, files', () => {
  assert.deepEqual(SUPPORTED_SOURCES.map((g) => g.id), ['bar', 'several', 'files']);
  for (const g of SUPPORTED_SOURCES) assert.ok(g.title && g.items.length, g.id);
});

test('every link form listed for the input bar is one the input bar reads', () => {
  for (const item of group('bar').items) {
    const samples = LINK_SAMPLES[item];
    assert.ok(samples, `${item}: add a sample link to this test`);
    for (const link of samples) {
      if (isInstagramLink(link)) continue;
      if (googleListId(link)) { assert.ok(isMapLink(link), `${item}: ${link}`); continue; } // read whole: /api/list
      if (isTikTokLink(link)) {
        assert.ok(tiktokVideo(link) || linkIs(link, 'short'), `${item}: ${link} is a TikTok video or short link`);
        continue;
      }
      if (isSocialLink(link)) {
        assert.ok(postRequestKey(link), `${item}: ${link} is a video, post or page /api/post reads`);
        continue;
      }
      if (['point', 'short'].includes(readCoords(link)?.kind)) continue;
      assert.ok(isMapLink(link), `${item}: ${link} goes the map-link way`);
      assert.doesNotThrow(() => readLink(link), `${item}: ${link}`);
    }
  }
});

test('every link form listed for Settings → Import is a place link readLink reads', () => {
  for (const item of group('several').items) {
    const samples = LINK_SAMPLES[item];
    assert.ok(samples, `${item}: add a sample link to this test`);
    for (const link of samples) assert.equal(readLink(link).entries.length, 1, `${item}: ${link}`);
  }
});

/** A file as readFile sees it. */
const file = (name, text) => ({ name, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
const geojson = (geometry, properties = { name: 'Synthetic' }) => JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties }] });

/** Real-shaped files for the listed file kinds Node can read; KML, KMZ and GPX need the browser's DOMParser. */
const FILE_SAMPLES = {
  'Google Maps saved places and lists (files from the Google Takeout zip)': [
    file('Saved Places.json', JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [11.5, 48.1] },
      properties: { Title: 'Synthetic Cafe', 'Google Maps URL': 'http://maps.google.com/?cid=1', Location: { Address: 'Testtown' } } }] })),
    file('Want to go.csv',
      'Title,Note,URL\nSynthetic Bar,,https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721\n'),
  ],
  'Spreadsheets (CSV, TSV) with coordinate or address columns': [
    file('places.csv', 'Name,Latitude,Longitude\nSynthetic Cafe,48.1371,11.5754\n'),
    file('places.tsv', 'Name\tAddress\nSynthetic Museum\tTeststrasse 1, 80331 Testtown\n'),
    file('orte.csv', 'Name;Breite;Länge\nSynthetic Lake;47,5;11,1\n'),
  ],
  'Other map files (GeoJSON)': [file('places.geojson', geojson({ type: 'Point', coordinates: [11.5, 48.1] }))],
  'oPin backups': [file('backup.json', JSON.stringify({ version: 1, pins: [], tags: [], deleted: [] }))],
};
const BROWSER_ONLY_FILES = new Set([
  'Google My Maps and Google Earth maps',
  "GPS files (GPX) from Komoot, Strava, Garmin and other outdoor apps (their waypoints and a route's start point)",
]);

test('every file kind listed is one readFile reads (KML, KMZ and GPX only in the browser)', async () => {
  for (const item of group('files').items) {
    if (BROWSER_ONLY_FILES.has(item)) continue;
    const samples = FILE_SAMPLES[item];
    assert.ok(samples, `${item}: add a sample file to this test`);
    for (const sample of samples) {
      const read = await readFile(sample);
      assert.ok(read.backup || read.entries.length === 1, `${item}: ${sample.name}`);
    }
  }
});

test('a Takeout zip itself is not read (only the files in it), so the list names the files', async () => {
  const { zipSync, strToU8 } = await import('../web/vendor/fflate.js');
  const zip = zipSync({ 'Takeout/Maps (your places)/Saved Places.json': strToU8('{"type":"FeatureCollection","features":[]}') });
  await assert.rejects(readFile({ name: 'takeout-20261017.zip', arrayBuffer: async () => zip.buffer }), /no KML file/);
});

test('the GitHub issues search for a site', () => {
  assert.equal(ISSUES_URL, 'https://github.com/NeverMind-MMB/opin/issues');
  assert.equal(issuesSearchUrl('pinterest.com'), 'https://github.com/NeverMind-MMB/opin/issues?q=is%3Aissue%20pinterest.com');
});

test('siteOf: the host a dialog names, without "www."', () => {
  assert.equal(siteOf('https://www.pinterest.com/pin/123/'), 'pinterest.com');
  assert.equal(siteOf('https://pin.it/AbCdEf'), 'pin.it');
  assert.equal(siteOf('https://www.youtube.com/watch?v=abc'), 'youtube.com');
  assert.equal(siteOf('https://maps.apple/p/AbCdEf1234'), 'maps.apple');
});

test('a track in several parts (what togeojson makes of a GPX track with pauses) gives its start point, like a route', async () => {
  const track = geojson({ type: 'MultiLineString', coordinates: [[[11.1, 47.1], [11.2, 47.2]], [[11.3, 47.3], [11.4, 47.4]]] },
    { name: 'Synthetic Tour' });
  const read = await readFile(file('track.geojson', track));
  assert.deepEqual(read.entries.map((e) => [e.name, e.lat, e.lon]), [['Synthetic Tour', 47.1, 11.1]]);
});

/* ---------- Which source a link belongs to: its prefix, nothing more ---------- */

const { sourceOf, SOURCE_GROUPS } = await import('../web/js/sources.js');
const { isAppleGuideLink, isGoogleShortLink } = await import('../web/js/importers.js');

test('sourceOf: every prefix in the table maps to its group', () => {
  const linked = SOURCE_GROUPS.filter((g) => g.prefixes?.length);
  assert.deepEqual(linked.map((g) => g.id), ['instagram', 'apple', 'google', 'tiktok', 'youtube', 'facebook', 'maps', 'coords']);
  for (const g of linked) {
    for (const prefix of g.prefixes) {
      // A scheme prefix ("geo:", "ge0://") stands for links of that scheme.
      const link = /^[a-z0-9]+:(?:\/\/)?$/.test(prefix) ? `${prefix}x` : `https://${prefix.replace('*', 'com')}x`;
      assert.equal(sourceOf(link), g.id, prefix);
    }
  }
});

test('sourceOf: geo: URIs belong to the coordinates (any case); findLinks leaves them alone', async () => {
  const { findLinks } = await import('../web/js/sources.js');
  for (const link of ['geo:48.1372,11.5755', 'GEO:48.1,11.5', ' geo:0,0?q=48.1,11.5(Spot)']) assert.equal(sourceOf(link), 'coords', link);
  for (const link of ['https://geo.example/x', 'https://example.com/geo:48,11', 'geography', 'ageo:48,11']) assert.equal(sourceOf(link), null, link);
  assert.deepEqual(findLinks('see geo:48.1372,11.5755 there'), [], 'no "https://geo:…"');
  assert.deepEqual(findLinks('geo:48.1,11.5 https://pin.it/AbC'), ['https://pin.it/AbC']);
});

test('sourceOf: real link forms of each source', () => {
  const cases = {
    'https://www.instagram.com/p/ABC123/?igsh=x': 'instagram',
    'https://www.instagram.com/reel/ABC123/': 'instagram',
    'https://www.instagram.com/reels/ABC123/': 'instagram',
    'https://www.instagram.com/tv/ABC123/': 'instagram',
    'https://www.instagram.com/synthetic.user/p/ABC123/': 'instagram',
    'https://instagr.am/p/ABC123/': 'instagram',
    'https://maps.apple.com/guides?user=abc': 'apple',
    'https://guides.apple.com/?ug=abc': 'apple',
    'https://maps.apple.com/place?auid=1': 'apple',
    'https://maps.apple.com/?ll=48.1,11.5&q=Cafe': 'apple',
    'https://www.google.com/maps/place/Bar/@45.4,9.2,17z': 'google',
    'https://www.google.de/maps/place/Bar': 'google',
    'https://www.google.co.uk/maps?q=Bar': 'google',
    'https://maps.google.com/?q=45.4,9.2': 'google',
    'https://maps.google.de/?q=45.4,9.2': 'google',
    'https://maps.app.goo.gl/abc': 'google',
    'https://goo.gl/maps/abc': 'google',
    'https://www.openstreetmap.org/node/1': 'maps',
    'https://osm.org/go/0EEQjEEb': 'maps',
    'https://omaps.app/0yxdjqU7NK/X': 'maps',
    'http://ge0.me/0yxdjqU7NK/X': 'maps',
    'https://comaps.at/map?ll=47.1,11.2': 'maps',
    'https://waze.com/ul/hu0qt1v6ps2': 'maps',
    'https://ul.waze.com/ul?ll=47.1,11.2': 'maps',
    'https://share.here.com/l/47.1,11.2': 'maps',
    'https://wego.here.com/?map=47.1,11.2,15': 'maps',
    'https://mapy.com/s/abc': 'maps',
    'https://en.mapy.cz/zakladni?x=11.2&y=47.1': 'maps',
    'https://www.bing.com/maps?cp=47.1~11.2': 'maps',
    'https://www.youtube.com/watch?v=AbCdEfGh_-1': 'youtube',
    'https://m.youtube.com/watch?v=AbCdEfGh_-1': 'youtube',
    'https://youtube.com/shorts/AbCdEfGh_-1': 'youtube',
    'https://youtu.be/AbCdEfGh_-1?si=x': 'youtube',
    'https://www.youtube.com/@synthetic.channel': 'youtube',
    'https://www.facebook.com/reel/987654321098765/': 'facebook',
    'https://m.facebook.com/share/r/SynThCode1/': 'facebook',
    'https://www.facebook.com/SyntheticCafe': 'facebook',
    'https://fb.watch/SynThW1/': 'facebook',
  };
  for (const [link, group] of Object.entries(cases)) assert.equal(sourceOf(link), group, link);
});

test('sourceOf: scheme, "www.", "m." and the host\'s case don\'t matter', () => {
  for (const link of ['instagram.com/p/ABC/', 'http://instagram.com/p/ABC/', 'https://m.instagram.com/p/ABC/', 'https://WWW.Instagram.COM/p/ABC/']) {
    assert.equal(sourceOf(link), 'instagram', link);
  }
});

test('sourceOf: lookalikes and other sites have no source', () => {
  for (const link of [
    'https://notinstagram.com/p/x', 'https://instagram.com.evil.example/p/x', 'https://www.pinterest.com/pin/1/', 'https://pin.it/x',
    'https://maps.apple/p/x', 'https://maps.apple.com.evil.example/place?ll=1,2', 'https://google.evil.example/maps',
    'https://www.google.com/search?q=maps', 'https://goo.gl/abc', 'ftp://instagram.com/p/x', 'Cafe Luitpold', '', null,
    'https://youtube.com.evil.example/watch?v=AbCdEfGh_-1', 'https://notyoutube.com/watch?v=x', 'https://facebook.com.evil.example/x',
    'https://notfacebook.com/x', 'https://music.youtube.com/watch?v=AbCdEfGh_-1', 'https://vimeo.com/123456',
  ]) {
    assert.equal(sourceOf(link), null, String(link));
  }
});

test('the longest prefix also says what a link is: a guide, a short link', () => {
  assert.equal(isAppleGuideLink('https://maps.apple.com/guides?user=abc'), true);
  assert.equal(isAppleGuideLink('https://guides.apple.com/?ug=abc'), true);
  assert.equal(isAppleGuideLink('https://maps.apple.com/place?auid=1'), false);
  assert.equal(isAppleGuideLink('https://evil.example/?ug=abc'), false, 'no source, no guide');
  assert.equal(isGoogleShortLink('https://maps.app.goo.gl/abc'), true);
  assert.equal(isGoogleShortLink('https://goo.gl/maps/abc'), true);
  assert.equal(isGoogleShortLink('https://www.google.com/maps/place/Bar'), false);
  assert.equal(isGoogleShortLink('https://goo.gl/abc'), false);
  assert.equal(linkIs('https://mapy.com/s/abc', 'short'), true, 'a Mapy short link');
  assert.equal(linkIs('https://mapy.cz/s/abc', 'short'), true);
  assert.equal(linkIs('https://mapy.com/en/zakladni?x=11.2&y=47.1', 'short'), false);
});

/* ---------- A pin's colour defaults to its source ---------- */

const { sourceColor } = await import('../web/js/sources.js');
const { PIN_COLORS } = await import('../web/js/store.js');

test('source colours: each source value the app writes gets its group\'s colour; unknown ones the grey', () => {
  const want = {
    instagram: '#8f4b6b', 'apple-ort': '#3a6ea5', 'apple-guide': '#3a6ea5',
    'google-link': '#2f7d5d', 'google-takeout': '#2f7d5d', 'google-csv': '#2f7d5d', 'google-list': '#2f7d5d',
    gpx: '#a3762b', kml: '#7a4b8f', geojson: '#7a4b8f', csv: '#7a4b8f', manual: '#b8543f', tiktok: '#5a5f8f', coords: '#4f7a2b',
    youtube: '#a00830', facebook: '#2f7d7a',
    'osm-link': '#4f7a2b', 'organic-maps-link': '#4f7a2b', 'comaps-link': '#4f7a2b', 'waze-link': '#4f7a2b',
    'here-link': '#4f7a2b', 'mapy-link': '#4f7a2b', 'bing-link': '#4f7a2b',
  };
  for (const [source, color] of Object.entries(want)) assert.equal(sourceColor(source), color, source);
  for (const source of ['import', 'somewhere-else', '', undefined]) assert.equal(sourceColor(source), '#8a8f98', String(source));
});

test('source colours: one per group, all different (coordinates share the map apps\' olive), all from the palette', () => {
  const colors = SOURCE_GROUPS.filter((g) => g.id !== 'coords').map((g) => g.color);
  assert.deepEqual(SOURCE_GROUPS.map((g) => g.id),
    ['instagram', 'apple', 'google', 'tiktok', 'youtube', 'facebook', 'gps', 'files', 'search', 'maps', 'coords']);
  assert.equal(SOURCE_GROUPS.find((g) => g.id === 'coords').color, SOURCE_GROUPS.find((g) => g.id === 'maps').color);
  assert.equal(new Set(colors).size, colors.length);
  // Every source colour can also be picked by hand.
  for (const c of colors) assert.ok(PIN_COLORS.some((p) => p.color === c), c);
});

/** CIELAB (D65) of "#rrggbb". */
function cieLab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE76 = (a, b) => Math.hypot(...cieLab(a).map((v, i) => v - cieLab(b)[i]));

test('YouTube\'s colour is clearly apart from every other pin colour (CIE76 ΔE at least 15), and pickable as "Crimson"', () => {
  const youtube = SOURCE_GROUPS.find((g) => g.id === 'youtube').color;
  const others = new Set([...SOURCE_GROUPS.map((g) => g.color), ...PIN_COLORS.map((p) => p.color)]);
  others.delete(youtube);
  assert.ok(others.size >= 9);
  for (const c of others) assert.ok(deltaE76(youtube, c) >= 15, `${youtube} vs ${c}: ${deltaE76(youtube, c).toFixed(1)}`);
  assert.equal(PIN_COLORS.find((p) => p.color === youtube)?.name, 'Crimson');
  assert.ok(!PIN_COLORS.some((p) => p.name === 'Orange'), 'the old Orange is gone');
});

test('a Google link without a /place/ name takes its search text as the name; a list link is no place', () => {
  const name = (link) => readLink(link).entries[0].name;
  assert.equal(name('https://www.google.com/maps?q=Cafe+Luitpold'), 'Cafe Luitpold');
  assert.equal(name('https://www.google.com/maps/search/?api=1&query=Cafe%20Luitpold%20Munich'), 'Cafe Luitpold Munich');
  assert.equal(name('https://www.google.com/maps/search/Cafe+Luitpold/@48.14,11.57,17z'), 'Cafe Luitpold');
  assert.equal(name('https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z'), 'Synthetic Bar');
  assert.equal(name('https://maps.google.com/?q=45.4719,9.1721'), 'Google place', 'coordinates are no name');
  assert.throws(() => readLink('https://www.google.com/maps/placelists/list/AbCdEf123'), /lists/);
});

test('"*" stands for a country or com ending only: google.co.uk and google.com.br yes, google.evl.de and maps.google.ab.io no', () => {
  for (const link of ['https://www.google.com.br/maps/place/X', 'https://www.google.co.uk/maps/place/X', 'https://maps.google.de/?q=1,2']) {
    assert.equal(sourceOf(link), 'google', link);
  }
  for (const link of ['https://google.evl.de/maps/place/X', 'https://maps.google.ab.io/?q=1,2', 'https://google.example.com/maps']) {
    assert.equal(sourceOf(link), null, link);
  }
});

test('findLinks: every http(s) link, and words that start with a registered prefix but lack the scheme', async () => {
  const { findLinks } = await import('../web/js/sources.js');
  assert.deepEqual(findLinks('see instagram.com/p/ABC123/, nice'), ['https://instagram.com/p/ABC123/']);
  assert.deepEqual(findLinks('check maps.app.goo.gl/xyz123.'), ['https://maps.app.goo.gl/xyz123']);
  assert.deepEqual(findLinks('Look:https://pin.it/AbC and www.google.de/maps/place/X'), ['https://pin.it/AbC', 'https://www.google.de/maps/place/X']);
  for (const text of ['Cafe Luitpold', 'pinterest.com/pin/1', 'me@instagram.com', 'instagram is great.', '']) {
    assert.deepEqual(findLinks(text), [], text);
  }
});

test('findLinks: a bare host word without a path is no link ("Pizza I saw on youtube.com"); with a "/" it is', async () => {
  const { findLinks } = await import('../web/js/sources.js');
  for (const text of ['Pizza I saw on youtube.com', 'tiktok.com', 'facebook.com', 'Found it on instagram.com.', 'maps.apple.com', 'www.youtube.com']) {
    assert.deepEqual(findLinks(text), [], text);
  }
  assert.deepEqual(findLinks('youtube.com/shorts/AbCdEfGhIj0'), ['https://youtube.com/shorts/AbCdEfGhIj0']);
  assert.deepEqual(findLinks('see facebook.com/SyntheticCafe'), ['https://facebook.com/SyntheticCafe']);
  assert.deepEqual(findLinks('Pizza on https://youtube.com'), ['https://youtube.com'], 'with its scheme it is a link');
});

/* ---------- 2.1.0: the add-pin animation's logo or caption ---------- */

test('pinLook: Google Maps, Apple Maps and Instagram show their logo; other sources their name as a caption', async () => {
  const { pinLook } = await import('../web/js/sources.js');
  assert.deepEqual(pinLook('google-csv'), { logo: '/icons/sources/google.png', caption: '' });
  assert.deepEqual(pinLook('google-link'), { logo: '/icons/sources/google.png', caption: '' });
  assert.deepEqual(pinLook('apple-guide'), { logo: '/icons/sources/apple.png', caption: '' });
  assert.deepEqual(pinLook('apple-ort'), { logo: '/icons/sources/apple.png', caption: '' });
  assert.deepEqual(pinLook('instagram'), { logo: '/icons/sources/instagram.png', caption: '' });
  assert.deepEqual(pinLook('youtube'), { logo: '/icons/sources/youtube.png', caption: '' });
  assert.deepEqual(pinLook('facebook'), { logo: '/icons/sources/facebook.png', caption: '' });
  assert.deepEqual(pinLook('gpx'), { logo: '', caption: 'GPS file' });
  assert.deepEqual(pinLook('kml'), { logo: '', caption: 'Map file' });
  assert.deepEqual(pinLook('manual'), { logo: '', caption: 'Place search' });
  assert.deepEqual(pinLook('osm-link'), { logo: '', caption: 'Map app' });
  assert.deepEqual(pinLook('waze-link'), { logo: '', caption: 'Map app' });
  assert.deepEqual(pinLook('coords'), { logo: '', caption: 'Coordinates' });
  assert.deepEqual(pinLook('somewhere-else'), { logo: '', caption: '' });
});

test('every source logo is a file in web/', async () => {
  const { SOURCE_GROUPS } = await import('../web/js/sources.js');
  const { existsSync } = await import('node:fs');
  const logos = SOURCE_GROUPS.filter((group) => group.logo).map((group) => group.logo);
  assert.ok(logos.length >= 3);
  for (const logo of logos) assert.ok(existsSync(new URL(`../web${logo}`, import.meta.url)), logo);
});

test('Supported links and files and the Settings import help name CSV/TSV spreadsheets', async () => {
  assert.ok(group('files').items.includes('Spreadsheets (CSV, TSV) with coordinate or address columns'));
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const help = html.match(/<legend>Import<\/legend>\s*<p class="field__help">([\s\S]*?)<\/p>/)[1].replace(/\s+/g, ' ');
  assert.match(help, /spreadsheets \(CSV\/TSV\)/);
});
