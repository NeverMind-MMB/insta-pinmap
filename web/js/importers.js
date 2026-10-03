/**
 * importers.js — read places from other sources.
 *
 * Everything runs in the browser. Only two things need the server:
 * resolving short links and searching by name when coordinates are missing.
 *
 * Every function returns entries of the form:
 *   { name, address, lat, lon, url, source, note, warning }
 * lat/lon may be null; then they still have to be looked up.
 */

import { unzipSync, strFromU8 } from '../vendor/fflate.js';
import { kml, gpx } from '../vendor/togeojson.js';

/* ================================================================== *
 * Apple Guides:  https://guides.apple.com/?ug=<base64url>
 *
 * The ug parameter is a protobuf. Layout (determined by taking it apart):
 *   f1 = name of the guide
 *   f2 = repeated, one entry per place
 *        f3 = address
 *        f4 = { f1 = latitude (double), f2 = longitude (double) }
 *        f5 = name of the place
 *   Further f2 entries without f3/f4 are internal references and are skipped.
 * ================================================================== */

function base64UrlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  t = t.replace(/\s/g, '');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Minimal protobuf reader: returns a list of fields. */
function protobufFields(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fields = [];
  let i = 0;

  function varint() {
    let result = 0n;
    let shift = 0n;
    for (let n = 0; n < 10; n++) {
      if (i >= bytes.length) throw new Error('truncated');
      const b = bytes[i++];
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7n;
    }
    throw new Error('varint too long');
  }

  while (i < bytes.length) {
    const key = Number(varint());
    const number = key >> 3;
    const type = key & 7;
    if (type === 0) {
      fields.push({ number, type, value: varint() });
    } else if (type === 1) {
      if (i + 8 > bytes.length) break;
      fields.push({ number, type, value: dv.getFloat64(i, true) });
      i += 8;
    } else if (type === 2) {
      const len = Number(varint());
      if (i + len > bytes.length) break;
      fields.push({ number, type, value: bytes.subarray(i, i + len) });
      i += len;
    } else if (type === 5) {
      if (i + 4 > bytes.length) break;
      fields.push({ number, type, value: dv.getFloat32(i, true) });
      i += 4;
    } else {
      break; // groups do not occur here
    }
  }
  return fields;
}

function protobufText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Apple appends a '?' to place names. Remove it. */
function appleName(s) {
  const t = String(s || '').replace(/\?+$/, '').trim();
  return t;
}

/**
 * Reads an Apple Guides link.
 * @returns {{title: string, entries: Array}}
 */
export function readAppleGuide(urlOrUg) {
  let ug = urlOrUg;
  try {
    const u = new URL(urlOrUg);
    ug = u.searchParams.get('ug') || u.searchParams.get('g') || '';
  } catch {
    /* then it is probably the bare parameter already */
  }
  if (!ug) throw new Error('No ug parameter found in the link.');

  const fields = protobufFields(base64UrlToBytes(ug));
  let title = '';
  const entries = [];

  for (const f of fields) {
    if (f.number === 1 && f.type === 2 && !title) {
      title = protobufText(f.value) || '';
      continue;
    }
    if (f.number !== 2 || f.type !== 2) continue;

    const sub = protobufFields(f.value);
    let address = '';
    let name = '';
    let lat = null;
    let lon = null;

    for (const s of sub) {
      if (s.number === 3 && s.type === 2) address = protobufText(s.value) || address;
      else if (s.number === 5 && s.type === 2) name = protobufText(s.value) || name;
      else if (s.number === 4 && s.type === 2) {
        for (const c of protobufFields(s.value)) {
          if (c.type !== 1) continue;
          if (c.number === 1) lat = c.value;
          else if (c.number === 2) lon = c.value;
        }
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;   // reference entry
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    entries.push({
      name: appleName(name) || address.split(',')[0] || 'Untitled',
      address,
      lat, lon,
      url: '',
      source: 'apple-guide',
      note: '',
      warning: '',
    });
  }

  return { title: appleName(title), entries };
}

/* ================================================================== *
 * Single Apple place links
 * ================================================================== */

export function readApplePlace(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (!/(^|\.)(maps\.apple(\.com)?|guides\.apple\.com)$/i.test(u.hostname)) return null;

  const q = u.searchParams;
  let lat = null;
  let lon = null;

  const pair = q.get('coordinate') || q.get('ll') || q.get('sll') || q.get('daddr');
  if (pair) {
    const m = pair.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
    if (m) {
      lat = parseFloat(m[1]);
      lon = parseFloat(m[2]);
    }
  }
  const name = q.get('name') || q.get('q') || '';
  const address = q.get('address') || '';

  if (!Number.isFinite(lat) && !name && !address) return null;
  return {
    name: name || address.split(',')[0] || 'Apple place',
    address,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    url: link,
    source: 'apple-ort',
    note: '',
    warning: Number.isFinite(lat) ? '' : 'No coordinates in the link; it has to be looked up.',
  };
}

/* ================================================================== *
 * Google Maps links
 * ================================================================== */

/**
 * Coordinates from a long Google Maps link.
 * The pattern !3d<lat>!4d<lon> is the place itself; @lat,lng is only the
 * map center at the time of sharing and therefore less precise. So !3d!4d first.
 */
export function googleCoordinates(link) {
  const s = String(link || '');
  const precise = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (precise) return { lat: parseFloat(precise[1]), lon: parseFloat(precise[2]), precise: true };

  try {
    const u = new URL(s);
    const query = u.searchParams.get('query') || u.searchParams.get('q') || u.searchParams.get('center');
    if (query) {
      const m = query.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
      if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), precise: true };
    }
  } catch { /* continue */ }

  const center = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (center) return { lat: parseFloat(center[1]), lon: parseFloat(center[2]), precise: false };

  return null;
}

export function googleName(link) {
  const m = String(link || '').match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
  } catch {
    return m[1].replace(/\+/g, ' ');
  }
}

export function isGoogleShortLink(link) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(String(link || ''));
}

/* ================================================================== *
 * Google Takeout: "Saved Places" as GeoJSON
 * ================================================================== */

export function readTakeoutGeoJSON(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  const feats = j?.features || [];
  const result = [];

  for (const f of feats) {
    const p = f.properties || {};
    const g = f.geometry || {};
    let lat = null;
    let lon = null;

    if (g.type === 'Point' && Array.isArray(g.coordinates)) {
      lon = Number(g.coordinates[0]);
      lat = Number(g.coordinates[1]);
    }
    // Takeout stores the same values again as text; sometimes only
    // this variant is filled in.
    const geo = p.Location?.['Geo Coordinates'] || p.Location || {};
    if (!Number.isFinite(lat) && geo.Latitude != null) lat = parseFloat(geo.Latitude);
    if (!Number.isFinite(lon) && geo.Longitude != null) lon = parseFloat(geo.Longitude);

    // 0,0 is the usual placeholder for "unknown" in Takeout exports.
    const usable =
      Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 1e-7 && Math.abs(lon) < 1e-7);

    const name = p.Title || p.Location?.['Business Name'] || p.Location?.Name || '';
    const address = p.Location?.Address || '';
    const url = p['Google Maps URL'] || p.url || '';

    if (!name && !usable) continue;

    result.push({
      name: name || address.split(',')[0] || 'Untitled',
      address,
      lat: usable ? lat : null,
      lon: usable ? lon : null,
      url,
      source: 'google-takeout',
      note: p.Comment || '',
      warning: usable ? '' : 'No usable coordinates in the file.',
    });
  }
  return result;
}

/* ================================================================== *
 * Google lists as CSV  (Title, Note, URL)
 * ================================================================== */

/** CSV per RFC 4180: quotes, doubled quotes, line breaks inside a field. */
export function csvRows(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuote = false;
  const s = String(text).replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuote = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((z) => z.some((x) => String(x).trim() !== ''));
}

export function readGoogleCsv(text, listName = '') {
  const rows = csvRows(text);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const hasHeader = header.some((h) => ['title', 'name', 'url', 'note', 'comment', 'titel'].includes(h));
  const column = (names) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iTitle = hasHeader ? column(['title', 'titel', 'name']) : 0;
  const iNote = hasHeader ? column(['note', 'comment', 'notiz', 'kommentar']) : 1;
  const iUrl = hasHeader ? column(['url', 'link']) : 2;

  const columnCount = header.length;

  const result = [];
  for (const z of rows.slice(hasHeader ? 1 : 0)) {
    const name = (iTitle >= 0 ? z[iTitle] : '') || '';
    const note = (iNote >= 0 ? z[iNote] : '') || '';

    // Google Maps URLs contain commas (@45.4,9.2,17z). If they are not quoted
    // in the file, the link falls apart into several columns. If the last
    // header column is the URL, join everything from there back together;
    // otherwise exactly the coordinates get lost.
    let url = (iUrl >= 0 ? z[iUrl] : '') || '';
    if (iUrl >= 0 && iUrl === columnCount - 1 && z.length > columnCount) {
      url = z.slice(iUrl).join(',');
    }

    if (!name && !url) continue;

    const coords = url ? googleCoordinates(url) : null;
    let warning = '';
    if (!coords) {
      warning = isGoogleShortLink(url)
        ? 'Short link; it will be resolved on import.'
        : 'No coordinates in the link; it will be searched by name.';
    } else if (!coords.precise) {
      warning = 'Coordinate comes from the map center and may be slightly off.';
    }

    result.push({
      name: name || googleName(url) || 'Untitled',
      address: '',
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      url,
      source: 'google-csv',
      note,
      tagSuggestion: listName ? listName.toLowerCase().replace(/\.csv$/, '') : '',
      warning,
    });
  }
  return result;
}

/* ================================================================== *
 * GeoJSON, KML, KMZ, GPX
 * ================================================================== */

function fromGeoJSON(j, source) {
  const result = [];
  const feats = j?.type === 'FeatureCollection' ? j.features || [] : j?.type === 'Feature' ? [j] : [];

  for (const f of feats) {
    const p = f.properties || {};
    const g = f.geometry;
    if (!g) continue;

    let lat = null;
    let lon = null;
    if (g.type === 'Point') {
      [lon, lat] = g.coordinates || [];
    } else if (g.type === 'LineString' && g.coordinates?.length) {
      [lon, lat] = g.coordinates[0];                 // start point of a track
    } else if (g.type === 'Polygon' && g.coordinates?.[0]?.length) {
      // centroid of the outer ring
      const ring = g.coordinates[0];
      lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    } else continue;

    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    result.push({
      name: p.name || p.Name || p.title || p.Title || 'Untitled',
      address: p.address || p.Address || p.vicinity || '',
      lat, lon,
      url: p.url || p.link || '',
      source,
      note: (p.description || p.Description || p.desc || '')
        .replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500),
      warning: '',
    });
  }
  return result;
}

function xmlDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The file is not valid XML.');
  return doc;
}

export function readKml(text) {
  return fromGeoJSON(kml(xmlDoc(text)), 'kml');
}

export function readGpx(text) {
  return fromGeoJSON(gpx(xmlDoc(text)), 'gpx');
}

export function readKmz(bytes) {
  const files = unzipSync(new Uint8Array(bytes));
  const name =
    Object.keys(files).find((n) => /^doc\.kml$/i.test(n)) ||
    Object.keys(files).find((n) => /\.kml$/i.test(n));
  if (!name) throw new Error('The KMZ file contains no KML file.');
  return readKml(strFromU8(files[name]));
}

/* ================================================================== *
 * Read a file, detect the format automatically
 * ================================================================== */

export async function readFile(file) {
  const name = file.name || '';
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (ext === 'kmz' || ext === 'zip') {
    return { name, entries: readKmz(await file.arrayBuffer()) };
  }

  const text = await file.text();

  if (ext === 'kml') return { name, entries: readKml(text) };
  if (ext === 'gpx') return { name, entries: readGpx(text) };
  if (ext === 'csv' || ext === 'tsv') return { name, entries: readGoogleCsv(text, name) };

  if (ext === 'json' || ext === 'geojson' || !ext) {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error('The file is not readable JSON.');
    }
    // Our own backup
    if (Array.isArray(j?.pins)) return { name, backup: j, entries: [] };
    // Takeout is recognized by its typical properties
    const first = j?.features?.[0]?.properties || {};
    if ('Google Maps URL' in first || 'Location' in first) {
      return { name, entries: readTakeoutGeoJSON(j) };
    }
    return { name, entries: fromGeoJSON(j, 'geojson') };
  }

  // Guess if necessary
  if (/^\s*</.test(text)) {
    return { name, entries: /<gpx/i.test(text) ? readGpx(text) : readKml(text) };
  }
  throw new Error(`I can't do anything with the extension ".${ext}".`);
}

/** Text from the link field in the settings. */
export function readLink(link) {
  const s = String(link || '').trim();
  if (/guides\.apple\.com/i.test(s) || /[?&]ug=/.test(s)) {
    const { title, entries } = readAppleGuide(s);
    return { name: title || 'Apple Guide', entries };
  }
  const apple = readApplePlace(s);
  if (apple) return { name: apple.name, entries: [apple] };

  if (/google\.[a-z.]+\/maps|maps\.google\./i.test(s) || isGoogleShortLink(s)) {
    const k = googleCoordinates(s);
    return {
      name: googleName(s) || 'Google place',
      entries: [{
        name: googleName(s) || 'Google place',
        address: '',
        lat: k?.lat ?? null,
        lon: k?.lon ?? null,
        url: s,
        source: 'google-link',
        note: '',
        warning: k
          ? (k.precise ? '' : 'Coordinate comes from the map center.')
          : (isGoogleShortLink(s) ? 'Short link; it will be resolved on import.' : 'No coordinates in the link.'),
      }],
    };
  }
  throw new Error('I don\'t recognize this link. Expected an Apple Guides, Apple Maps or Google Maps link.');
}
