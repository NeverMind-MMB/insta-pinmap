// test/country.test.mjs — country flags on matches and country/region words as hints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagEmoji, countryHints, placeCandidates, scoreMatches } from '../web/js/extract.js';

test('flagEmoji', () => {
  assert.equal(flagEmoji('AT'), '🇦🇹');
  assert.equal(flagEmoji('de'), '🇩🇪');
  assert.equal(flagEmoji(''), '');
  assert.equal(flagEmoji(undefined), '');
  assert.equal(flagEmoji('XYZ'), '');
  assert.equal(flagEmoji('1A'), '');
});

test('countryHints', () => {
  assert.deepEqual(countryHints('Hallstatt ⛰️ #salzkammergut #austria'), ['AT']);
  assert.deepEqual(countryHints('Hallstadt bei #Bamberg #franken'), ['DE']);
  assert.deepEqual(countryHints('#VisitAustria'), ['AT']);
  assert.deepEqual(countryHints('Turkey sandwich in Chile'), []);
  assert.deepEqual(countryHints('#bavarianalps'), []);
  assert.deepEqual(countryHints('Sommer in Tirol und Südtirol'), ['AT', 'IT']);
  assert.deepEqual(countryHints('Österreich, Tirol, Germany'), ['AT', 'DE']);
  assert.deepEqual(countryHints(''), []);
  assert.deepEqual(countryHints('Island ist schön'), []);
});

test('placeCandidates: hintedCountries excludes flag codes', () => {
  const r = placeCandidates('🇦🇹 #austria');
  assert.deepEqual(r.countries, ['AT']);
  assert.deepEqual(r.hintedCountries, []);
  const h = placeCandidates('Hallstatt #salzkammergut #franken');
  assert.deepEqual(h.countries, []);
  assert.deepEqual(h.hintedCountries, ['AT', 'DE']);
});

const matches = () => [
  { lat: 47.56, lon: 13.65, name: 'Rathaus', address: 'Hallstatt, AT', kind: 'townhall', category: 'amenity', countryCode: 'AT', importance: null },
  { lat: 47.5622, lon: 13.6493, name: 'Hallstatt', address: 'Austria', kind: 'village', category: 'place', countryCode: 'AT', importance: 0.5 },
  { lat: 49.9, lon: 10.9, name: 'Hallstattstraße', address: 'Bamberg, DE', kind: 'service', category: 'highway', countryCode: 'DE', importance: 0.1 },
];
const rank = (ms, ctx) => scoreMatches(ms, ctx).map((m) => m.countryCode + ':' + m.name);

test('scoreMatches: hints move matches up', () => {
  const base = scoreMatches(matches(), { candidatePoints: 50 });
  const de = scoreMatches(matches(), { candidatePoints: 50, hintedCountries: ['DE'] });
  const pos = (l) => l.findIndex((m) => m.countryCode === 'DE');
  assert.ok(pos(de) < pos(base));
  const at = scoreMatches(matches(), { candidatePoints: 50, hintedCountries: ['AT'] });
  assert.equal(at[0].countryCode, 'AT');
  const d = scoreMatches([matches()[2]], { candidatePoints: 50 })[0].points;
  assert.equal(scoreMatches([matches()[2]], { candidatePoints: 50, hintedCountries: ['DE'] })[0].points - d, 20);
  assert.equal(scoreMatches([matches()[2]], { candidatePoints: 50, hintedCountries: ['AT'] })[0].points - d, -10);
});

test('scoreMatches: hints ignored when flags exist', () => {
  const a = rank(matches(), { candidatePoints: 50, countries: ['AT'] });
  const b = rank(matches(), { candidatePoints: 50, countries: ['AT'], hintedCountries: ['DE'] });
  assert.deepEqual(a, b);
});
