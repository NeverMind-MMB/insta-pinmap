// test/logic.test.mjs — the selftest logic checks, runnable in Node.
// KML/GPX checks stay browser-only (they need DOMParser).
import { test } from 'node:test';
import {
  shortcode, normalizeLink, distanceM, distanceText, findPost, buildIndex, nearbyPins,
} from '../web/js/dedupe.js';
import { placeCandidates, flagCountries, tagToWords, tagSuggestions, scoreMatches } from '../web/js/extract.js';
import {
  readAppleGuide, readApplePlace, googleCoordinates, readTakeoutGeoJSON, readGoogleCsv, csvRows,
  readLink, appleIdEntries, isAppleIdLink,
} from '../web/js/importers.js';
import { ugLink, pbText, pbIdRef, pbPin } from './ug.mjs';

function equal(a, b, was = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${was} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function ok(b, was) { if (!b) throw new Error(was || 'Condition not met'); }
function near(a, b, tol, was = '') {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${was} ${a} differs from ${b} by more than ${tol}`);
}

const APPLE_UG = 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5nElcaM0hvbHpzY2h1aGVyc3RyYcOfZSAzNiwgOTA0MzkgTsO8cm5iZXJnLCBEZXV0c2NobGFuZCISCak0vB8SuUhAEcvv2d9%2BGSZAKgxIaXZlIEdhbWluZz8SDQiuTRDUhIiNx%2FL9oDgSURo1R3Jvw59lbmhhaW5lciBTdHJhw59lIDE4OCwgMDExMjkgRHJlc2RlbiwgRGV1dHNjaGxhbmQiEgna1vjlEYxJQBErmInXrHArQCoENDA0PxJrGjxPbHltcGlhcGFyaywgVG9uaS1NZXJrZW5zLVdlZyA0LCA4MDgwOSBNw7xuY2hlbiwgRGV1dHNjaGxhbmQiEgmZbbTiuhVIQBHGXDAhvhQnQCoXUmVkIEJ1bGwgR2FtaW5nIEdhcmRlbj8SDgiuTRDq57OmgKKGic8BEg4Irk0Qxeiv6pCt5ZyIARINCK5NEMrCuI7%2Bh6LKORINCK5NEI%2BtreyGx%2Fe1TxINCK5NEIrU7sq7pqLZMBIOCK5NEML2otPY%2BsCgzgE%3D';

test('Normalize Instagram links', () => {
  const same = [
    'https://www.instagram.com/p/C8xYz_1AbCd/',
    'https://instagram.com/p/C8xYz_1AbCd',
    'https://www.instagram.com/reel/C8xYz_1AbCd/?igsh=MXY123&utm_source=ig_web',
    'https://www.instagram.com/reels/C8xYz_1AbCd/',
    'https://www.instagram.com/machhoerndl/p/C8xYz_1AbCd/',
    'instagram.com/tv/C8xYz_1AbCd/',
  ];
  for (const l of same) equal(shortcode(l), 'C8xYz_1AbCd', l);
  equal(normalizeLink(same[2]), 'https://www.instagram.com/p/C8xYz_1AbCd/');
  equal(shortcode('https://example.com/p/abc'), null, 'foreign URL');
  return `${same.length} spellings reduced to one form`;
});

test('Distance (haversine)', () => {
  // Brandenburg Gate -> Berlin TV Tower, about 2,2 km
  near(distanceM(52.5163, 13.3777, 52.5208, 13.4094), 2200, 120, 'Berlin');
  // Nürnberg -> München, about 151 km
  near(distanceM(49.4539, 11.0775, 48.1372, 11.5755) / 1000, 151, 4, 'Nbg-M');
  near(distanceM(0, 0, 0, 0), 0, 0.001, 'same point');
  equal(distanceText(87), '87 m');
  equal(distanceText(1234), '1,2 km');
  return 'Berlin 2,2 km · Nürnberg→München 151 km';
});

test('Detect duplicate posts', () => {
  const db = buildIndex({ pins: [{
    id: 'p1', lat: 49.45, lon: 11.07, title: 'Test', tags: [],
    posts: [{ url: 'https://www.instagram.com/p/AAA111/' }],
  }], postIndex: {} });
  ok(findPost(db, 'https://www.instagram.com/reel/AAA111/?igsh=xyz'), 'Reel form not recognized');
  equal(findPost(db, 'https://www.instagram.com/p/BBB222/'), null, 'other post');
  equal(db.postIndex.AAA111, 'p1', 'Index');
  return 'Index and full scan agree';
});

test('Find nearby pins', () => {
  const db = { pins: [
    { id: 'a', lat: 49.4500, lon: 11.0700, title: 'A' },
    { id: 'b', lat: 49.4502, lon: 11.0700, title: 'B' },   // ~22 m
    { id: 'c', lat: 49.5000, lon: 11.0700, title: 'C' },   // ~5,5 km
  ] };
  equal(nearbyPins(db, 49.45, 11.07, 150).map((x) => x.pin.id), ['a', 'b']);
  equal(nearbyPins(db, 49.45, 11.07, 150, 'a').map((x) => x.pin.id), ['b'], 'with exclusion');
  equal(nearbyPins(db, 49.45, 11.07, 10).map((x) => x.pin.id), ['a']);
  return 'Threshold works in both directions';
});

test('Evaluate flag emoji', () => {
  equal(flagCountries('Traum 🇫🇷'), ['FR']);
  equal(flagCountries('🇩🇪 und 🇮🇹'), ['DE', 'IT']);
  equal(flagCountries('ohne'), []);
  return 'FR, DE+IT, none';
});

test('Split hashtags into words', () => {
  equal(tagToWords('#NuernbergFood'), 'Nuernberg Food');
  equal(tagToWords('cafe_hamburg'), 'cafe hamburg');
  equal(tagToWords('#OSMKarte'), 'OSM Karte');
  return 'CamelCase and underscores';
});

test('Place candidates: explicit marker', () => {
  const { candidates } = placeCandidates('Bester Kaffee ☕ 📍 Machhörndl Kaffee, Nürnberg #coffee #foodie');
  ok(candidates.length > 0, 'nothing found');
  ok(/Machhörndl/i.test(candidates[0].text), `top result was: ${candidates[0].text}`);
  return `Best: "${candidates[0].text}"`;
});

test('Place candidates: hashtags only', () => {
  const { candidates } = placeCandidates('So schön hier! #Lissabon #reels #travel #foodporn #love');
  const texts = candidates.map((c) => c.text.toLowerCase());
  ok(texts.some((t) => t.includes('lissabon')), `found: ${texts.join(' | ')}`);
  ok(!texts.some((t) => ['reels', 'travel', 'love', 'foodporn'].includes(t)), 'generic tag slipped through');
  return 'Lissabon recognized, generic tags filtered';
});

test('Place candidates: only place name and emoji', () => {
  // The most common case of all, and for a long time completely missed,
  // because the word-sequence rule needed at least two words.
  const cases = [
    ['Zermatt 🇨🇭❄️', 'Zermatt'],
    ['Hallstatt ⛰️✨', 'Hallstatt'],
    ['Lissabon ❤️🇵🇹', 'Lissabon'],
    ['Neuschwanstein 🏰💫', 'Neuschwanstein'],
    ['Kirkjufell 🇮🇸🏔', 'Kirkjufell'],
    ['Praia da Marinha 🇵🇹🌅', 'Praia da Marinha'],
    ['Machhörndl Kaffee ☕️😌', 'Machhörndl Kaffee'],
  ];
  for (const [text, expected] of cases) {
    const top = placeCandidates(text).candidates.slice(0, 3).map((c) => c.text.toLowerCase());
    ok(top.includes(expected.toLowerCase()),
      `"${text}" gave ${top.length ? top.join(' | ') : 'nothing'} instead of "${expected}"`);
  }
  return `${cases.length} single-word and short captions recognized`;
});

test('Place candidates: cities that look like everyday words', () => {
  // Essen and Bergen are real cities and must not fall victim to the
  // stop list.
  for (const [text, expected] of [['Essen 🇩🇪', 'Essen'], ['Bergen 🇳🇴🏔', 'Bergen']]) {
    const top = placeCandidates(text).candidates.map((c) => c.text.toLowerCase());
    ok(top.includes(expected.toLowerCase()), `"${text}" gave ${top.join(' | ') || 'nothing'}`);
  }
  return 'Essen and Bergen are kept';
});

test('Place candidates: no place at all', () => {
  const empty = [
    'Guten Morgen ihr Lieben ❤️ #love #instagood #reels',
    'Nur ein Selfie, nichts weiter #ootd #mood',
    'Werbung | Anzeige',
    'Endlich Wochenende ☀️ #vibes',
    '❤️❤️❤️',
    '#reels #fyp #viral',
  ];
  for (const text of empty) {
    const { candidates } = placeCandidates(text);
    ok(candidates.length === 0,
      `"${text}" should have found nothing, found: ${candidates.map((c) => c.text).join(', ')}`);
  }
  return `${empty.length} captions without a place correctly left empty`;
});

test('Place candidates: English with flag', () => {
  const r = placeCandidates('Sunset at Praia da Marinha 🇵🇹 #algarve #portugal #travel');
  equal(r.countries, ['PT']);
  ok(r.candidates.some((c) => /marinha/i.test(c.text)), `found: ${r.candidates.map((c) => c.text).join(', ')}`);
  return 'Country PT, place Praia da Marinha';
});

test('Flag resolves ambiguity', () => {
  const matches = [
    { name: 'Paris', address: 'Texas, USA', countryCode: 'US', category: 'place', kind: 'city', importance: 0.5, lat: 33.6, lon: -95.5 },
    { name: 'Paris', address: 'Île-de-France, FR', countryCode: 'FR', category: 'place', kind: 'city', importance: 0.9, lat: 48.8, lon: 2.3 },
  ];
  const withoutFlag = scoreMatches(matches, { countries: [] });
  const withFlag = scoreMatches(matches, { countries: ['US'] });
  equal(withFlag[0].countryCode, 'US', 'with US flag');
  equal(scoreMatches(matches, { countries: ['FR'] })[0].countryCode, 'FR', 'with FR flag');
  return `without flag ${withoutFlag[0].address} first, with 🇺🇸 Texas first`;
});

test('Specific place beats whole country', () => {
  const t = scoreMatches([
    { name: 'Italien', address: '', countryCode: 'IT', category: 'place', kind: 'country', importance: 0.95, lat: 42, lon: 12 },
    { name: 'Bar Luce', address: 'Mailand', countryCode: 'IT', category: 'amenity', kind: 'bar', importance: 0.3, lat: 45.4, lon: 9.2 },
  ], {});
  equal(t[0].name, 'Bar Luce');
  return 'Bar before country';
});

test('Filter tag suggestions', () => {
  const t = tagSuggestions('Lecker! #Ramen #tokyo #food #reels #foodporn #shibuya');
  ok(t.includes('ramen') && t.includes('tokyo') && t.includes('shibuya'), `got: ${t}`);
  ok(!t.includes('food') && !t.includes('reels'), 'generic tag slipped through');
  return `remaining: ${t.join(', ')}`;
});

test('Parse Apple Guide (your example link)', () => {
  const { title, entries } = readAppleGuide(APPLE_UG);
  equal(title, 'Epic Gamering');
  equal(entries.length, 3, 'number of places');
  equal(entries.map((e) => e.name), ['Hive Gaming', '404', 'Red Bull Gaming Garden']);
  near(entries[0].lat, 49.445866, 1e-5, 'Nürnberg latitude');
  near(entries[0].lon, 11.049796, 1e-5, 'Nürnberg longitude');
  near(entries[1].lat, 51.094296, 1e-5, 'Dresden');
  near(entries[2].lat, 48.169766, 1e-5, 'München');
  ok(/Holzschuherstraße 36/.test(entries[0].address), 'address');
  return '3 places with name, address and coordinates';
});

const APPLE_UG_IDS = [
  '4053793356543820372', '14921016072022586346', '9816041141257892933', '4149090964667769162',
  '5722912085441730191', '3509017914921167370', '14862164460984384322',
];

test('Apple Guide: known Apple Maps places come as IDs', () => {
  const { entries, appleIds } = readAppleGuide(APPLE_UG);
  equal(entries.length, 3, 'inline places');
  equal(appleIds, APPLE_UG_IDS, 'Apple place IDs in guide order');
  const link = readLink(APPLE_UG);
  equal(link.name, 'Epic Gamering');
  equal(link.entries.length, 3);
  equal(link.appleIds, APPLE_UG_IDS, 'readLink passes the IDs through');
  equal(readLink('https://maps.apple.com/place?coordinate=40.7,-73.9&name=Met').appleIds, [], 'no IDs for a place link');
  equal(readLink('https://www.google.com/maps/place/Y/@52.52,13.405,15z').appleIds, [], 'no IDs for a Google link');
  return '3 inline + 7 IDs';
});

test('Apple Guide: POI (9902) and region (6489) IDs are both looked up, unknown kinds are not', () => {
  const link = ugLink([
    pbText(1, 'Synthetic Guide'),
    pbIdRef(9902, '1234567890123456789'),
    pbIdRef(6489, '9876543210987'),
    pbIdRef(1234, '555'),
    pbPin('Pin?', 'Teststraße 1, Testdorf', 47.5, 11.25),
  ]);
  const { title, entries, appleIds } = readAppleGuide(link);
  equal(title, 'Synthetic Guide');
  equal(appleIds, ['1234567890123456789', '9876543210987'], 'POI and region IDs in guide order');
  equal(entries.length, 1, 'the inline pin');
  equal(entries[0].name, 'Pin');
  near(entries[0].lat, 47.5, 1e-9); near(entries[0].lon, 11.25, 1e-9);
  return '2 IDs + 1 pin, kind 1234 ignored';
});

test('Apple Guide: the maps.apple.com/guides?user= form (base64url) reads like ug=', () => {
  const link = ugLink([pbText(1, 'Synthetic Guide'), pbIdRef(9902, '1001'), pbPin('Pin?', 'Street 1, Town', 47.1, 11.1), pbIdRef(6489, '1002')]);
  const user = new URL(link).searchParams.get('ug').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const userLink = `https://maps.apple.com/guides?user=${user}`;
  equal(readAppleGuide(userLink), readAppleGuide(link));
  equal(readAppleGuide(userLink).appleIds, ['1001', '1002']);
  const r = readLink(userLink);
  equal(r.name, 'Synthetic Guide');
  equal(r.appleIds, ['1001', '1002']);
  equal(r.entries.length, 1);
  return 'user= and ug= give the same guide';
});

test('Apple Guide: a raw ug link with "+" (unencoded) reads like the encoded one', () => {
  const link = ugLink([pbText(1, 'Plus Guide'), pbIdRef(9902, '1016'), pbIdRef(6489, '2002')]);
  ok(link.includes('%2B'), 'the test link must contain %2B');
  const raw = decodeURIComponent(link); // ug=…+…==, as a Shortcut may hand it over
  ok(raw.includes('+'), 'raw link has a plus');
  equal(readAppleGuide(raw), readAppleGuide(link));
  equal(readAppleGuide(raw).appleIds, ['1016', '2002']);
  return '"+" survives';
});

test('Apple Maps URLs from the Shortcut\'s "Get Maps URL" become one place', () => {
  const one = (u) => { const r = readLink(u); equal(r.entries.length, 1, u); equal(r.appleIds, [], u); return r.entries[0]; };
  const a = one('https://maps.apple.com/?ll=48.1,11.5&q=Caf%C3%A9%20Test');
  equal([a.name, a.lat, a.lon], ['Café Test', 48.1, 11.5]);
  const b = one('https://maps.apple.com/?address=Teststr.%201,%2080331%20Town&auid=123&ll=48.1,11.5&q=Caf%C3%A9');
  equal([b.name, b.address, b.lat, b.lon], ['Café', 'Teststr. 1, 80331 Town', 48.1, 11.5]);
  const c = one('https://maps.apple.com/place?coordinate=48.2,11.6&name=Spot&address=Street%202');
  equal([c.name, c.address, c.lat, c.lon], ['Spot', 'Street 2', 48.2, 11.6]);
  return 'll=, address= and coordinate= forms';
});

test('Apple Guide: looked-up places become import entries, unknown ones stay unchecked', () => {
  const found = new Map([['111', { id: '111', ok: true, name: 'Clutch23', address: 'Fellbach, Germany', lat: 48.8196266, lon: 9.2741936 }]]);
  const e = appleIdEntries(['111', '222'], found);
  equal(e.length, 2);
  equal(e[0], {
    name: 'Clutch23', address: 'Fellbach, Germany', lat: 48.8196266, lon: 9.2741936,
    url: 'https://maps.apple.com/place?auid=111', source: 'apple-guide', note: '', warning: '',
  });
  equal(e[1].lat, null); equal(e[1].lon, null);
  equal(e[1].name, 'Apple Maps place');
  equal(e[1].warning, 'Look this place up with the Shortcut or the computer script.');
  equal(e[1].checked, false, 'unchecked by default');
  ok(isAppleIdLink(e[1].url), 'auid link recognized');
  ok(!isAppleIdLink('https://maps.apple.com/place?coordinate=1,2'), 'other Apple link');
  ok(!isAppleIdLink(''), 'empty');
  return '1 found, 1 unchecked';
});

test('Apple place links', () => {
  const a = readApplePlace('https://maps.apple.com/place?coordinate=40.779092,-73.962932&name=Met');
  near(a.lat, 40.779092, 1e-6); near(a.lon, -73.962932, 1e-6); equal(a.name, 'Met');
  const b = readApplePlace('https://maps.apple.com/?ll=48.8584,2.2945&q=Eiffelturm');
  near(b.lat, 48.8584, 1e-6); equal(b.name, 'Eiffelturm');
  equal(readApplePlace('https://example.com/x'), null, 'foreign URL');
  return 'coordinate= and ll= read';
});

test('Google Maps coordinates', () => {
  const precise = googleCoordinates('https://www.google.com/maps/place/X/@49.1,11.1,17z/data=!4m6!3m5!1s0x0!8m2!3d49.4539!4d11.0775');
  near(precise.lat, 49.4539, 1e-6, 'from !3d');
  ok(precise.precise, 'should have counted as precise');
  const center = googleCoordinates('https://www.google.com/maps/place/Y/@52.52,13.405,15z');
  near(center.lat, 52.52, 1e-6, 'from @');
  ok(!center.precise, 'should have counted as imprecise');
  equal(googleCoordinates('https://maps.app.goo.gl/abc123'), null, 'short link');
  return '!3d!4d preferred, @ as fallback';
});

test('Parse CSV', () => {
  const z = csvRows('Title,Note,URL\n"Café, klein","Sagt ""hallo""",https://x.y\nZwei,,https://a.b\n');
  equal(z.length, 3);
  equal(z[1][0], 'Café, klein', 'comma in field');
  equal(z[1][1], 'Sagt "hallo"', 'doubled quotes');
  return 'RFC 4180 cases';
});

test('Google list CSV', () => {
  const e = readGoogleCsv(
    'Title,Note,URL\n' +
    'Bar Luce,schön,https://www.google.com/maps/place/Bar+Luce/@45.4,9.2,17z/data=!3d45.4719!4d9.1721\n' +
    'Irgendwo,,https://maps.app.goo.gl/xyz\n', 'Mailand.csv');
  equal(e.length, 2);
  near(e[0].lat, 45.4719, 1e-6);
  equal(e[0].tagSuggestion, 'mailand', 'list name as tag');
  equal(e[1].lat, null, 'short link has no coordinate yet');
  ok(/short link/i.test(e[1].warning), 'warning missing');
  return '1 with coordinate, 1 to resolve';
});

test('Google Takeout GeoJSON', () => {
  const e = readTakeoutGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-118.2474, 34.0527] },
      properties: { Title: 'Echo Park', 'Google Maps URL': 'http://maps.google.com/?cid=1',
        Location: { Address: 'Los Angeles', 'Geo Coordinates': { Latitude: '34.0527', Longitude: '-118.2474' } } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Title: 'Kaputt' } },
  ] });
  equal(e.length, 2);
  near(e[0].lat, 34.0527, 1e-4);
  equal(e[1].lat, null, '0/0 must count as unusable');
  return 'Coordinates read, 0/0 discarded';
});
