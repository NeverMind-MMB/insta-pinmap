// test/coords.test.mjs — coordinates, geo: URIs and Plus Codes typed or pasted into the input bar (web/js/coords.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCoords, decodePlusCode, recoverNearest, placeShortCode, formatCoords } from '../web/js/coords.js';

const near = (got, want, eps = 1e-6) => Math.abs(got - want) <= eps;

/** The point readCoords reads from `text`, or fails. */
function point(text) {
  const found = readCoords(text);
  assert.equal(found?.kind, 'point', `${text}: ${JSON.stringify(found)}`);
  return found;
}

function assertPoint(text, lat, lon, eps = 1e-6) {
  const p = point(text);
  assert.ok(near(p.lat, lat, eps) && near(p.lon, lon, eps), `${text}: got ${p.lat}, ${p.lon}; want ${lat}, ${lon}`);
  return p;
}

/* ---------- Plain coordinates: decimal ---------- */

test('decimal coordinates, latitude first: comma, space, semicolon, signs', () => {
  assertPoint('48.1372, 11.5755', 48.1372, 11.5755);
  assertPoint('48.1372 11.5755', 48.1372, 11.5755);
  assertPoint('48.1372,11.5755', 48.1372, 11.5755);
  assertPoint('48.1372; 11.5755', 48.1372, 11.5755);
  assertPoint('-33.8688, 151.2093', -33.8688, 151.2093);
  assertPoint('40.7128, -74.0060', 40.7128, -74.006);
  assertPoint('  48.1372, 11.5755  ', 48.1372, 11.5755);
  assertPoint('48.1, 11.5', 48.1, 11.5); // the whole input: one decimal is enough
});

test('decimal commas only with a space or semicolon between the numbers', () => {
  assertPoint('48,1372 11,5755', 48.1372, 11.5755);
  assertPoint('48,1372; 11,5755', 48.1372, 11.5755);
});

test('decimal coordinates with N/S/E/W letters (after or before the number, with or without °)', () => {
  assertPoint('48.1372N, 11.5755E', 48.1372, 11.5755);
  assertPoint('48.1372° N, 11.5755° E', 48.1372, 11.5755);
  assertPoint('N 48.1372 E 11.5755', 48.1372, 11.5755);
  assertPoint('N48.1372, E11.5755', 48.1372, 11.5755);
  assertPoint('33.8688S 151.2093E', -33.8688, 151.2093);
  assertPoint('40.7128° N, 74.0060° W', 40.7128, -74.006);
  assertPoint('48.1372°, 11.5755°', 48.1372, 11.5755);
  assertPoint('-33.8688°, 151.2093°', -33.8688, 151.2093);
});

test('with letters the order is clear, so longitude first works too', () => {
  assertPoint('11.5755E, 48.1372N', 48.1372, 11.5755);
  assertPoint(`151°12'26"E 33°52'04"S`, -(33 + 52 / 60 + 4 / 3600), 151 + 12 / 60 + 26 / 3600);
});

/* ---------- Degrees, minutes, seconds ---------- */

const DMS_LAT = 48 + 8 / 60 + 14 / 3600;
const DMS_LON = 11 + 34 / 60 + 32 / 3600;

test("degrees-minutes-seconds: 48°08'14\"N 11°34'32\"E, also with ′ ″, curly quotes, º and spaces", () => {
  assertPoint(`48°08'14"N 11°34'32"E`, DMS_LAT, DMS_LON);
  assertPoint('48°08′14″N 11°34′32″E', DMS_LAT, DMS_LON);
  assertPoint('48°08’14”N 11°34’32”E', DMS_LAT, DMS_LON);
  assertPoint(`48º08'14''N, 11º34'32''E`, DMS_LAT, DMS_LON);
  assertPoint(`48° 8' 14" N, 11° 34' 32" E`, DMS_LAT, DMS_LON);
  assertPoint(`N 48° 08' 14" E 11° 34' 32"`, DMS_LAT, DMS_LON);
  assertPoint(`48°08'14.5"N 11°34'32.5"E`, 48 + 8 / 60 + 14.5 / 3600, 11 + 34 / 60 + 32.5 / 3600);
  assertPoint(`33°52'04"S 151°12'26"E`, -(33 + 52 / 60 + 4 / 3600), 151 + 12 / 60 + 26 / 3600);
  assertPoint(`-33°52'04", 151°12'26"`, -(33 + 52 / 60 + 4 / 3600), 151 + 12 / 60 + 26 / 3600);
  assertPoint(`48°08'14"N 11°34'32"O`, DMS_LAT, DMS_LON); // German "Ost"
});

test('degrees and decimal minutes (the geocaching form "N 48° 08.227 E 011° 34.524")', () => {
  assertPoint('N 48° 08.227 E 011° 34.524', 48 + 8.227 / 60, 11 + 34.524 / 60);
  assertPoint(`48°08.227'N 11°34.524'E`, 48 + 8.227 / 60, 11 + 34.524 / 60);
});

test('DMS and decimal coordinates are read as "dms" / "decimal" and say that latitude comes first', () => {
  assert.equal(point('48.1372, 11.5755').form, 'decimal');
  assert.equal(point(`48°08'14"N 11°34'32"E`).form, 'dms');
  assert.match(point('48.1372, 11.5755').status, /latitude, longitude/);
});

/* ---------- What is not coordinates ---------- */

test('out of range, 0,0, bad minutes and ordinary text are no coordinates', () => {
  for (const text of [
    '120.5, 45.2', // latitude out of range: no guessing that it is longitude first
    '48.1372, 200.5',
    '-95.0000, 11.0000',
    '0.0000, 0.0000',
    `48°61'00"N 11°00'00"E`,
    `48°08'75"N 11°00'00"E`,
    'Open 10-18, call 089 1234567',
    'Open 10.30 18.00 daily', // two decimals inside other text: times, not coordinates
    'Cafe Luitpold',
    'Cafe Luitpold Munich',
    '48 11',
    '',
    '   ',
    'N 48 E 11', // letters, but neither a decimal nor a degree sign
  ]) {
    assert.equal(readCoords(text), null, text);
  }
  assert.equal(readCoords(null), null);
  assert.equal(readCoords(undefined), null);
});

test('coordinates inside a link are that link\'s business, not read here', () => {
  for (const text of [
    'https://example.com/?ll=48.1372,11.5755',
    'https://www.instagram.com/p/ABC123xyz/',
    'https://plus.codes/8FWH4HPM+QR',
    'https://www.youtube.com/watch?v=abc123',
  ]) {
    assert.equal(readCoords(text), null, text);
  }
});

/* ---------- Words plus coordinates: the coordinates win, the words become the title ---------- */

test('text with words plus coordinates: the coordinates, and the words as the title suggestion', () => {
  assert.equal(assertPoint('Synthetic Cafe 48.1372, 11.5755', 48.1372, 11.5755).name, 'Synthetic Cafe');
  assert.equal(assertPoint('Meeting point: 48.1372, 11.5755', 48.1372, 11.5755).name, 'Meeting point');
  assert.equal(assertPoint('Synthetic Spot 41.9900N, 6.1200W https://mapy.com/s/abcdef', 41.99, -6.12).name, 'Synthetic Spot');
  assert.equal(assertPoint('Look: https://pin.it/AbCdEf (48.1372, 11.5755)', 48.1372, 11.5755).name, 'Look');
  assert.equal(assertPoint('Synthetic Hut\nN 47° 25.123 E 010° 59.456\nnice view', 47 + 25.123 / 60, 10 + 59.456 / 60).name, 'Synthetic Hut');
});

test('without words, the title suggestion is the coordinates themselves', () => {
  assert.equal(point('48.1372, 11.5755').name, '48.13720, 11.57550');
  assert.equal(point(`48°08'14"N 11°34'32"E`).name, '48.13722, 11.57556');
  assert.equal(formatCoords(-33.8688, 151.2093), '-33.86880, 151.20930');
  // Wikipedia's double form: the first pair; the second is no title.
  assert.equal(assertPoint('48°8′14″N 11°34′32″E / 48.13722°N 11.57556°E', DMS_LAT, DMS_LON).name, '48.13722, 11.57556');
});

test('a long text keeps the coordinates but gives no title', () => {
  const long = `${'A very long caption about a place with many words and no end in sight '.repeat(2)}48.1372, 11.5755`;
  assert.equal(point(long).name, '48.13720, 11.57550');
});

/* ---------- geo: URIs ---------- */

test('geo: URIs: path coordinates, with altitude, uncertainty and zoom', () => {
  assert.equal(assertPoint('geo:48.1372,11.5755', 48.1372, 11.5755).form, 'geo');
  assertPoint('geo:48.1372,11.5755,520', 48.1372, 11.5755);
  assertPoint('geo:48.1372,11.5755;u=35', 48.1372, 11.5755);
  assertPoint('geo:48.1372,11.5755;crs=wgs84;u=35?z=17', 48.1372, 11.5755);
  assertPoint('GEO:48.1,11.5', 48.1, 11.5);
  assertPoint('geo:-33.8688,151.2093', -33.8688, 151.2093);
  assert.equal(point('geo:48.1372,11.5755').name, '48.13720, 11.57550');
});

test('geo: URIs: q=lat,lon(Label) gives the point, the label the title suggestion', () => {
  assert.equal(assertPoint('geo:0,0?q=48.1372,11.5755(Synthetic%20Cafe)', 48.1372, 11.5755).name, 'Synthetic Cafe');
  assert.equal(assertPoint('geo:0,0?q=48.1372,11.5755(Synthetic Cafe)', 48.1372, 11.5755).name, 'Synthetic Cafe');
  assert.equal(assertPoint('geo:0,0?q=48.1372,11.5755(Synthetic+Cafe)', 48.1372, 11.5755).name, 'Synthetic Cafe');
  assert.equal(assertPoint('geo:0,0?q=48.1372,11.5755', 48.1372, 11.5755).name, '48.13720, 11.57550');
  assert.equal(assertPoint('geo:48.2,11.6?q=48.1372,11.5755(Spot)', 48.1372, 11.5755).name, 'Spot', 'q is the marker, the path the map centre');
  assert.equal(assertPoint('geo:48.1372,11.5755?q=Synthetic+Cafe', 48.1372, 11.5755).name, 'Synthetic Cafe');
  assert.equal(assertPoint('geo:0,0?z=10&q=48.1372%2C11.5755%28Synthetic%20Bar%29', 48.1372, 11.5755).name, 'Synthetic Bar');
});

test('geo: URIs: geo:0,0?q=Name is a place search for the name', () => {
  assert.deepEqual(readCoords('geo:0,0?q=Synthetic+Cafe+Munich'), { kind: 'search', query: 'Synthetic Cafe Munich' });
  assert.deepEqual(readCoords('geo:0,0?q=Synthetic%20Cafe%2C%20Munich'), { kind: 'search', query: 'Synthetic Cafe, Munich' });
});

test('geo: URIs inside text are found; ones without a usable place say so', () => {
  assertPoint('Look: geo:48.1372,11.5755 there', 48.1372, 11.5755);
  assert.equal(assertPoint('Geo: 48.1372, 11.5755', 48.1372, 11.5755).form, 'decimal', 'a word before plain coordinates');
  for (const text of ['geo:0,0', 'geo:95,11', 'geo:48,200', 'geo:', 'geo:abc']) {
    const found = readCoords(text);
    assert.equal(found?.kind, 'error', text);
    assert.match(found.message, /geo:/, text);
  }
});

/* ---------- Plus Codes (Open Location Code), full ---------- */

test('full Plus Codes decode offline to the centre of their cell', () => {
  let p = decodePlusCode('8FWH4HPM+QR');
  assert.ok(near(p.lat, 48.1369375) && near(p.lon, 11.5845625), JSON.stringify(p));
  p = decodePlusCode('8FWH4HX8+QH');
  assert.ok(near(p.lat, 48.1494375) && near(p.lon, 11.5664375), JSON.stringify(p));
  p = decodePlusCode('8fwh4hpm+qr');
  assert.ok(near(p.lat, 48.1369375) && near(p.lon, 11.5845625), 'lowercase is fine');
  // An 8-digit code (no digits after "+"): a 0.0025° cell.
  p = decodePlusCode('8FWH4HPM+');
  assert.ok(near(p.lat, 48.136875 - 0.001875 + 0.00125) && near(p.lon, 11.5845 - 0.002 + 0.00125), JSON.stringify(p));
  // Grid digits after the 10th: rows of a fifth in latitude, columns of a quarter in longitude.
  p = decodePlusCode('8FWH4HPM+QRX'); // X = 19 → row 4, column 3
  assert.ok(near(p.lat, 48.136875 + 4 * 0.000025 + 0.0000125, 1e-9) && near(p.lon, 11.5845 + 3 * 0.00003125 + 0.000015625, 1e-9), JSON.stringify(p));
  p = decodePlusCode('62222222+22'); // the south-west corner of its 1° cell
  assert.ok(near(p.lat, -9.9999375) && near(p.lon, -179.9999375), JSON.stringify(p));
});

test('invalid Plus Codes decode to null', () => {
  for (const code of [
    'FFWH4HPM+QR', // first digit beyond 180° of latitude
    '8WWH4HPM+QR', // second digit beyond 360° of longitude
    '8FWH4HPM+Q', // one digit after "+"
    '8FWH4HPMQR', // no "+"
    '8FWH4H+QR', // short, not full
    '8FWH4HPA+QR', // A is no Plus Code digit
    '', null,
  ]) {
    assert.equal(decodePlusCode(code), null, String(code));
  }
});

test('digits beyond the 15th change nothing (the standard ignores them)', () => {
  assert.deepEqual(decodePlusCode('8FWH4HPM+QRXXXXXX'), decodePlusCode('8FWH4HPM+QRXXXXX'));
});

test('a full Plus Code in the input bar is the exact point, titled with the code', () => {
  const p = assertPoint('8FWH4HPM+QR', 48.1369375, 11.5845625);
  assert.equal(p.form, 'pluscode');
  assert.equal(p.name, '8FWH4HPM+QR');
  assert.match(p.status, /Plus Code/);
  assert.equal(assertPoint('8fwh4hpm+qr München', 48.1369375, 11.5845625).name, '8FWH4HPM+QR', 'a town after a full code changes nothing');
  assert.equal(assertPoint('Plus Code: 8FWH4HX8+QH', 48.1494375, 11.5664375).name, '8FWH4HX8+QH');
});

/* ---------- Plus Codes, short (with a town) ---------- */

test('short Plus Codes: the code and the town, in either order and with a comma', () => {
  assert.deepEqual(readCoords('4HX8+QH München'), { kind: 'short', code: '4HX8+QH', place: 'München' });
  assert.deepEqual(readCoords('4HX8+QH, Munich'), { kind: 'short', code: '4HX8+QH', place: 'Munich' });
  assert.deepEqual(readCoords('4hx8+qh München, Deutschland'), { kind: 'short', code: '4HX8+QH', place: 'München, Deutschland' });
  assert.deepEqual(readCoords('Munich 4HX8+QH'), { kind: 'short', code: '4HX8+QH', place: 'Munich' });
  assert.deepEqual(readCoords('WH4HX8+QH Munich'), { kind: 'short', code: 'WH4HX8+QH', place: 'Munich' });
  assert.deepEqual(readCoords('4HX8+QH'), { kind: 'short', code: '4HX8+QH', place: '' });
});

test('coordinates win over a short Plus Code in the same text', () => {
  assertPoint('4HX8+QH Munich 48.1372, 11.5755', 48.1372, 11.5755);
});

test('recoverNearest: the full code nearest to the reference point', () => {
  // Munich as the reference.
  assert.equal(recoverNearest('4HX8+QH', 48.137, 11.575), '8FWH4HX8+QH');
  // The reference just south of the 48° line: the code's cell is the one to the north.
  assert.equal(recoverNearest('4HX8+QH', 47.99, 11.575), '8FWH4HX8+QH');
  // The reference just east of 12°: the code's cell is the one to the west.
  assert.equal(recoverNearest('4HX8+QH', 48.137, 12.01), '8FWH4HX8+QH');
  // Six digits left: a 0.05° area, recovered from a reference a few km away.
  assert.equal(recoverNearest('X8+QH', 48.16, 11.55), '8FWH4HX8+QH');
  assert.equal(recoverNearest('WH4HX8+QH', 48.6, 11.2), '8FWH4HX8+QH');
  // Across the antimeridian.
  assert.equal(recoverNearest('2222+22', -10, 179.9), '62222222+22');
  // Cases from the standard's published test data: the reference in the neighbouring cell on
  // each side, all eight digits missing, and a short code with nothing after "+".
  assert.equal(recoverNearest('2GGG+GG', 46.976, 8.526), '8FVC2GGG+GG');
  assert.equal(recoverNearest('XGGG+GG', 47.026, 8.526), '8FRCXGGG+GG');
  assert.equal(recoverNearest('GXGG+GG', 46.526, 8.026), '8FR9GXGG+GG');
  assert.equal(recoverNearest('G2GG+GG', 46.526, 7.976), '8FRCG2GG+GG');
  assert.equal(recoverNearest('+2VX', 51.3701125, -1.217765625), '9C3W9QCJ+2VX');
  assert.equal(recoverNearest('22+', 42.899, 9.012), '8FJFW222+');
  assert.equal(recoverNearest('2222+22', 89.6, 0), 'CFX22222+22', 'near the pole');
  // Lowercase in, uppercase out; a full code stays itself.
  assert.equal(recoverNearest('4hx8+qh', 48.137, 11.575), '8FWH4HX8+QH');
  assert.equal(recoverNearest('8FWH4HPM+QR', 0, 0), '8FWH4HPM+QR');
  assert.equal(recoverNearest('nonsense', 48, 11), null);
});

/** A place search stub: answers `results` (or fails) and records the queries. */
function fakeSearch(results, ok = true) {
  const queries = [];
  const search = async (q) => { queries.push(q); return ok ? { ok: true, results } : { ok: false, results: [], message: "Place search isn't responding." }; };
  return { search, queries };
}

test('placeShortCode: the town from the place search is the reference point', async () => {
  const { search, queries } = fakeSearch([{ lat: 48.137, lon: 11.575, name: 'Synthetic Town' }]);
  const p = await placeShortCode({ code: '4HX8+QH', place: 'Synthetic Town' }, search);
  assert.deepEqual(queries, ['Synthetic Town']);
  assert.equal(p.ok, true);
  assert.equal(p.code, '8FWH4HX8+QH');
  assert.ok(near(p.lat, 48.1494375) && near(p.lon, 11.5664375));
  assert.match(p.status, /Synthetic Town/);
});

test('placeShortCode: a town the search doesn\'t know, a search that is down, or no town at all: say so', async () => {
  let p = await placeShortCode({ code: '4HX8+QH', place: 'Atlantis' }, fakeSearch([]).search);
  assert.equal(p.ok, false);
  assert.match(p.message, /Couldn't find "Atlantis"/);
  p = await placeShortCode({ code: '4HX8+QH', place: 'Munich' }, fakeSearch([], false).search);
  assert.equal(p.ok, false);
  assert.match(p.message, /isn't responding/);
  const { search, queries } = fakeSearch([{ lat: 1, lon: 2 }]);
  p = await placeShortCode({ code: '4HX8+QH', place: '' }, search);
  assert.equal(p.ok, false);
  assert.match(p.message, /town/);
  assert.deepEqual(queries, [], 'nothing searched');
});

/* ---------- The input bar (addflow.startAdd) ---------- */

const { startAdd, wireConfirm } = await import('../web/js/addflow.js');
const { store, normalizeDb } = await import('../web/js/store.js');

/** A document just big enough for the confirm dialog; without #confirm-map the preview map stays off. */
function confirmDocument() {
  const make = (tag = '') => {
    const on = {};
    return {
      tag, hidden: false, open: false, disabled: false, checked: false, value: '', textContent: '', innerHTML: '', scrollTop: 0,
      style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [],
      setAttribute() {}, focus() {}, select() {},
      appendChild(kid) { this.children.push(kid); return kid; },
      append(...kids) { this.children.push(...kids); },
      replaceChildren(...kids) { this.children = kids; },
      querySelector: () => make(),
      querySelectorAll: () => [],
      addEventListener(type, fn) { (on[type] ??= []).push(fn); },
      fire(type) { for (const fn of on[type] || []) fn({ preventDefault() {} }); },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire('close'); },
    };
  };
  const els = new Map();
  return {
    getElementById: (id) => (id === 'confirm-map' ? null : els.get(id) ?? els.set(id, make()).get(id)),
    createElement: (tag) => make(tag), createTextNode: () => ({}), querySelectorAll: () => [],
  };
}

/**
 * Runs startAdd(text) with the confirm dialog wired; fetch answers like Photon with `photon` features.
 * Returns the dialog's fields, the requests, the toasts and the dialogs shown; `save` presses Drop pin.
 */
async function addInBar(text, { photon = [] } = {}) {
  const doc = confirmDocument();
  globalThis.document = doc;
  store.db = normalizeDb({});
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('photon') ? { features: photon } : [];
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  const toasts = [];
  const shown = [];
  const env = {
    toast: (t, kind) => toasts.push([t, kind]), hideToast() {}, redraw() {}, inputDone() {},
    showUnsupported: (l) => shown.push(['unsupported', l]), showImport: () => shown.push(['import']),
  };
  wireConfirm(env);
  await startAdd(text, env);
  const field = (id) => doc.getElementById(id);
  return {
    open: field('dlg-confirm').open, title: field('confirm-title').value, coords: field('confirm-coords').textContent,
    status: field('confirm-status').textContent, calls, toasts, shown,
    save() { field('confirm-save').fire('click'); return store.db.pins; },
  };
}

/** Drops addInBar's fake document and the store's pending save. */
function cleanUp() {
  delete globalThis.document;
  clearTimeout(store._saveTimer);
  store._saveTimer = null;
}

test('the input bar: coordinates open Confirm place with the exact point, no place search, and say latitude comes first', async () => {
  try {
    const r = await addInBar('48.1372, 11.5755');
    assert.equal(r.open, true);
    assert.deepEqual(r.calls, [], 'nothing searched');
    assert.equal(r.coords, '48.13720, 11.57550');
    assert.equal(r.title, '48.13720, 11.57550');
    assert.match(r.status, /latitude, longitude/);
    const pins = r.save();
    assert.equal(pins.length, 1);
    assert.equal(pins[0].source, 'coords');
    assert.equal(pins[0].lat, 48.1372);
    assert.equal(pins[0].lon, 11.5755);
  } finally {
    cleanUp();
  }
});

test('the input bar: DMS, a geo: URI with a label and a full Plus Code each open Confirm place without searching', async () => {
  try {
    for (const [text, coords, title] of [
      [`48°08'14"N 11°34'32"E`, '48.13722, 11.57556', '48.13722, 11.57556'],
      ['geo:0,0?q=48.1372,11.5755(Synthetic%20Cafe)', '48.13720, 11.57550', 'Synthetic Cafe'],
      ['8FWH4HPM+QR', '48.13694, 11.58456', '8FWH4HPM+QR'],
      ['Synthetic Bar 48.1372, 11.5755', '48.13720, 11.57550', 'Synthetic Bar'],
    ]) {
      const r = await addInBar(text);
      assert.equal(r.open, true, text);
      assert.deepEqual(r.calls, [], `${text}: nothing searched`);
      assert.equal(r.coords, coords, text);
      assert.equal(r.title, title, text);
      cleanUp();
    }
  } finally {
    cleanUp();
  }
});

test('the input bar: coordinates next to a link this version doesn\'t read: the coordinates, not the unsupported-link dialog', async () => {
  try {
    const r = await addInBar('Synthetic Spot 41.9900N, 6.1200W https://mapy.com/s/abcdef');
    assert.deepEqual(r.shown, []);
    assert.equal(r.open, true);
    assert.equal(r.coords, '41.99000, -6.12000');
    assert.equal(r.title, 'Synthetic Spot');
  } finally {
    cleanUp();
  }
});

test('the input bar: a link with coordinates only inside it still opens the unsupported-link dialog', async () => {
  try {
    const r = await addInBar('https://example.com/?ll=48.1372,11.5755');
    assert.deepEqual(r.shown, [['unsupported', 'https://example.com/?ll=48.1372,11.5755']]);
    assert.equal(r.open, false);
  } finally {
    cleanUp();
  }
});

test('the input bar: a short Plus Code with a town: the town from the place search, then the exact point', async () => {
  try {
    const photon = [{ geometry: { coordinates: [11.575, 48.137] }, properties: { name: 'Synthetic Town', countrycode: 'de' } }];
    const r = await addInBar('4HX8+QH Synthetic Town', { photon });
    assert.equal(r.calls.length, 1);
    assert.match(r.calls[0], /photon\.komoot\.io\/api\/\?q=Synthetic\+Town/);
    assert.equal(r.open, true);
    assert.equal(r.coords, '48.14944, 11.56644');
    assert.equal(r.title, '4HX8+QH Synthetic Town');
    assert.match(r.status, /Synthetic Town/);
  } finally {
    cleanUp();
  }
});

test('the input bar: a short Plus Code whose town can\'t be found, or without a town: an error, no dialog', async () => {
  try {
    let r = await addInBar('4HX8+QH Atlantis');
    assert.equal(r.open, false);
    assert.equal(r.toasts.at(-1)[1], 'error');
    assert.match(r.toasts.at(-1)[0], /Couldn't find "Atlantis"/);
    cleanUp();
    r = await addInBar('4HX8+QH');
    assert.equal(r.open, false);
    assert.deepEqual(r.calls, []);
    assert.match(r.toasts.at(-1)[0], /town/);
  } finally {
    cleanUp();
  }
});

test('the input bar: geo:0,0?q=Name searches for the name; a geo: link without a place says so', async () => {
  try {
    let r = await addInBar('geo:0,0?q=Synthetic+Cafe+Munich');
    assert.equal(r.open, true);
    assert.ok(r.calls.some((u) => /photon.*q=Synthetic\+Cafe\+Munich/.test(u)), r.calls.join(' '));
    cleanUp();
    r = await addInBar('geo:0,0');
    assert.equal(r.open, false);
    assert.match(r.toasts.at(-1)[0], /geo:/);
    assert.equal(r.toasts.at(-1)[1], 'error');
  } finally {
    cleanUp();
  }
});

test('the input bar: an out-of-range number pair is no coordinates: it goes to the place search', async () => {
  try {
    const r = await addInBar('120.5, 45.2');
    assert.equal(r.open, true);
    assert.ok(r.calls.some((u) => /photon/.test(u)), 'searched as text');
    assert.equal(r.coords, '', 'no point chosen');
  } finally {
    cleanUp();
  }
});
