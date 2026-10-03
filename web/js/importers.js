/**
 * importers.js — read places from other sources.
 *
 * Everything runs in the browser. Only two things need the server:
 * resolving short links and searching by name when coordinates are missing.
 *
 * Every function returns entries of the form:
 *   { name, address, lat, lon, url, quelle, note, warnung }
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

function b64urlZuBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  t = t.replace(/\s/g, '');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Minimal protobuf reader: returns a list of fields. */
function pbFelder(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const felder = [];
  let i = 0;

  function varint() {
    let ergebnis = 0n;
    let schub = 0n;
    for (let n = 0; n < 10; n++) {
      if (i >= bytes.length) throw new Error('truncated');
      const b = bytes[i++];
      ergebnis |= BigInt(b & 0x7f) << schub;
      if (!(b & 0x80)) return ergebnis;
      schub += 7n;
    }
    throw new Error('varint too long');
  }

  while (i < bytes.length) {
    const key = Number(varint());
    const nummer = key >> 3;
    const typ = key & 7;
    if (typ === 0) {
      felder.push({ nummer, typ, wert: varint() });
    } else if (typ === 1) {
      if (i + 8 > bytes.length) break;
      felder.push({ nummer, typ, wert: dv.getFloat64(i, true) });
      i += 8;
    } else if (typ === 2) {
      const len = Number(varint());
      if (i + len > bytes.length) break;
      felder.push({ nummer, typ, wert: bytes.subarray(i, i + len) });
      i += len;
    } else if (typ === 5) {
      if (i + 4 > bytes.length) break;
      felder.push({ nummer, typ, wert: dv.getFloat32(i, true) });
      i += 4;
    } else {
      break; // groups do not occur here
    }
  }
  return felder;
}

function pbText(bytes) {
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
 * @returns {{titel: string, eintraege: Array}}
 */
export function leseAppleGuide(urlOderUg) {
  let ug = urlOderUg;
  try {
    const u = new URL(urlOderUg);
    ug = u.searchParams.get('ug') || u.searchParams.get('g') || '';
  } catch {
    /* then it is probably the bare parameter already */
  }
  if (!ug) throw new Error('No ug parameter found in the link.');

  const felder = pbFelder(b64urlZuBytes(ug));
  let titel = '';
  const eintraege = [];

  for (const f of felder) {
    if (f.nummer === 1 && f.typ === 2 && !titel) {
      titel = pbText(f.wert) || '';
      continue;
    }
    if (f.nummer !== 2 || f.typ !== 2) continue;

    const sub = pbFelder(f.wert);
    let adresse = '';
    let name = '';
    let lat = null;
    let lon = null;

    for (const s of sub) {
      if (s.nummer === 3 && s.typ === 2) adresse = pbText(s.wert) || adresse;
      else if (s.nummer === 5 && s.typ === 2) name = pbText(s.wert) || name;
      else if (s.nummer === 4 && s.typ === 2) {
        for (const c of pbFelder(s.wert)) {
          if (c.typ !== 1) continue;
          if (c.nummer === 1) lat = c.wert;
          else if (c.nummer === 2) lon = c.wert;
        }
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;   // reference entry
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    eintraege.push({
      name: appleName(name) || adresse.split(',')[0] || 'Untitled',
      address: adresse,
      lat, lon,
      url: '',
      quelle: 'apple-guide',
      note: '',
      warnung: '',
    });
  }

  return { titel: appleName(titel), eintraege };
}

/* ================================================================== *
 * Single Apple place links
 * ================================================================== */

export function leseAppleOrt(link) {
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

  const paar = q.get('coordinate') || q.get('ll') || q.get('sll') || q.get('daddr');
  if (paar) {
    const m = paar.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
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
    quelle: 'apple-ort',
    note: '',
    warnung: Number.isFinite(lat) ? '' : 'No coordinates in the link; it has to be looked up.',
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
export function googleKoordinaten(link) {
  const s = String(link || '');
  const genau = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (genau) return { lat: parseFloat(genau[1]), lon: parseFloat(genau[2]), genau: true };

  try {
    const u = new URL(s);
    const query = u.searchParams.get('query') || u.searchParams.get('q') || u.searchParams.get('center');
    if (query) {
      const m = query.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
      if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]), genau: true };
    }
  } catch { /* continue */ }

  const mitte = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/);
  if (mitte) return { lat: parseFloat(mitte[1]), lon: parseFloat(mitte[2]), genau: false };

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

export function istGoogleKurzlink(link) {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(String(link || ''));
}

/* ================================================================== *
 * Google Takeout: "Saved Places" as GeoJSON
 * ================================================================== */

export function leseTakeoutGeoJSON(text) {
  const j = typeof text === 'string' ? JSON.parse(text) : text;
  const feats = j?.features || [];
  const raus = [];

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
    const brauchbar =
      Number.isFinite(lat) && Number.isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
      !(Math.abs(lat) < 1e-7 && Math.abs(lon) < 1e-7);

    const name = p.Title || p.Location?.['Business Name'] || p.Location?.Name || '';
    const address = p.Location?.Address || '';
    const url = p['Google Maps URL'] || p.url || '';

    if (!name && !brauchbar) continue;

    raus.push({
      name: name || address.split(',')[0] || 'Untitled',
      address,
      lat: brauchbar ? lat : null,
      lon: brauchbar ? lon : null,
      url,
      quelle: 'google-takeout',
      note: p.Comment || '',
      warnung: brauchbar ? '' : 'No usable coordinates in the file.',
    });
  }
  return raus;
}

/* ================================================================== *
 * Google lists as CSV  (Title, Note, URL)
 * ================================================================== */

/** CSV per RFC 4180: quotes, doubled quotes, line breaks inside a field. */
export function csvZeilen(text) {
  const zeilen = [];
  let feld = '';
  let zeile = [];
  let inQuote = false;
  const s = String(text).replace(/^﻿/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === '"') {
        if (s[i + 1] === '"') { feld += '"'; i++; }
        else inQuote = false;
      } else feld += c;
      continue;
    }
    if (c === '"') { inQuote = true; continue; }
    if (c === ',') { zeile.push(feld); feld = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ''; continue; }
    feld += c;
  }
  if (feld !== '' || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter((z) => z.some((x) => String(x).trim() !== ''));
}

export function leseGoogleCSV(text, listenName = '') {
  const zeilen = csvZeilen(text);
  if (!zeilen.length) return [];

  const kopf = zeilen[0].map((h) => h.trim().toLowerCase());
  const hatKopf = kopf.some((h) => ['title', 'name', 'url', 'note', 'comment', 'titel'].includes(h));
  const spalte = (namen) => {
    for (const n of namen) {
      const i = kopf.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iTitel = hatKopf ? spalte(['title', 'titel', 'name']) : 0;
  const iNotiz = hatKopf ? spalte(['note', 'comment', 'notiz', 'kommentar']) : 1;
  const iUrl = hatKopf ? spalte(['url', 'link']) : 2;

  const spaltenZahl = kopf.length;

  const raus = [];
  for (const z of zeilen.slice(hatKopf ? 1 : 0)) {
    const name = (iTitel >= 0 ? z[iTitel] : '') || '';
    const note = (iNotiz >= 0 ? z[iNotiz] : '') || '';

    // Google Maps URLs contain commas (@45.4,9.2,17z). If they are not quoted
    // in the file, the link falls apart into several columns. If the last
    // header column is the URL, join everything from there back together;
    // otherwise exactly the coordinates get lost.
    let url = (iUrl >= 0 ? z[iUrl] : '') || '';
    if (iUrl >= 0 && iUrl === spaltenZahl - 1 && z.length > spaltenZahl) {
      url = z.slice(iUrl).join(',');
    }

    if (!name && !url) continue;

    const koord = url ? googleKoordinaten(url) : null;
    let warnung = '';
    if (!koord) {
      warnung = istGoogleKurzlink(url)
        ? 'Short link; it will be resolved on import.'
        : 'No coordinates in the link; it will be searched by name.';
    } else if (!koord.genau) {
      warnung = 'Coordinate comes from the map center and may be slightly off.';
    }

    raus.push({
      name: name || googleName(url) || 'Untitled',
      address: '',
      lat: koord?.lat ?? null,
      lon: koord?.lon ?? null,
      url,
      quelle: 'google-csv',
      note,
      tagVorschlag: listenName ? listenName.toLowerCase().replace(/\.csv$/, '') : '',
      warnung,
    });
  }
  return raus;
}

/* ================================================================== *
 * GeoJSON, KML, KMZ, GPX
 * ================================================================== */

function ausGeoJSON(j, quelle) {
  const raus = [];
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

    raus.push({
      name: p.name || p.Name || p.title || p.Title || 'Untitled',
      address: p.address || p.Address || p.vicinity || '',
      lat, lon,
      url: p.url || p.link || '',
      quelle,
      note: (p.description || p.Description || p.desc || '')
        .replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500),
      warnung: '',
    });
  }
  return raus;
}

function xmlDoc(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The file is not valid XML.');
  return doc;
}

export function leseKML(text) {
  return ausGeoJSON(kml(xmlDoc(text)), 'kml');
}

export function leseGPX(text) {
  return ausGeoJSON(gpx(xmlDoc(text)), 'gpx');
}

export function leseKMZ(bytes) {
  const dateien = unzipSync(new Uint8Array(bytes));
  const name =
    Object.keys(dateien).find((n) => /^doc\.kml$/i.test(n)) ||
    Object.keys(dateien).find((n) => /\.kml$/i.test(n));
  if (!name) throw new Error('The KMZ file contains no KML file.');
  return leseKML(strFromU8(dateien[name]));
}

/* ================================================================== *
 * Read a file, detect the format automatically
 * ================================================================== */

export async function leseDatei(file) {
  const name = file.name || '';
  const endung = (name.split('.').pop() || '').toLowerCase();

  if (endung === 'kmz' || endung === 'zip') {
    return { name, eintraege: leseKMZ(await file.arrayBuffer()) };
  }

  const text = await file.text();

  if (endung === 'kml') return { name, eintraege: leseKML(text) };
  if (endung === 'gpx') return { name, eintraege: leseGPX(text) };
  if (endung === 'csv' || endung === 'tsv') return { name, eintraege: leseGoogleCSV(text, name) };

  if (endung === 'json' || endung === 'geojson' || !endung) {
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error('The file is not readable JSON.');
    }
    // Our own backup
    if (Array.isArray(j?.pins)) return { name, sicherung: j, eintraege: [] };
    // Takeout is recognized by its typical properties
    const erstes = j?.features?.[0]?.properties || {};
    if ('Google Maps URL' in erstes || 'Location' in erstes) {
      return { name, eintraege: leseTakeoutGeoJSON(j) };
    }
    return { name, eintraege: ausGeoJSON(j, 'geojson') };
  }

  // Guess if necessary
  if (/^\s*</.test(text)) {
    return { name, eintraege: /<gpx/i.test(text) ? leseGPX(text) : leseKML(text) };
  }
  throw new Error(`I can't do anything with the extension ".${endung}".`);
}

/** Text from the link field in the settings. */
export function leseLink(link) {
  const s = String(link || '').trim();
  if (/guides\.apple\.com/i.test(s) || /[?&]ug=/.test(s)) {
    const { titel, eintraege } = leseAppleGuide(s);
    return { name: titel || 'Apple Guide', eintraege };
  }
  const apple = leseAppleOrt(s);
  if (apple) return { name: apple.name, eintraege: [apple] };

  if (/google\.[a-z.]+\/maps|maps\.google\./i.test(s) || istGoogleKurzlink(s)) {
    const k = googleKoordinaten(s);
    return {
      name: googleName(s) || 'Google place',
      eintraege: [{
        name: googleName(s) || 'Google place',
        address: '',
        lat: k?.lat ?? null,
        lon: k?.lon ?? null,
        url: s,
        quelle: 'google-link',
        note: '',
        warnung: k
          ? (k.genau ? '' : 'Coordinate comes from the map center.')
          : (istGoogleKurzlink(s) ? 'Short link; it will be resolved on import.' : 'No coordinates in the link.'),
      }],
    };
  }
  throw new Error('I don\'t recognize this link. Expected an Apple Guides, Apple Maps or Google Maps link.');
}
