// test/sources.test.mjs — the "Supported links and files" list (web/js/sources.js), checked against the code that reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_SOURCES, ISSUES_URL, issuesSearchUrl, siteOf } from '../web/js/sources.js';
import { isMapLink } from '../web/js/addflow.js';
import { isInstagramLink } from '../web/js/dedupe.js';
import { readLink, readFile } from '../web/js/importers.js';
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
};

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
  'Other map files (GeoJSON)': [file('places.geojson', geojson({ type: 'Point', coordinates: [11.5, 48.1] }))],
  'Backups from this app': [file('backup.json', JSON.stringify({ version: 1, pins: [], tags: [], deleted: [] }))],
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
  assert.equal(ISSUES_URL, 'https://github.com/NeverMind-MMB/insta-pinmap/issues');
  assert.equal(issuesSearchUrl('pinterest.com'), 'https://github.com/NeverMind-MMB/insta-pinmap/issues?q=is%3Aissue%20pinterest.com');
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
  assert.deepEqual(linked.map((g) => g.id), ['instagram', 'apple', 'google']);
  for (const g of linked) {
    for (const prefix of g.prefixes) assert.equal(sourceOf(`https://${prefix.replace('*', 'com')}x`), g.id, prefix);
  }
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
});

/* ---------- A pin's colour defaults to its source ---------- */

const { sourceColor } = await import('../web/js/sources.js');
const { PIN_COLORS } = await import('../web/js/store.js');

test('source colours: each source value the app writes gets its group\'s colour; unknown ones the grey', () => {
  const want = {
    instagram: '#8f4b6b', 'apple-ort': '#3a6ea5', 'apple-guide': '#3a6ea5',
    'google-link': '#2f7d5d', 'google-takeout': '#2f7d5d', 'google-csv': '#2f7d5d',
    gpx: '#a3762b', kml: '#7a4b8f', geojson: '#7a4b8f', manual: '#b8543f',
  };
  for (const [source, color] of Object.entries(want)) assert.equal(sourceColor(source), color, source);
  for (const source of ['import', 'somewhere-else', '', undefined]) assert.equal(sourceColor(source), '#8a8f98', String(source));
});

test('source colours: one per group, all different, all from the pin colour palette', () => {
  const colors = SOURCE_GROUPS.map((g) => g.color);
  assert.deepEqual(SOURCE_GROUPS.map((g) => g.id), ['instagram', 'apple', 'google', 'gps', 'files', 'search']);
  assert.equal(new Set(colors).size, colors.length);
  for (const c of colors) assert.ok(PIN_COLORS.some((p) => p.color === c), c);
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
