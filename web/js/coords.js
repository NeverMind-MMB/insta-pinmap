/**
 * coords.js — an exact point typed or pasted into the input bar instead of a link:
 *   - coordinates, latitude first: decimal ("48.1372, 11.5755", "48.1372N 11.5755E") and
 *     degrees-minutes-seconds ("48°08'14"N 11°34'32"E", "N 48° 08.227 E 011° 34.524");
 *   - geo: URIs ("geo:48.1,11.5", "geo:0,0?q=48.1,11.5(Label)", "geo:0,0?q=Name");
 *   - Plus Codes (Open Location Code, an open standard): full ones ("8FWH4HPM+QR") decode
 *     here, short ones with a town ("4HX8+QH Munich") are recovered near that town, which the
 *     place search finds.
 * Text inside http(s) links is left alone: what a link holds is its source's business (sources.js).
 */

import { searchPlaces } from './geocode.js';

/* ================================================================== *
 * Plus Codes
 * ================================================================== */

/** The 20 Plus Code digits; a digit's value is its position. */
const OLC = '23456789CFGHJMPQRVWX';
const DIGIT = '[23456789CFGHJMPQRVWX]';
/**
 * A full code: 8 digits (the first two within 180° and 360°), "+", then none or 2 and more
 * (only 15 digits count).
 */
const FULL = `[2-9C][2-9CFGHJMPQRV]${DIGIT}{6}\\+(?:${DIGIT}{2,})?`;
const FULL_CODE = new RegExp(`^${FULL}$`, 'i');
/** A short code: a full one without its first 2, 4, 6 or 8 digits. */
const SHORT_CODE = new RegExp(`^(?!\\+$)(?:${DIGIT}{2}){0,3}\\+(?:${DIGIT}{2,})?$`, 'i');
/**
 * Codes inside text; short ones only without 2 or 4 digits ("4HX8+QH"), the forms people share.
 * No lookbehind in this file (Safari before 16.4 can't parse it): "(?:^|[^…])" takes the
 * character before instead, which is never part of what is read.
 */
const FULL_IN_TEXT = new RegExp(`(?:^|[^0-9A-Z+])(${FULL})(?![0-9A-Z+])`, 'i');
const SHORT_IN_TEXT = new RegExp(`(?:^|[^0-9A-Z+])((?:${DIGIT}{2}){2,3}\\+${DIGIT}{2,7})(?![0-9A-Z+])`, 'i');
/** Digits that count; the standard ignores any after these. */
const MAX_DIGITS = 15;

/**
 * Whole numbers keep the arithmetic exact: latitude counts in 1/25,000,000°, longitude in
 * 1/8,192,000° (the size of the smallest cell, 15 digits). The five digit pairs step by 20°,
 * 1°, 1/20°, 1/400° and 1/8000°; each digit after the tenth splits the cell into 5 rows of
 * latitude by 4 columns of longitude.
 */
const LAT_UNITS = 25000000;
const LON_UNITS = 8192000;
const PAIR_LAT = [500000000, 25000000, 1250000, 62500, 3125];
const PAIR_LON = [163840000, 8192000, 409600, 20480, 1024];

/** Longitude folded into −180 … 180. */
function normLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** The centre of a full Plus Code's cell, {lat, lon}; null for anything else. */
export function decodePlusCode(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!FULL_CODE.test(c)) return null;
  let lat = 0;
  let lon = 0;
  let latStep = 0;
  let lonStep = 0;
  [...c.replace('+', '')].slice(0, MAX_DIGITS).forEach((ch, i) => {
    const v = OLC.indexOf(ch);
    if (i < 10) {
      if (i % 2 === 0) lat += v * (latStep = PAIR_LAT[i / 2]);
      else lon += v * (lonStep = PAIR_LON[(i - 1) / 2]);
    } else {
      lat += Math.floor(v / 4) * (latStep /= 5);
      lon += (v % 4) * (lonStep /= 4);
    }
  });
  return { lat: (lat + latStep / 2) / LAT_UNITS - 90, lon: (lon + lonStep / 2) / LON_UNITS - 180 };
}

/** The first `n` digits (n even, at most 10) of the full code of a point. */
function codeDigits(lat, lon, n) {
  const latU = Math.min(Math.floor((Math.min(Math.max(lat, -90), 90) + 90) * LAT_UNITS), 180 * LAT_UNITS - 1);
  const lonU = Math.floor((normLon(lon) + 180) * LON_UNITS);
  let out = '';
  for (let i = 0; i < n / 2; i++) {
    out += OLC[Math.floor(latU / PAIR_LAT[i]) % 20] + OLC[Math.floor(lonU / PAIR_LON[i]) % 20];
  }
  return out;
}

/**
 * The full code a short one stands for: the one whose cell lies nearest to the reference
 * point (the standard's "recover nearest"). A full code comes back as it is; null for
 * anything else.
 */
export function recoverNearest(shortCode, refLat, refLon) {
  const code = String(shortCode ?? '').trim().toUpperCase();
  if (FULL_CODE.test(code)) return code;
  if (!SHORT_CODE.test(code)) return null;
  const missing = 8 - code.indexOf('+');
  const size = 20 ** (2 - missing / 2);   // of the area the missing digits stand for
  const refLatC = Math.min(Math.max(refLat, -90), 90);
  const refLonN = normLon(refLon);
  let { lat, lon } = decodePlusCode(codeDigits(refLatC, refLonN, missing) + code);
  // The reference's own area, or the neighbour on the side the code lies nearer to.
  if (refLatC + size / 2 < lat && lat - size >= -90) lat -= size;
  else if (refLatC - size / 2 > lat && lat + size <= 90) lat += size;
  if (refLonN + size / 2 < lon) lon -= size;
  else if (refLonN - size / 2 > lon) lon += size;
  return codeDigits(lat, lon, missing) + code;
}

/**
 * A short Plus Code with its town (readCoords' {kind: 'short'}): the town from the place
 * search, the full code recovered near it.
 * @returns {Promise<{ok: true, lat, lon, code, name, status} | {ok: false, message: string}>}
 */
export async function placeShortCode({ code, place }, search = searchPlaces) {
  if (!place) {
    return { ok: false, message: `A short Plus Code needs its town: type it after the code (like "${code} Munich"), or paste the full code.` };
  }
  const j = await search(place, { limit: 1 });
  if (!j.ok) return { ok: false, message: j.message || "Place search isn't responding." };
  const town = j.results?.[0];
  if (!town) {
    return { ok: false, message: `Couldn't find "${place}" for the Plus Code ${code}. Try a bigger town nearby, or the full code.` };
  }
  const full = recoverNearest(code, town.lat, town.lon);
  const { lat, lon } = decodePlusCode(full);
  return {
    ok: true, lat, lon, code: full, name: `${code} ${place}`,
    status: `The Plus Code ${code} near ${town.name || place} is ${full}. Please check the point on the map.`,
  };
}

/* ================================================================== *
 * Reading the input
 * ================================================================== */

const STATUS = {
  pair: 'Read as latitude, longitude (in that order). Please check the point on the map.',
  geo: 'The place came straight from the geo: link. Please give it a quick check anyway.',
  pluscode: 'Decoded from the Plus Code. Please give it a quick check anyway.',
};

/** "48.13720, 11.57550": how a point's coordinates show as a title. */
export function formatCoords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** A point readCoords answers, or null when it is out of range or 0,0. */
function pointAt(lat, lon, { name = '', form, status }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  return { kind: 'point', lat, lon, name: name || formatCoords(lat, lon), form, status };
}

/**
 * What the input bar's text holds, if it is no place name:
 *   {kind: 'point', lat, lon, name, form, status}: coordinates, a geo: point or a full Plus Code
 *     (name: the title suggestion; form: 'decimal', 'dms', 'geo' or 'pluscode');
 *   {kind: 'short', code, place}: a short Plus Code and the words around it (its town; '' for none);
 *   {kind: 'search', query}: a geo: link that names its place only (geo:0,0?q=Name);
 *   {kind: 'error', message}: a geo: link without a usable place;
 *   null: none of these (a number pair out of range is none of these either).
 * A geo: link wins, then a full Plus Code, then coordinates, then a short Plus Code.
 */
export function readCoords(input) {
  const text = String(input ?? '').replace(/https?:\/\/\S+/gi, '\n');
  if (!text.trim()) return null;
  return readGeo(text) || readFullCode(text) || readPair(text) || readShortCode(text);
}

/** One query parameter of a geo: URI, decoded ("+" is a space); '' when it is missing. */
function queryParam(query, name) {
  for (const part of query.split('&')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).toLowerCase() !== name) continue;
    const value = part.slice(at + 1).replace(/\+/g, ' ');
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

/**
 * geo:lat,lon[,alt][;params][?query] (RFC 5870, and Android's q=). q=lat,lon(Label) is the
 * marker; otherwise the path is the point and any other q its name, but at 0,0 the q text is a
 * place search.
 */
function readGeo(text) {
  // "Geo: 48.1372, 11.5755" is a word and plain coordinates, not a geo: link.
  const at = text.search(/\bgeo:(?!\s)/i);
  if (at === -1) return null;
  const none = { kind: 'error', message: 'This geo: link has no place in it.' };
  const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,-?\d+(?:\.\d+)?)?(?:;[^\s?]*)?(?:\?((?:[^\s(]|\([^)]*\))*))?/i
    .exec(text.slice(at));
  if (!m) return none;
  const q = queryParam(m[3] || '', 'q').trim();
  const marker = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:\(([^)]*)\))?$/.exec(q);
  if (marker) return pointAt(Number(marker[1]), Number(marker[2]), { name: (marker[3] || '').trim(), form: 'geo', status: STATUS.geo }) || none;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat === 0 && lon === 0) return q ? { kind: 'search', query: q } : none;
  return pointAt(lat, lon, { name: q, form: 'geo', status: STATUS.geo }) || none;
}

function readFullCode(text) {
  const m = FULL_IN_TEXT.exec(text);
  if (!m) return null;
  const code = m[1].toUpperCase();
  const { lat, lon } = decodePlusCode(code);
  return pointAt(lat, lon, { name: code, form: 'pluscode', status: STATUS.pluscode });
}

function readShortCode(text) {
  const m = SHORT_IN_TEXT.exec(text);
  if (!m) return null;
  const place = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`
    .replace(/\s+/g, ' ').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '');
  return { kind: 'short', code: m[1].toUpperCase(), place };
}

/* ---------------- Coordinate pairs ---------------- */

/** An angle: degrees, then (only after a degree sign) minutes, then (only after a minute sign) seconds. */
const DEG = String.raw`(\d{1,3}(?:[.,]\d+)?)`;
const MS = String.raw`(\d{1,2}(?:[.,]\d+)?)`;
const AFTER_DEG = String.raw`(?:${MS}\s*(?:'\s*(?:${MS}\s*")?)?)?`;
const ANGLE = String.raw`${DEG}\s*(?:(°)\s*${AFTER_DEG})?`;
const ANGLE_DEG = String.raw`${DEG}\s*(°)\s*${AFTER_DEG}`;
const SEP = String.raw`\s*[,;/]?\s*`;
const HEMI = '([NSEWO])';   // O: "Ost", east in German

/**
 * The pair forms, tried in this order. Each angle has four groups (degrees, °, minutes,
 * seconds); `hemi` forms put a hemisphere letter before or after each angle, `signed` ones a
 * minus sign; `decimal` ones are two bare numbers, latitude first.
 */
const PAIRS = [
  { kind: 'hemi', letters: 'before', re: new RegExp(String.raw`(?:^|[^A-Za-z])${HEMI}\s*${ANGLE}${SEP}${HEMI}\s*${ANGLE}(?![\d.])`, 'g') },
  { kind: 'hemi', letters: 'after', re: new RegExp(String.raw`(?:^|[^\d.,])${ANGLE}\s*${HEMI}(?![A-Za-z])${SEP}${ANGLE}\s*${HEMI}(?![A-Za-z])`, 'g') },
  { kind: 'signed', re: new RegExp(String.raw`(?:^|[^\d.,-])(-?)${ANGLE_DEG}${SEP}(-?)${ANGLE_DEG}(?![\d.])`, 'g') },
  // Decimal commas only with a space or semicolon between the numbers.
  { kind: 'decimal', re: /(?:^|[^\d.,-])(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)(?![\d.°])/g },
  { kind: 'decimal', re: /(?:^|[^\d.,-])(-?\d{1,2},\d+)\s*[;\s]\s*(-?\d{1,3},\d+)(?![\d,°])/g },
];

const num = (s) => Number(String(s).replace(',', '.'));

/**
 * An angle's degrees from its groups; NaN for impossible ones (60 minutes or seconds, minutes
 * after fractional degrees) and, with `marked`, for bare integers (a letter next to a plain
 * number is no coordinate).
 */
function degrees([deg, sign, min, sec], marked = false) {
  if (marked && !sign && !/[.,]/.test(deg)) return NaN;
  let value = num(deg);
  if (min !== undefined) {
    if (/[.,]/.test(deg) || num(min) >= 60) return NaN;
    value += num(min) / 60;
  }
  if (sec !== undefined) {
    if (num(sec) >= 60) return NaN;
    value += num(sec) / 3600;
  }
  return value;
}

const decimals = (s) => (String(s).split(/[.,]/)[1] || '').length;

/** The title suggestion from the words around the coordinates: their first line, if short and with a word in it. */
function labelFrom(rest) {
  const line = rest.split('\n').map((l) => l.replace(/\s+/g, ' ').replace(/^[\s,;:.()[\]|/–—-]+|[\s,;:.()[\]|/–—-]+$/g, '')).find(Boolean) || '';
  return line.length <= 60 && /\p{L}{2}/u.test(line) ? line : '';
}

/** {lat, lon, form} from one match of a pair form; null when it is no valid pair. */
function pairOf(form, m) {
  if (form.kind === 'decimal') return { lat: num(m[1]), lon: num(m[2]), form: 'decimal' };
  // The sign or letter is group 1 and 6 when it comes before each angle, 5 and 10 when after.
  const before = form.kind === 'signed' || form.letters === 'before';
  const [x1, a1, x2, a2] = before ? [m[1], m.slice(2, 6), m[6], m.slice(7, 11)] : [m[5], m.slice(1, 5), m[10], m.slice(6, 10)];
  const shape = a1[2] !== undefined || a2[2] !== undefined ? 'dms' : 'decimal';
  if (form.kind === 'signed') return { lat: degrees(a1) * (x1 ? -1 : 1), lon: degrees(a2) * (x2 ? -1 : 1), form: shape };
  // Letters say which angle is which, so longitude may come first here.
  const isLat = (h) => h === 'N' || h === 'S';
  if (isLat(x1) === isLat(x2)) return null;
  const [lat, latH, lon, lonH] = isLat(x1)
    ? [degrees(a1, true), x1, degrees(a2, true), x2]
    : [degrees(a2, true), x2, degrees(a1, true), x1];
  return { lat: latH === 'S' ? -lat : lat, lon: lonH === 'W' ? -lon : lon, form: shape };
}

function readPair(input) {
  const text = input
    .replace(/[′’‘´`ʹ]/g, "'").replace(/[″”“ʺ]/g, '"').replace(/''/g, '"')
    .replace(/[º˚]/g, '°').replace(/−/g, '-');
  for (const form of PAIRS) {
    for (const m of text.matchAll(form.re)) {
      const pair = pairOf(form, m);
      if (!pair) continue;
      const rest = `${text.slice(0, m.index)}\n${text.slice(m.index + m[0].length)}`;
      // Bare numbers inside other text need three decimals ("Open 10.30 18.00" is no place).
      const alone = !/[\p{L}\p{N}]/u.test(rest);
      if (form.kind === 'decimal' && !alone && (decimals(m[1]) < 3 || decimals(m[2]) < 3)) continue;
      const point = pointAt(pair.lat, pair.lon, { name: labelFrom(rest), form: pair.form, status: STATUS.pair });
      if (point) return point;
    }
  }
  return null;
}
