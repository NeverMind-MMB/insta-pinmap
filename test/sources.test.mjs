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
  'Google Maps saved places (Google Takeout)': file('Saved Places.json', JSON.stringify({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [11.5, 48.1] },
    properties: { Title: 'Synthetic Cafe', 'Google Maps URL': 'http://maps.google.com/?cid=1', Location: { Address: 'Testtown' } } }] })),
  'Google Maps lists (Google Takeout)': file('Want to go.csv',
    'Title,Note,URL\nSynthetic Bar,,https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721\n'),
  'Other map files (GeoJSON)': file('places.geojson', geojson({ type: 'Point', coordinates: [11.5, 48.1] })),
  'oPin backups': file('backup.json', JSON.stringify({ version: 1, pins: [], tags: [], deleted: [] })),
};
const BROWSER_ONLY_FILES = new Set([
  'Google My Maps and Google Earth maps',
  "GPS files from Komoot, Strava, Garmin and other outdoor apps (their waypoints and a route's start point)",
]);

test('every file kind listed is one readFile reads (KML, KMZ and GPX only in the browser)', async () => {
  for (const item of group('files').items) {
    if (BROWSER_ONLY_FILES.has(item)) continue;
    const sample = FILE_SAMPLES[item];
    assert.ok(sample, `${item}: add a sample file to this test`);
    const read = await readFile(sample);
    assert.ok(read.backup || read.entries.length === 1, item);
  }
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
