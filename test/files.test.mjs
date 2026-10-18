// test/files.test.mjs — file imports (2.2.0): CSV with coordinate columns, TSV and semicolon files,
// the newer Google Takeout "Saved Places" format, and no pins at 0,0. All data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, readGoogleCsv, readTakeoutGeoJSON, csvRows, skippedPlacesNotice } from '../web/js/importers.js';
import { csvDialect, csvColumns } from '../web/js/csvcolumns.js';

/** A file as readFile sees it. */
const file = (name, text) => ({ name, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer });
/** name, lat, lon of each entry. */
const spots = (entries) => entries.map((e) => [e.name, e.lat, e.lon]);

/* ---------- Delimiter: tab, semicolon or comma, from the header line ---------- */

test('csvDialect: tab beats semicolon beats comma; quoted delimiters do not count; Excel\'s "sep=" line decides', () => {
  assert.equal(csvDialect('Title\tNote\tURL\nA\tb, c\thttps://x.y\n').delimiter, '\t');
  assert.equal(csvDialect('Name;Breite;Länge\nA;48,1;11,5\n').delimiter, ';');
  assert.equal(csvDialect('Title,Note,URL\nA,,https://x.y\n').delimiter, ',');
  assert.equal(csvDialect('"Name;Ort",Lat,Lon\n"A;B",48.1,11.5\n').delimiter, ',', 'a ; inside quotes');
  assert.equal(csvDialect('Name;Straße, Nr.;Ort\nA;Weg 1;Testtown\n').delimiter, ';', 'a comma in a semicolon file\'s header');
  assert.equal(csvDialect('name,lat,lon,notes;misc\nA,48.1,11.5,x\n').delimiter, ',', 'a semicolon in a comma file\'s header');
  const sep = csvDialect('sep=;\nName;Lat;Lon\nA;48,1;11,5\n');
  assert.equal(sep.delimiter, ';');
  assert.equal(sep.text, 'Name;Lat;Lon\nA;48,1;11,5\n');
  assert.equal(csvDialect('﻿Name\tLat\tLon\n').delimiter, '\t', 'with a byte order mark');
  assert.equal(csvDialect('Just a name\n').delimiter, ',', 'one column');
});

test('csvRows: the delimiter is a parameter; quotes keep delimiters, line breaks and doubled quotes', () => {
  assert.deepEqual(csvRows('a;"b; c";"say ""hi"""\n1;2;3\n', ';'), [['a', 'b; c', 'say "hi"'], ['1', '2', '3']]);
  assert.deepEqual(csvRows('a\t"b\tc"\td\n', '\t'), [['a', 'b\tc', 'd']]);
  assert.deepEqual(csvRows('a,b\n1,2\n'), [['a', 'b'], ['1', '2']], 'comma by default');
});

/* ---------- Coordinate columns ---------- */

test('csvColumns: latitude/longitude by common header names, one-column pairs, WKT, address', () => {
  const at = (header) => {
    const c = csvColumns(header);
    return [c.lat, c.lon, c.pair, c.wkt, c.address];
  };
  assert.deepEqual(at(['name', 'lat', 'lon']), [1, 2, -1, -1, -1]);
  assert.deepEqual(at(['Name', 'Latitude', 'Longitude', 'Address']), [1, 2, -1, -1, 3]);
  assert.deepEqual(at(['Name', 'Breite', 'Länge', 'Adresse']), [1, 2, -1, -1, 3]);
  assert.deepEqual(at(['Ort', 'Breitengrad', 'Laengengrad']), [1, 2, -1, -1, -1]);
  assert.deepEqual(at(['title', 'lng', 'lat']), [2, 1, -1, -1, -1]);
  assert.deepEqual(at(['label', 'X', 'Y']), [2, 1, -1, -1, -1]);
  assert.deepEqual(at(['x', 'y', 'Latitude (WGS84)', 'Longitude (WGS84)']), [2, 3, -1, -1, -1], 'lat/lon before x/y');
  assert.deepEqual(at(['Name', 'Coordinates']), [-1, -1, 1, -1, -1]);
  assert.deepEqual(at(['Name', 'Location']), [-1, -1, 1, -1, -1]);
  assert.deepEqual(at(['Name', 'lat/lon']), [-1, -1, 1, -1, -1]);
  assert.deepEqual(at(['WKT', 'name', 'description']), [-1, -1, -1, 0, -1]);
  assert.deepEqual(at(['Title', 'Note', 'URL']), [-1, -1, -1, -1, -1]);
  assert.deepEqual(at(['name', 'lat']), [-1, -1, -1, -1, -1], 'a latitude alone is no coordinate');
  assert.equal(csvColumns(['Title', 'Note', 'URL']).coordinates, false);
  assert.equal(csvColumns(['name', 'lat', 'lon']).coordinates, true);
});

test('CSV name,lat,lon: rows with coordinates import exactly, without a search', () => {
  const e = readGoogleCsv('name,lat,lon\nSynthetic Cafe,48.1372,11.5755\nSynthetic Bar,-33.8688,151.2093\n', 'Trip.csv');
  assert.deepEqual(spots(e), [['Synthetic Cafe', 48.1372, 11.5755], ['Synthetic Bar', -33.8688, 151.2093]]);
  assert.ok(e.every((x) => x.warning === '' && x.source === 'csv' && x.tagSuggestion === 'trip'));
});

test('CSV Name,Latitude,Longitude,Address: coordinates and address', () => {
  const [e] = readGoogleCsv('Name,Latitude,Longitude,Address\nSynthetic Cafe,48.1372,11.5755,"Teststrasse 1, Testtown"\n');
  assert.deepEqual([e.name, e.lat, e.lon, e.address], ['Synthetic Cafe', 48.1372, 11.5755, 'Teststrasse 1, Testtown']);
});

test('CSV latitude,longitude,label: the header row is no place; the label is the name', () => {
  const e = readGoogleCsv('latitude,longitude,label\n48.1372,11.5755,Synthetic Spot\n47.1,11.2,Second Spot\n');
  assert.deepEqual(spots(e), [['Synthetic Spot', 48.1372, 11.5755], ['Second Spot', 47.1, 11.2]]);
});

test('German Excel file: semicolons and decimal commas (Name;Breite;Länge)', async () => {
  const text = 'Name;Breite;Länge;Notiz\r\nCafé Süd;48,1372;11,5755;"schön; ruhig"\r\n"Bar ""Eck""";47,9;12,1;\r\n';
  const read = await readFile(file('Orte.csv', text));
  assert.deepEqual(spots(read.entries), [['Café Süd', 48.1372, 11.5755], ['Bar "Eck"', 47.9, 12.1]]);
  assert.equal(read.entries[0].note, 'schön; ruhig');
});

test('German Excel\'s plain "CSV" is Windows-1252, not UTF-8: "Länge" and "Café" survive', async () => {
  const text = 'Name;Breite;Länge\r\nCafé Süd;48,1372;11,5755\r\n';
  const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0)); // every character here is ≤ U+00FF: its Windows-1252 byte
  const cp1252 = { name: 'Orte.csv', text: async () => new TextDecoder().decode(bytes), arrayBuffer: async () => bytes.buffer };
  const read = await readFile(cp1252);
  assert.deepEqual(spots(read.entries), [['Café Süd', 48.1372, 11.5755]]);
  const utf8 = await readFile(file('Orte.csv', `﻿${text}`));
  assert.deepEqual(spots(utf8.entries), [['Café Süd', 48.1372, 11.5755]], 'Excel\'s "CSV UTF-8" (with a byte order mark)');
});

test('a table with an address column but no coordinates: split, searched by name and address, map-file pins', async () => {
  const read = await readFile(file('Adressen.csv', 'Name;Adresse\nSynthetic Cafe;Teststrasse 1, Testtown\n'));
  assert.deepEqual(read.entries.map((e) => [e.name, e.address, e.lat, e.source, e.warning]),
    [['Synthetic Cafe', 'Teststrasse 1, Testtown', null, 'csv', 'No coordinates in this row; it will be searched by name.']]);
});

test('a .tsv Google list (Title⇥Note⇥URL) is split on tabs and read like the CSV', async () => {
  const text = 'Title\tNote\tURL\n' +
    'Bar Luce\tschön, klein\thttps://www.google.com/maps/place/Bar+Luce/@45.4,9.2,17z/data=!3d45.4719!4d9.1721\n' +
    'Irgendwo\t\thttps://maps.app.goo.gl/xyz\n';
  const read = await readFile(file('Mailand.tsv', text));
  assert.deepEqual(spots(read.entries), [['Bar Luce', 45.4719, 9.1721], ['Irgendwo', null, null]]);
  assert.equal(read.entries[0].note, 'schön, klein');
  assert.equal(read.entries[0].source, 'google-csv');
  assert.equal(read.entries[0].tagSuggestion, 'mailand');
  assert.match(read.entries[1].warning, /short link/i);
});

test('a .tsv with coordinate columns', async () => {
  const read = await readFile(file('places.tsv', 'Name\tLat\tLon\tAddress\nSynthetic Cafe\t48.1372\t11.5755\tTeststrasse 1, Testtown\n'));
  assert.deepEqual(spots(read.entries), [['Synthetic Cafe', 48.1372, 11.5755]]);
  assert.equal(read.entries[0].address, 'Teststrasse 1, Testtown');
});

test('one-column coordinates: "lat, lon" in a coordinates or location column, also with decimal commas', () => {
  const e = readGoogleCsv('Name,Coordinates\nSynthetic Cafe,"48.1372, 11.5755"\nSecond,"(47.1,11.2)"\nThird,47.5 11.5\n');
  assert.deepEqual(spots(e), [['Synthetic Cafe', 48.1372, 11.5755], ['Second', 47.1, 11.2], ['Third', 47.5, 11.5]]);
  const g = readGoogleCsv('Name;Location\nSynthetic Cafe;48,1372 11,5755\nSecond;"47,1; 11,2"\n');
  assert.deepEqual(spots(g), [['Synthetic Cafe', 48.1372, 11.5755], ['Second', 47.1, 11.2]]);
});

test('a location column that holds an address is the address to search with', () => {
  const [e] = readGoogleCsv('Name,Location\nSynthetic Cafe,"Teststrasse 1, Testtown"\n');
  assert.deepEqual([e.name, e.lat, e.address], ['Synthetic Cafe', null, 'Teststrasse 1, Testtown']);
  assert.match(e.warning, /searched by name/);
});

test('Google My Maps CSV export: WKT POINT (lon lat), a line\'s start, a polygon\'s centre', () => {
  const e = readGoogleCsv('WKT,name,description\n' +
    'POINT (11.5755 48.1372),Synthetic Spot,a note\n' +
    '"LINESTRING (11.1 47.1, 11.2 47.2)",Synthetic Walk,\n' +
    '"POLYGON ((11 47, 12 47, 12 48, 11 48))",Synthetic Park,\n' +
    'POINT Z (12.1 47.9 500),Synthetic Peak,\n');
  assert.deepEqual(spots(e), [
    ['Synthetic Spot', 48.1372, 11.5755], ['Synthetic Walk', 47.1, 11.1], ['Synthetic Park', 47.5, 11.5], ['Synthetic Peak', 47.9, 12.1],
  ]);
  assert.equal(e[0].note, 'a note');
});

test('rows without usable coordinates fall back to the search by name (and address); 0,0 is no coordinate', () => {
  const e = readGoogleCsv('Name,Lat,Lon,Address\n' +
    'Synthetic Cafe,48.1372,11.5755,\n' +
    'Synthetic Bar,,,"Teststrasse 2, Testtown"\n' +
    'Synthetic Pub,0,0,\n' +
    'Synthetic Inn,123.4,567.8,\n' +
    ',,,"Probeweg 7, Testtown"\n');
  assert.deepEqual(spots(e), [
    ['Synthetic Cafe', 48.1372, 11.5755], ['Synthetic Bar', null, null], ['Synthetic Pub', null, null],
    ['Synthetic Inn', null, null], ['Probeweg 7', null, null],
  ]);
  assert.equal(e[1].address, 'Teststrasse 2, Testtown');
  for (const row of e.slice(1)) assert.equal(row.warning, 'No coordinates in this row; it will be searched by name.', row.name);
});

test('rows with neither usable coordinates nor a name are skipped and counted', async () => {
  const read = await readFile(file('points.csv', 'name,lat,lon\nSynthetic Cafe,48.1372,11.5755\n,0,0\n,999,999\n'));
  assert.deepEqual(spots(read.entries), [['Synthetic Cafe', 48.1372, 11.5755]]);
  assert.equal(read.skipped, 2);
});

test('a "latitude" column beyond ±90 while the other stays within: the columns are swapped', () => {
  const e = readGoogleCsv('name,lat,lon\nSynthetic Bar,151.2093,-33.8688\nSynthetic Cafe,11.5755,48.1372\n');
  assert.deepEqual(spots(e), [['Synthetic Bar', -33.8688, 151.2093], ['Synthetic Cafe', 48.1372, 11.5755]]);
});

test('a row without coordinates but with a Google Maps link still reads the link', () => {
  const e = readGoogleCsv('Name,Lat,Lon,URL\nSynthetic Bar,,,https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721\n');
  assert.deepEqual(spots(e), [['Synthetic Bar', 45.4719, 9.1721]]);
});

/* ---------- Google list CSVs stay exactly as in 2.1.0 ---------- */

test('Google list CSVs: the same rows as 2.1.0 (golden output)', () => {
  const row = (name, lat, lon, url, note, tagSuggestion, warning) =>
    ({ name, address: '', lat, lon, url, source: 'google-csv', note, tagSuggestion, warning });
  const NO_COORDS = 'No coordinates in the link; it will be searched by name.';
  const SHORT = 'Short link; it will be resolved on import.';
  const bar = 'https://www.google.com/maps/place/Bar+Luce/@45.4,9.2,17z/data=!3d45.4719!4d9.1721';
  const mitte = 'https://www.google.com/maps/place/Mitte/@52.52,13.405,15z';
  assert.deepEqual(readGoogleCsv('Title,Note,URL\n' +
    `Bar Luce,"schön, klein",${bar}\n` +
    'Irgendwo,,https://maps.app.goo.gl/xyz\n' +
    `Mitte,,${mitte}\n` +
    ',nur Notiz,\n' +
    'Ohne Link,,\n', 'Mailand.csv'), [
    row('Bar Luce', 45.4719, 9.1721, bar, 'schön, klein', 'mailand', ''),
    row('Irgendwo', null, null, 'https://maps.app.goo.gl/xyz', '', 'mailand', SHORT),
    row('Mitte', 52.52, 13.405, mitte, '', 'mailand', 'Coordinate comes from the map center and may be slightly off.'),
    row('Ohne Link', null, null, '', '', 'mailand', NO_COORDS),
  ]);
  const unquoted = 'https://www.google.com/maps/place/U/@45.4,9.2,17z/data=!3d45.1!4d9.2';
  assert.deepEqual(readGoogleCsv(`Titel,Notiz,URL\nUnquoted,,${unquoted}\n`, 'Liste.csv'),
    [row('Unquoted', 45.1, 9.2, unquoted, '', 'liste', '')], 'an unquoted link with commas is joined back together');
  assert.deepEqual(readGoogleCsv('Synthetic Spot,a note,https://maps.google.com/?q=47.1,11.2\nSecond,,https://maps.app.goo.gl/abc\n'), [
    row('Synthetic Spot', null, null, 'https://maps.google.com/?q=47.1', 'a note', '', NO_COORDS),
    row('Second', null, null, 'https://maps.app.goo.gl/abc', '', '', SHORT),
  ], 'no header: Title, Note, URL by position');
  const newer = 'https://www.google.com/maps/place/Synthetic+Bar/data=!4m2!3m1!1s0x0:0x1';
  assert.deepEqual(readGoogleCsv(`Title,Note,URL,Tags,Comment\n,,,,\nSynthetic Bar,,${newer},,\n`, 'Want to go.csv'),
    [row('Synthetic Bar', null, null, newer, '', 'want to go', NO_COORDS)]);
});

test('a Google list CSV row without a name or link is still dropped silently (no count)', async () => {
  const read = await readFile(file('List.csv', 'Title,Note,URL\n,only a note,\nSynthetic Bar,,https://maps.app.goo.gl/xyz\n'));
  assert.equal(read.entries.length, 1);
  assert.equal(read.skipped, 0);
});

/* ---------- The newer Google Takeout "Saved Places" format ---------- */

const NEW_TAKEOUT = readFileSync(new URL('./fixtures/takeout-saved-places-2025.json', import.meta.url), 'utf8');

test('newer Takeout Saved Places: names, addresses and links from properties.location and google_maps_url', async () => {
  const read = await readFile(file('Saved Places.json', NEW_TAKEOUT));
  assert.deepEqual(read.entries.map((e) => [e.name, e.address, e.lat, e.lon, e.url]), [
    ['Synthetic Cafe', 'Teststrasse 1, 80000 Testtown, Germany', 48.1372, 11.5755, 'http://maps.google.com/?cid=1000000000000000001'],
    ['Synthetic Museum', 'Probeweg 7, 80001 Testtown, Germany', null, null, 'http://maps.google.com/?cid=1000000000000000002'],
    ['Synthetic Bakery, Teststrasse 2', '', null, null, 'http://maps.google.com/?q=Synthetic+Bakery,+Teststrasse+2&ftid=0x0:0x3'],
    ['Feldweg 3', 'Feldweg 3, 83000 Testdorf, Germany', 47.9, 12.1, 'http://maps.google.com/?q=47.9,12.1'],
  ]);
  assert.ok(read.entries.every((e) => e.source === 'google-takeout'));
  assert.ok(!read.entries.some((e) => e.name === 'Untitled'), 'no "Untitled" rows');
  assert.ok(!read.entries.some((e) => e.lat === 0 && e.lon === 0), 'no pin at 0,0');
  assert.equal(read.skipped, 1, 'the point with neither coordinates nor a name');
  assert.equal(read.entries[0].warning, '');
  assert.match(read.entries[1].warning, /coordinates/i);
});

test('newer Takeout: an unknown point (0,0) whose link holds coordinates takes them from the link', () => {
  const e = readTakeoutGeoJSON({ type: 'FeatureCollection', features: [{
    type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { google_maps_url: 'https://www.google.com/maps/search/?api=1&query=47.1,11.2', location: { name: 'Synthetic Spot' } },
  }] });
  assert.deepEqual(spots(e), [['Synthetic Spot', 47.1, 11.2]]);
});

test('newer Takeout is recognized when its first point is an unknown one without location', async () => {
  const text = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { google_maps_url: 'http://maps.google.com/?cid=1' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.5, 48.1] }, properties: { google_maps_url: 'http://maps.google.com/?cid=2', location: { name: 'Synthetic Cafe' } } },
  ] });
  const read = await readFile(file('Gespeicherte Orte.json', text));
  assert.deepEqual(spots(read.entries), [['Synthetic Cafe', 48.1, 11.5]]);
  assert.equal(read.entries[0].source, 'google-takeout');
  assert.equal(read.skipped, 1);
});

test('older Takeout Saved Places read as in 2.1.0', async () => {
  const text = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-118.2474, 34.0527] },
      properties: { Title: 'Synthetic Park', 'Google Maps URL': 'http://maps.google.com/?cid=1', Comment: 'a note',
        Location: { Address: 'Testcity', 'Business Name': 'Synthetic Park', 'Geo Coordinates': { Latitude: '34.0527', Longitude: '-118.2474' } } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { Title: 'Synthetic Unknown', 'Google Maps URL': 'http://maps.google.com/?cid=2' } },
  ] });
  const read = await readFile(file('Saved Places.json', text));
  assert.deepEqual(read.entries, [
    { name: 'Synthetic Park', address: 'Testcity', lat: 34.0527, lon: -118.2474, url: 'http://maps.google.com/?cid=1', source: 'google-takeout', note: 'a note', warning: '' },
    { name: 'Synthetic Unknown', address: '', lat: null, lon: null, url: 'http://maps.google.com/?cid=2', source: 'google-takeout', note: '', warning: 'No usable coordinates in the file.' },
  ]);
});

/* ---------- Other GeoJSON: 0,0 is unknown, never a pin ---------- */

test('GeoJSON: a named point at 0,0 is searched by name, an unnamed one skipped and counted; real points as before', async () => {
  const text = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [11.5, 48.1] }, properties: { name: 'Synthetic Cafe', address: 'Testtown', url: 'https://example.org/1' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Synthetic Bar' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
  ] });
  const read = await readFile(file('places.geojson', text));
  assert.deepEqual(read.entries, [
    { name: 'Synthetic Cafe', address: 'Testtown', lat: 48.1, lon: 11.5, url: 'https://example.org/1', source: 'geojson', note: '', warning: '' },
    { name: 'Synthetic Bar', address: '', lat: null, lon: null, url: '', source: 'geojson', note: '', warning: 'No coordinates in the file; it will be searched by name.' },
  ]);
  assert.equal(read.skipped, 1);
});

/* ---------- The import notice, the file picker, the pin source ---------- */

test('the skipped count reads as a sentence', () => {
  assert.equal(skippedPlacesNotice(1), 'Skipped 1 place with neither coordinates nor a name.');
  assert.equal(skippedPlacesNotice(3), 'Skipped 3 places with neither coordinates nor a name.');
  assert.equal(skippedPlacesNotice(0), '');
});

test('the skipped count reaches the import dialog\'s notice (and the status when nothing is left)', () => {
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
  assert.match(app, /skipped: dropped = 0 \} = await readFile\(f\)/);
  assert.match(app, /showImport\(all, names\.join\(', '\), env, null, skipped\)/);
  assert.match(app, /'The files contained no places\.' \+ \(skipped \? ` \$\{skippedPlacesNotice\(skipped\)\}` : ''\)/);
  assert.match(ui, /export function showImport\(entries, sourceName, env, guide = null, skipped = 0\)/);
  assert.match(ui, /skippedPlacesNotice\(skipped\)/);
});

test('the file picker offers .tsv files', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const accept = html.match(/id="settings-import-file" accept="([^"]+)"/)[1].split(',');
  for (const ext of ['.csv', '.tsv', '.json', '.geojson', '.kml', '.kmz', '.gpx', '.zip', '.html', '.htm']) assert.ok(accept.includes(ext), ext);
});

test('CSV pins with coordinates are map-file pins: colour and caption of the "files" group', async () => {
  const { sourceColor, pinLook } = await import('../web/js/sources.js');
  assert.equal(sourceColor('csv'), sourceColor('geojson'));
  assert.deepEqual(pinLook('csv'), { logo: '', caption: 'Map file' });
});
