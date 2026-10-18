/**
 * csvcolumns.js — what a spreadsheet export holds (a CSV, a TSV, a German
 * Excel file with semicolons and decimal commas): its delimiter, and which
 * columns carry coordinates or an address. importers.js reads the rows with
 * it (readGoogleCsv).
 */

/**
 * Header words, compared after headerWord(); in order of preference, so
 * "latitude" wins over "y" when a file has both (projected x/y next to lat/lon).
 */
const LAT_WORDS = ['latitude', 'lat', 'breitengrad', 'breite', 'gps latitude', 'y'];
const LON_WORDS = ['longitude', 'lon', 'lng', 'long', 'längengrad', 'laengengrad', 'länge', 'laenge', 'gps longitude', 'x'];
/** One column with both numbers, "48.1, 11.5". */
const PAIR_WORDS = [
  'coordinates', 'coordinate', 'coords', 'koordinaten', 'location', 'position',
  'lat lon', 'lat lng', 'latlon', 'latlng', 'gps', 'geo coordinates',
];
/** Well-known text, "POINT (11.5 48.1)": Google My Maps' CSV export. */
const WKT_WORDS = ['wkt', 'geometry', 'geom', 'the geom'];
const ADDRESS_WORDS = ['address', 'adresse', 'anschrift', 'addr', 'full address'];

/** A header cell made comparable: lowercase, without "(WGS84)", "_" or "/" ("Lat/Lon" → "lat lon"). */
function headerWord(cell) {
  return String(cell ?? '').replace(/^﻿/, '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[_\-/,.:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** How often `d` occurs in `line` outside double quotes. */
function countOutsideQuotes(line, d) {
  let n = 0;
  let inQuote = false;
  for (const c of line) {
    if (c === '"') inQuote = !inQuote;
    else if (c === d && !inQuote) n++;
  }
  return n;
}

const DELIMITERS = ['\t', ';', ','];

/**
 * The delimiter of a CSV/TSV text, and the text to parse. Excel's "sep=;" first
 * line decides when there is one (and is dropped). Otherwise the first of tab,
 * semicolon and comma that splits the first lines into the same number (> 1)
 * of fields; failing that, the one the header line has most of (tab beats
 * semicolon beats comma on a tie); comma for a single column.
 * @returns {{delimiter: string, text: string}}
 */
export function csvDialect(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  const sep = s.match(/^sep=(.)\r?\n/i);
  if (sep) return { delimiter: sep[1], text: s.slice(sep[0].length) };

  const lines = s.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6);
  if (!lines.length) return { delimiter: ',', text: s };
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (counts[0] > 0 && lines.length > 1 && counts.every((n) => n === counts[0])) return { delimiter: d, text: s };
  }
  let best = ',';
  let most = 0;
  for (const d of DELIMITERS) {
    const n = countOutsideQuotes(lines[0], d);
    if (n > most) { best = d; most = n; }
  }
  return { delimiter: best, text: s };
}

/**
 * Which columns of a header row carry what; -1 for none.
 * lat/lon only as a pair. `coordinates`: the file has a coordinate column of any kind.
 * @returns {{lat: number, lon: number, pair: number, wkt: number, address: number, coordinates: boolean}}
 */
export function csvColumns(header) {
  const words = (header || []).map(headerWord);
  const find = (wanted) => {
    for (const w of wanted) {
      const i = words.indexOf(w);
      if (i !== -1) return i;
    }
    return -1;
  };
  const lat = find(LAT_WORDS);
  const lon = find(LON_WORDS);
  const both = lat !== -1 && lon !== -1;
  const columns = {
    lat: both ? lat : -1,
    lon: both ? lon : -1,
    pair: find(PAIR_WORDS),
    wkt: find(WKT_WORDS),
    address: find(ADDRESS_WORDS),
  };
  columns.coordinates = both || columns.pair !== -1 || columns.wkt !== -1;
  return columns;
}

/** A number from a cell ("48.1372", "+48.1372°", with `decimalComma` also "48,1372"); null for anything else. */
export function csvNumber(cell, decimalComma = false) {
  let s = String(cell ?? '').trim().replace(/°$/, '').replace(/^−/, '-').trim();
  if (decimalComma) s = s.replace(/^([+-]?\d+),(\d+)$/, '$1.$2');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
}

/**
 * Latitude and longitude from one cell: "48.1, 11.5", "48.1 11.5", "(48.1,11.5)",
 * "48.1°, 11.5°"; decimal commas only with a space or semicolon between the
 * numbers ("48,1 11,5", "48,1; 11,5"). Latitude first. null when it isn't a pair.
 * @returns {[number, number] | null}
 */
export function pairCoordinates(cell) {
  const s = String(cell ?? '').replace(/[()[\]°]/g, ' ').trim();
  const dot = s.match(/^([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (dot) return [Number(dot[1]), Number(dot[2])];
  const comma = s.match(/^([+-]?\d+(?:,\d+)?)\s*[;\s]\s*([+-]?\d+(?:,\d+)?)$/);
  if (comma) return [Number(comma[1].replace(',', '.')), Number(comma[2].replace(',', '.'))];
  return null;
}

/**
 * Latitude and longitude from well-known text (x = longitude first): a point
 * itself, a line's first point (like a GPX route's start), a polygon's centre
 * (the mean of its outer ring, as for GeoJSON). null for anything else.
 * @returns {[number, number] | null}
 */
export function wktCoordinates(cell) {
  const m = String(cell ?? '').trim().match(/^(?:MULTI)?(POINT|LINESTRING|POLYGON)\s*(?:ZM|Z|M)?\s*\(+([^()]*)\)/i);
  if (!m) return null;
  const points = m[2].split(',')
    .map((t) => t.trim().split(/\s+/).map(Number))
    .filter((t) => t.length >= 2 && Number.isFinite(t[0]) && Number.isFinite(t[1]));
  if (!points.length) return null;
  if (m[1].toUpperCase() !== 'POLYGON') return [points[0][1], points[0][0]];
  const mean = (k) => points.reduce((sum, t) => sum + t[k], 0) / points.length;
  return [mean(1), mean(0)];
}

/**
 * Latitude and longitude of a row, as written (no range check): from the
 * lat/lon columns, else the one-column pair, else the WKT column. null for none.
 * `decimalComma`: the file isn't comma-separated, so "48,1372" is a number.
 * @returns {[number, number] | null}
 */
export function rowCoordinates(row, columns, decimalComma) {
  if (columns.lat !== -1) {
    const lat = csvNumber(row[columns.lat], decimalComma);
    const lon = csvNumber(row[columns.lon], decimalComma);
    if (lat !== null && lon !== null) return [lat, lon];
  }
  if (columns.pair !== -1) {
    const pair = pairCoordinates(row[columns.pair]);
    if (pair) return pair;
  }
  if (columns.wkt !== -1) return wktCoordinates(row[columns.wkt]);
  return null;
}

/**
 * True when the file's "latitude" values are its longitudes: some go beyond ±90
 * (and stay within ±180) while no "longitude" value does.
 * @param {Array<[number, number] | null>} points  rowCoordinates of each row
 */
export function swappedColumns(points) {
  const given = points.filter(Boolean);
  return given.some(([lat, lon]) => Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lon) <= 90) &&
    !given.some(([, lon]) => Math.abs(lon) > 90);
}
