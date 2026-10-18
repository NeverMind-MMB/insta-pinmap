/**
 * googlelist.js — the places of a shared Google Maps list, for /api/list.
 *
 * Google Maps' web app loads a list from preview/entitylist/getlist: undocumented,
 * no key, no cookie, no CORS (hence the Worker); JSON after a ")]}'" line. The
 * positions below were read from its answers and match open-source exporters:
 * list L = answer[0]; title L[4], places L[8], total L[12]; per place p: name p[2],
 * note p[3], address p[1][4], latitude/longitude p[1][5][2] / p[1][5][3], feature
 * ID p[1][6] (its second half, unsigned, is the place's CID).
 * The answer also names the list's owner (L[3]), who added each place (p[12]) and
 * who wrote each note (p[15]): none of that is read or passed on.
 */

const GETLIST = 'https://www.google.com/maps/preview/entitylist/getlist';
const MAX_LENGTH = { title: 200, name: 200, address: 300, note: 2000 };

/**
 * getlist's address for a list (the caller checks the ID): up to 1,000 places (a list holds up
 * to 3,000), so the answer stays small enough for the Worker to read and parse; the list's
 * total still comes along, and the app says how many of them Google sent.
 */
export function getlistUrl(listId) {
  return `${GETLIST}?authuser=0&hl=en&gl=us&pb=!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e2!4i1000!16b1`;
}

/** The most of getlist's answer the Worker reads (bytes): 1,000 places with long notes stay below it. */
export const MAX_ANSWER_BYTES = 1_500_000;

/**
 * The answer's text, or null when it is bigger than `max` bytes: then reading stops there
 * and the rest is cancelled, so an oversized (or endless) answer never fills the Worker.
 */
export async function readCapped(res, max = MAX_ANSWER_BYTES) {
  const declared = Number(res.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) {
    res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** getlist's JSON, or undefined when the text is none. */
function readAnswer(text) {
  try {
    return JSON.parse(String(text ?? '').replace(/^\)\]\}'\s*/, ''));
  } catch {
    return undefined;
  }
}

function plainText(value, max, oneLine = false) {
  if (typeof value !== 'string') return '';
  return (oneLine ? value.replace(/\s+/g, ' ') : value).trim().slice(0, max);
}

/** [lat, lon], or [null, null] when they are missing, out of range or 0,0. */
function coordinates(point) {
  const [lat, lon] = Array.isArray(point) ? [point[2], point[3]] : [];
  const ok = typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(Math.abs(lat) < 1e-7 && Math.abs(lon) < 1e-7);
  return ok ? [lat, lon] : [null, null];
}

/** The place's own Google Maps link: by its CID, else a search for its coordinates; '' without either. */
function placeUrl(featureId, lat, lon) {
  const low = Array.isArray(featureId) ? featureId[1] : null;
  if (typeof low === 'string' && /^-?\d{1,20}$/.test(low)) {
    const cid = BigInt.asUintN(64, BigInt(low));
    if (cid) return `https://www.google.com/maps?cid=${cid}`;
  }
  return lat === null ? '' : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
}

/**
 * The list in getlist's answer: {title, total, places: [{name, lat, lon, address, note, url}]};
 * null when the answer holds no list. A place without coordinates keeps lat/lon null;
 * one without name, address and coordinates is left out.
 */
export function parseGoogleList(text) {
  const data = readAnswer(text);
  const L = Array.isArray(data) ? data[0] : null;
  if (!Array.isArray(L)) return null;
  const places = [];
  for (const p of Array.isArray(L[8]) ? L[8] : []) {
    if (!Array.isArray(p)) continue;
    const where = Array.isArray(p[1]) ? p[1] : [];
    const [lat, lon] = coordinates(where[5]);
    const name = plainText(p[2], MAX_LENGTH.name, true);
    const address = plainText(where[4], MAX_LENGTH.address, true);
    if (!name && !address && lat === null) continue;
    places.push({ name, lat, lon, address, note: plainText(p[3], MAX_LENGTH.note), url: placeUrl(where[6], lat, lon) });
  }
  const total = Number.isInteger(L[12]) && L[12] >= 0 ? L[12] : places.length;
  return { title: plainText(L[4], MAX_LENGTH.title, true), total, places };
}

/** True for getlist's answer about a list it doesn't show (private, deleted, made up): [null, null, [4, "<id>"]]. */
export function isMissingList(text) {
  const data = readAnswer(text);
  return Array.isArray(data) && data[0] === null;
}
