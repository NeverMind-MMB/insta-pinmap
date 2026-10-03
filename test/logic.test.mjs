// test/logic.test.mjs — the selftest logic checks, runnable in Node.
// KML/GPX checks stay browser-only (they need DOMParser).
import { test } from 'node:test';
import {
  shortcode, normalisiereLink, entfernung, entfernungText, findePost, baueIndex, nahePins,
} from '../web/js/dedupe.js';
import { ortsKandidaten, flaggenLaender, tagInWorte, tagVorschlaege, bewerteTreffer } from '../web/js/extract.js';
import {
  leseAppleGuide, leseAppleOrt, googleKoordinaten, leseTakeoutGeoJSON, leseGoogleCSV, csvZeilen,
} from '../web/js/importers.js';

function gleich(a, b, was = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${was} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
function wahr(b, was) { if (!b) throw new Error(was || 'Condition not met'); }
function nah(a, b, tol, was = '') {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${was} ${a} differs from ${b} by more than ${tol}`);
}

const APPLE_UG = 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5nElcaM0hvbHpzY2h1aGVyc3RyYcOfZSAzNiwgOTA0MzkgTsO8cm5iZXJnLCBEZXV0c2NobGFuZCISCak0vB8SuUhAEcvv2d9%2BGSZAKgxIaXZlIEdhbWluZz8SDQiuTRDUhIiNx%2FL9oDgSURo1R3Jvw59lbmhhaW5lciBTdHJhw59lIDE4OCwgMDExMjkgRHJlc2RlbiwgRGV1dHNjaGxhbmQiEgna1vjlEYxJQBErmInXrHArQCoENDA0PxJrGjxPbHltcGlhcGFyaywgVG9uaS1NZXJrZW5zLVdlZyA0LCA4MDgwOSBNw7xuY2hlbiwgRGV1dHNjaGxhbmQiEgmZbbTiuhVIQBHGXDAhvhQnQCoXUmVkIEJ1bGwgR2FtaW5nIEdhcmRlbj8SDgiuTRDq57OmgKKGic8BEg4Irk0Qxeiv6pCt5ZyIARINCK5NEMrCuI7%2Bh6LKORINCK5NEI%2BtreyGx%2Fe1TxINCK5NEIrU7sq7pqLZMBIOCK5NEML2otPY%2BsCgzgE%3D';

test('Normalize Instagram links', () => {
  const gleiche = [
    'https://www.instagram.com/p/C8xYz_1AbCd/',
    'https://instagram.com/p/C8xYz_1AbCd',
    'https://www.instagram.com/reel/C8xYz_1AbCd/?igsh=MXY123&utm_source=ig_web',
    'https://www.instagram.com/reels/C8xYz_1AbCd/',
    'https://www.instagram.com/machhoerndl/p/C8xYz_1AbCd/',
    'instagram.com/tv/C8xYz_1AbCd/',
  ];
  for (const l of gleiche) gleich(shortcode(l), 'C8xYz_1AbCd', l);
  gleich(normalisiereLink(gleiche[2]), 'https://www.instagram.com/p/C8xYz_1AbCd/');
  gleich(shortcode('https://example.com/p/abc'), null, 'foreign URL');
  return `${gleiche.length} spellings reduced to one form`;
});

test('Distance (haversine)', () => {
  // Brandenburg Gate -> Berlin TV Tower, about 2,2 km
  nah(entfernung(52.5163, 13.3777, 52.5208, 13.4094), 2200, 120, 'Berlin');
  // Nürnberg -> München, about 151 km
  nah(entfernung(49.4539, 11.0775, 48.1372, 11.5755) / 1000, 151, 4, 'Nbg-M');
  nah(entfernung(0, 0, 0, 0), 0, 0.001, 'same point');
  gleich(entfernungText(87), '87 m');
  gleich(entfernungText(1234), '1,2 km');
  return 'Berlin 2,2 km · Nürnberg→München 151 km';
});

test('Detect duplicate posts', () => {
  const db = baueIndex({ pins: [{
    id: 'p1', lat: 49.45, lon: 11.07, title: 'Test', tags: [],
    posts: [{ url: 'https://www.instagram.com/p/AAA111/' }],
  }], postIndex: {} });
  wahr(findePost(db, 'https://www.instagram.com/reel/AAA111/?igsh=xyz'), 'Reel form not recognized');
  gleich(findePost(db, 'https://www.instagram.com/p/BBB222/'), null, 'other post');
  gleich(db.postIndex.AAA111, 'p1', 'Index');
  return 'Index and full scan agree';
});

test('Find nearby pins', () => {
  const db = { pins: [
    { id: 'a', lat: 49.4500, lon: 11.0700, title: 'A' },
    { id: 'b', lat: 49.4502, lon: 11.0700, title: 'B' },   // ~22 m
    { id: 'c', lat: 49.5000, lon: 11.0700, title: 'C' },   // ~5,5 km
  ] };
  gleich(nahePins(db, 49.45, 11.07, 150).map((x) => x.pin.id), ['a', 'b']);
  gleich(nahePins(db, 49.45, 11.07, 150, 'a').map((x) => x.pin.id), ['b'], 'with exclusion');
  gleich(nahePins(db, 49.45, 11.07, 10).map((x) => x.pin.id), ['a']);
  return 'Threshold works in both directions';
});

test('Evaluate flag emoji', () => {
  gleich(flaggenLaender('Traum 🇫🇷'), ['FR']);
  gleich(flaggenLaender('🇩🇪 und 🇮🇹'), ['DE', 'IT']);
  gleich(flaggenLaender('ohne'), []);
  return 'FR, DE+IT, none';
});

test('Split hashtags into words', () => {
  gleich(tagInWorte('#NuernbergFood'), 'Nuernberg Food');
  gleich(tagInWorte('cafe_hamburg'), 'cafe hamburg');
  gleich(tagInWorte('#OSMKarte'), 'OSM Karte');
  return 'CamelCase and underscores';
});

test('Place candidates: explicit marker', () => {
  const { candidates } = ortsKandidaten('Bester Kaffee ☕ 📍 Machhörndl Kaffee, Nürnberg #coffee #foodie');
  wahr(candidates.length > 0, 'nothing found');
  wahr(/Machhörndl/i.test(candidates[0].text), `top result was: ${candidates[0].text}`);
  return `Best: "${candidates[0].text}"`;
});

test('Place candidates: hashtags only', () => {
  const { candidates } = ortsKandidaten('So schön hier! #Lissabon #reels #travel #foodporn #love');
  const texte = candidates.map((c) => c.text.toLowerCase());
  wahr(texte.some((t) => t.includes('lissabon')), `found: ${texte.join(' | ')}`);
  wahr(!texte.some((t) => ['reels', 'travel', 'love', 'foodporn'].includes(t)), 'generic tag slipped through');
  return 'Lissabon recognized, generic tags filtered';
});

test('Place candidates: only place name and emoji', () => {
  // The most common case of all, and for a long time completely missed,
  // because the word-sequence rule needed at least two words.
  const faelle = [
    ['Zermatt 🇨🇭❄️', 'Zermatt'],
    ['Hallstatt ⛰️✨', 'Hallstatt'],
    ['Lissabon ❤️🇵🇹', 'Lissabon'],
    ['Neuschwanstein 🏰💫', 'Neuschwanstein'],
    ['Kirkjufell 🇮🇸🏔', 'Kirkjufell'],
    ['Praia da Marinha 🇵🇹🌅', 'Praia da Marinha'],
    ['Machhörndl Kaffee ☕️😌', 'Machhörndl Kaffee'],
  ];
  for (const [text, erwartet] of faelle) {
    const oben = ortsKandidaten(text).candidates.slice(0, 3).map((c) => c.text.toLowerCase());
    wahr(oben.includes(erwartet.toLowerCase()),
      `"${text}" gave ${oben.length ? oben.join(' | ') : 'nothing'} instead of "${erwartet}"`);
  }
  return `${faelle.length} single-word and short captions recognized`;
});

test('Place candidates: cities that look like everyday words', () => {
  // Essen and Bergen are real cities and must not fall victim to the
  // stop list.
  for (const [text, erwartet] of [['Essen 🇩🇪', 'Essen'], ['Bergen 🇳🇴🏔', 'Bergen']]) {
    const oben = ortsKandidaten(text).candidates.map((c) => c.text.toLowerCase());
    wahr(oben.includes(erwartet.toLowerCase()), `"${text}" gave ${oben.join(' | ') || 'nothing'}`);
  }
  return 'Essen and Bergen are kept';
});

test('Place candidates: no place at all', () => {
  const leer = [
    'Guten Morgen ihr Lieben ❤️ #love #instagood #reels',
    'Nur ein Selfie, nichts weiter #ootd #mood',
    'Werbung | Anzeige',
    'Endlich Wochenende ☀️ #vibes',
    '❤️❤️❤️',
    '#reels #fyp #viral',
  ];
  for (const text of leer) {
    const { candidates } = ortsKandidaten(text);
    wahr(candidates.length === 0,
      `"${text}" should have found nothing, found: ${candidates.map((c) => c.text).join(', ')}`);
  }
  return `${leer.length} captions without a place correctly left empty`;
});

test('Place candidates: English with flag', () => {
  const r = ortsKandidaten('Sunset at Praia da Marinha 🇵🇹 #algarve #portugal #travel');
  gleich(r.countries, ['PT']);
  wahr(r.candidates.some((c) => /marinha/i.test(c.text)), `found: ${r.candidates.map((c) => c.text).join(', ')}`);
  return 'Country PT, place Praia da Marinha';
});

test('Flag resolves ambiguity', () => {
  const treffer = [
    { name: 'Paris', address: 'Texas, USA', countryCode: 'US', category: 'place', kind: 'city', importance: 0.5, lat: 33.6, lon: -95.5 },
    { name: 'Paris', address: 'Île-de-France, FR', countryCode: 'FR', category: 'place', kind: 'city', importance: 0.9, lat: 48.8, lon: 2.3 },
  ];
  const ohne = bewerteTreffer(treffer, { countries: [] });
  const mit = bewerteTreffer(treffer, { countries: ['US'] });
  gleich(mit[0].countryCode, 'US', 'with US flag');
  gleich(bewerteTreffer(treffer, { countries: ['FR'] })[0].countryCode, 'FR', 'with FR flag');
  return `without flag ${ohne[0].address} first, with 🇺🇸 Texas first`;
});

test('Specific place beats whole country', () => {
  const t = bewerteTreffer([
    { name: 'Italien', address: '', countryCode: 'IT', category: 'place', kind: 'country', importance: 0.95, lat: 42, lon: 12 },
    { name: 'Bar Luce', address: 'Mailand', countryCode: 'IT', category: 'amenity', kind: 'bar', importance: 0.3, lat: 45.4, lon: 9.2 },
  ], {});
  gleich(t[0].name, 'Bar Luce');
  return 'Bar before country';
});

test('Filter tag suggestions', () => {
  const t = tagVorschlaege('Lecker! #Ramen #tokyo #food #reels #foodporn #shibuya');
  wahr(t.includes('ramen') && t.includes('tokyo') && t.includes('shibuya'), `got: ${t}`);
  wahr(!t.includes('food') && !t.includes('reels'), 'generic tag slipped through');
  return `remaining: ${t.join(', ')}`;
});

test('Parse Apple Guide (your example link)', () => {
  const { titel, eintraege } = leseAppleGuide(APPLE_UG);
  gleich(titel, 'Epic Gamering');
  gleich(eintraege.length, 3, 'number of places');
  gleich(eintraege.map((e) => e.name), ['Hive Gaming', '404', 'Red Bull Gaming Garden']);
  nah(eintraege[0].lat, 49.445866, 1e-5, 'Nürnberg latitude');
  nah(eintraege[0].lon, 11.049796, 1e-5, 'Nürnberg longitude');
  nah(eintraege[1].lat, 51.094296, 1e-5, 'Dresden');
  nah(eintraege[2].lat, 48.169766, 1e-5, 'München');
  wahr(/Holzschuherstraße 36/.test(eintraege[0].address), 'address');
  return '3 places with name, address and coordinates';
});

test('Apple place links', () => {
  const a = leseAppleOrt('https://maps.apple.com/place?coordinate=40.779092,-73.962932&name=Met');
  nah(a.lat, 40.779092, 1e-6); nah(a.lon, -73.962932, 1e-6); gleich(a.name, 'Met');
  const b = leseAppleOrt('https://maps.apple.com/?ll=48.8584,2.2945&q=Eiffelturm');
  nah(b.lat, 48.8584, 1e-6); gleich(b.name, 'Eiffelturm');
  gleich(leseAppleOrt('https://example.com/x'), null, 'foreign URL');
  return 'coordinate= and ll= read';
});

test('Google Maps coordinates', () => {
  const genau = googleKoordinaten('https://www.google.com/maps/place/X/@49.1,11.1,17z/data=!4m6!3m5!1s0x0!8m2!3d49.4539!4d11.0775');
  nah(genau.lat, 49.4539, 1e-6, 'from !3d');
  wahr(genau.genau, 'should have counted as precise');
  const mitte = googleKoordinaten('https://www.google.com/maps/place/Y/@52.52,13.405,15z');
  nah(mitte.lat, 52.52, 1e-6, 'from @');
  wahr(!mitte.genau, 'should have counted as imprecise');
  gleich(googleKoordinaten('https://maps.app.goo.gl/abc123'), null, 'short link');
  return '!3d!4d preferred, @ as fallback';
});

test('Parse CSV', () => {
  const z = csvZeilen('Title,Note,URL\n"Café, klein","Sagt ""hallo""",https://x.y\nZwei,,https://a.b\n');
  gleich(z.length, 3);
  gleich(z[1][0], 'Café, klein', 'comma in field');
  gleich(z[1][1], 'Sagt "hallo"', 'doubled quotes');
  return 'RFC 4180 cases';
});

test('Google list CSV', () => {
  const e = leseGoogleCSV(
    'Title,Note,URL\n' +
    'Bar Luce,schön,https://www.google.com/maps/place/Bar+Luce/@45.4,9.2,17z/data=!3d45.4719!4d9.1721\n' +
    'Irgendwo,,https://maps.app.goo.gl/xyz\n', 'Mailand.csv');
  gleich(e.length, 2);
  nah(e[0].lat, 45.4719, 1e-6);
  gleich(e[0].tagVorschlag, 'mailand', 'list name as tag');
  gleich(e[1].lat, null, 'short link has no coordinate yet');
  wahr(/short link/i.test(e[1].warnung), 'warning missing');
  return '1 with coordinate, 1 to resolve';
});

test('Google Takeout GeoJSON', () => {
  const e = leseTakeoutGeoJSON({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-118.2474, 34.0527] },
      properties: { Title: 'Echo Park', 'Google Maps URL': 'http://maps.google.com/?cid=1',
        Location: { Address: 'Los Angeles', 'Geo Coordinates': { Latitude: '34.0527', Longitude: '-118.2474' } } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Title: 'Kaputt' } },
  ] });
  gleich(e.length, 2);
  nah(e[0].lat, 34.0527, 1e-4);
  gleich(e[1].lat, null, '0/0 must count as unusable');
  return 'Coordinates read, 0/0 discarded';
});
