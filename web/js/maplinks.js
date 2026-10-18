/**
 * maplinks.js — links from other map apps: OpenStreetMap, Organic Maps / CoMaps,
 * Waze, HERE WeGo, Mapy and Bing Maps (the "maps" group in sources.js).
 *
 * Their links carry the point itself (as coordinates or as a code), and often
 * the name, so they decode on the phone without any request. Two kinds need
 * one: an OpenStreetMap object (node/way/relation) is looked up on Nominatim
 * (CORS open, the place search's 1/s queue), and a Mapy short link is expanded
 * by the app's helper (/api/resolve).
 *
 * Entries have the importers.js form: { name, address, lat, lon, url, source, note, warning }.
 */

import { sourceOf, linkIs, findLinks } from './sources.js';
import { nominatimQueue } from './geocode.js';

/** The app behind each pin source value, for messages and the name of a place a link doesn't name. */
const APPS = {
  'osm-link': 'OpenStreetMap', 'organic-maps-link': 'Organic Maps', 'comaps-link': 'CoMaps',
  'waze-link': 'Waze', 'here-link': 'HERE WeGo', 'mapy-link': 'Mapy', 'bing-link': 'Bing Maps',
};

/** Pin source by host (sources.js has already said the link belongs to the group). */
const HOST_SOURCES = {
  'openstreetmap.org': 'osm-link', 'osm.org': 'osm-link',
  'omaps.app': 'organic-maps-link', 'ge0.me': 'organic-maps-link', 'comaps.at': 'comaps-link',
  'waze.com': 'waze-link', 'ul.waze.com': 'waze-link',
  'share.here.com': 'here-link', 'wego.here.com': 'here-link',
  'mapy.com': 'mapy-link', 'mapy.cz': 'mapy-link', 'en.mapy.cz': 'mapy-link',
  'bing.com': 'bing-link',
};

/** Same wording as for Google's map-center links (importers.js). */
const CENTER = 'Coordinate comes from the map center.';
const LOOKUP = 'Looked up on OpenStreetMap on import.';
const SHORT = 'Short link; it will be resolved on import.';

const standIn = (source) => `${APPS[source]} place`;

/** True for the name a map app's place gets when its link names none ("Waze place"). */
export function isMapAppStandIn(name) {
  return Object.keys(APPS).some((source) => name === standIn(source));
}

/* ---------- Numbers and points ---------- */

function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  return /^[-+]?\d+(?:\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/** {lat, lon} when both are numbers in range and not 0,0 (the usual "unknown"); else null. */
function point(lat, lon) {
  const a = toNumber(lat);
  const b = toNumber(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lon: b };
}

/** "lat,lon" (spaces allowed around the comma) → point; null otherwise. */
function pairOf(text) {
  const parts = String(text ?? '').split(',');
  return parts.length === 2 ? point(parts[0], parts[1]) : null;
}

function decoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/* ---------- Decoders ---------- */

const OSM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~';

/**
 * An OpenStreetMap short-link code (osm.org/go/<code>): a port of OSM's
 * ShortLink.decode (lib/short_link.rb). Each character carries 3 bits of x and
 * 3 of y; trailing "-" lower the zoom. Precise to about a pixel at that zoom.
 * @returns {{lat: number, lon: number, zoom: number} | null}
 */
export function decodeOsmShortCode(code) {
  let x = 0;
  let y = 0;
  let z = 0;
  let zOffset = 0;
  for (const c of String(code ?? '').replace(/@/g, '~')) {
    let t = OSM_CHARS.indexOf(c);
    if (t === -1) {
      zOffset--;
      continue;
    }
    for (let i = 0; i < 3; i++) {
      x = x * 2 + (t & 32 ? 1 : 0);
      t <<= 1;
      y = y * 2 + (t & 32 ? 1 : 0);
      t <<= 1;
    }
    z += 3;
  }
  if (!z || z > 32) return null;
  x *= 2 ** (32 - z);
  y *= 2 ** (32 - z);
  const lon = (x * 360) / 2 ** 32 - 180;
  const lat = (y * 180) / 2 ** 32 - 90;
  return { lat, lon, zoom: z - 8 - (((zOffset % 3) + 3) % 3) };
}

const GE0_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A ge0 code (Organic Maps, CoMaps, MAPS.ME): character 0 is the zoom, each
 * further one carries 3 latitude bits (5, 3, 1) and 3 longitude bits (4, 2, 0),
 * most significant first, of two 30-bit numbers (after mapsme's mwm_api.php).
 * @returns {{lat: number, lon: number, zoom: number} | null}
 */
export function decodeGe0(code) {
  const s = String(code ?? '');
  if (!/^[A-Za-z0-9_-]{2,10}$/.test(s)) return null;
  let lat = 0;
  let lon = 0;
  let shift = 27;
  for (const c of s.slice(1)) {
    const a = GE0_CHARS.indexOf(c);
    lat += ((((a >> 5) & 1) << 2) | (((a >> 3) & 1) << 1) | ((a >> 1) & 1)) * 2 ** shift;
    lon += ((((a >> 4) & 1) << 2) | (((a >> 2) & 1) << 1) | (a & 1)) * 2 ** shift;
    shift -= 3;
  }
  // The middle of the cell the code names.
  const middle = 2 ** (3 * (10 - (s.length - 1)) - 1);
  return {
    lat: ((lat + middle) / (2 ** 30 - 1)) * 180 - 90,
    lon: ((lon + middle) / 2 ** 30) * 360 - 180,
    zoom: GE0_CHARS.indexOf(s[0]) / 4 + 4,
  };
}

const GEOHASH_CHARS = '0123456789bcdefghjkmnpqrstuvwxyz';

/** A standard geohash (what Waze shares after its "h"): the middle of its cell; null for anything else. */
export function decodeGeohash(hash) {
  const s = String(hash ?? '');
  if (!/^[0-9b-hjkmnp-z]{1,12}$/.test(s)) return null;
  const lat = [-90, 90];
  const lon = [-180, 180];
  let even = true;
  for (const c of s) {
    const v = GEOHASH_CHARS.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      const range = even ? lon : lat;
      range[(v >> bit) & 1 ? 0 : 1] = (range[0] + range[1]) / 2;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

/** Text of a base64 (or base64url) string, read as UTF-8; '' when it isn't one. */
function base64Text(s) {
  try {
    let t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

/* ---------- One reader per app; each returns its entry's fields or null ---------- */

/** "N123", "W123", "R123" for an OpenStreetMap object link (also osm.org/go/…?node=123); '' otherwise. */
function osmObject(u) {
  const path = /^\/(node|way|relation)\/(\d{1,15})(?:\/|$)/.exec(u.pathname);
  if (path) return path[1][0].toUpperCase() + path[2];
  if (u.pathname.startsWith('/go/')) {
    for (const type of ['node', 'way', 'relation']) {
      const id = u.searchParams.get(type) || '';
      if (/^\d{1,15}$/.test(id)) return type[0].toUpperCase() + id;
    }
  }
  return '';
}

/** The point an OpenStreetMap link shows besides any object: marker, short-link code, #map=, lat/lon. */
function osmPosition(u) {
  const q = u.searchParams;
  const marker = point(q.get('mlat'), q.get('mlon'));
  if (marker) return { ...marker, warning: '' };
  const go = /^\/go\/([A-Za-z0-9_~@]+-*)$/.exec(u.pathname);
  const code = go && decodeOsmShortCode(go[1]);
  const fromCode = code && point(code.lat, code.lon);
  if (fromCode) return { ...fromCode, warning: q.has('m') ? '' : CENTER };
  const map = /(?:^#|&)map=\d{1,2}(?:\.\d+)?\/(-?[\d.]+)\/(-?[\d.]+)/.exec(u.hash);
  const center = (map && point(map[1], map[2])) || point(q.get('lat'), q.get('lon'));
  return center ? { ...center, warning: CENTER } : null;
}

function readOsm(u) {
  if (osmObject(u)) return { warning: LOOKUP };
  const at = osmPosition(u);
  if (at) return at;
  const query = u.pathname === '/search' ? (u.searchParams.get('query') || '').trim() : '';
  return query ? pairOf(query) || { name: query } : null;
}

/** A name in an Organic Maps path: underscores stand for spaces and spaces for underscores. */
function organicName(segment) {
  return decoded(segment || '').replace(/[_ ]/g, (c) => (c === '_' ? ' ' : '_')).trim();
}

function readOrganic(u) {
  const q = u.searchParams;
  const [first = '', second = ''] = u.pathname.split('/').filter(Boolean);
  if (!first || first === 'map') {
    const ll = pairOf(q.get('ll'));
    if (ll) return { ...ll, name: (q.get('n') || '').trim() };
    const search = (q.get('q') || '').trim();
    return search ? { name: search } : null;
  }
  // The app shares full codes (10 characters); a shorter word is a page of the site, no place.
  const code = /^[A-Za-z0-9_-]{10}$/.test(first) ? decodeGe0(first) : null;
  const at = pairOf(decoded(first)) || (code && point(code.lat, code.lon));
  return at ? { ...at, name: organicName(second) } : null;
}

function readWaze(u) {
  const q = u.searchParams;
  const hash = /^\/ul\/h([0-9a-z]+)\/?$/.exec(u.pathname)?.[1] || q.get('h') || '';
  const fromHash = decodeGeohash(hash);
  if (fromHash) return fromHash;
  const to = /^ll\.(.+)$/.exec(q.get('to') || '')?.[1];
  const at = pairOf(to) || pairOf(q.get('ll')) || pairOf(q.get('latlng'));
  const name = (q.get('q') || '').trim();
  // Venue links (venue_id=, place=, to=place.) carry no coordinates, and their IDs are unstable.
  return at ? { ...at, name } : name ? { name } : null;
}

function readHere(u) {
  const q = u.searchParams;
  const [kind = '', value = ''] = u.pathname.split('/').filter(Boolean);
  if (kind === 'l' && value) {
    const [lat, lon, ...title] = decoded(value).split(',');
    const at = point(lat, lon);
    if (at) return { ...at, name: title.join(',').trim() };
  }
  // The code is base64, so it may hold "/" itself: everything after /p/ belongs to it.
  const code = /^[a-z]-([A-Za-z0-9+/_-]+=*)$/.exec(u.pathname.startsWith('/p/') ? decoded(u.pathname.slice(3)) : '');
  if (code) {
    // s-: "id=…;lat=…;lon=…;n=<name>"; e-: JSON with latitude and longitude.
    const text = base64Text(code[1]);
    const lat = /(?:\blat=|"latitude"\s*:\s*)(-?\d+(?:\.\d+)?)/.exec(text)?.[1];
    const lon = /(?:\blon=|"longitude"\s*:\s*)(-?\d+(?:\.\d+)?)/.exec(text)?.[1];
    const at = point(lat, lon);
    if (at) return { ...at, name: (/(?:^|;)n=([^;]*)/.exec(text)?.[1] || '').trim() };
  }
  const [lat, lon] = (q.get('map') || '').split(',');
  const center = point(lat, lon);
  if (center) return { ...center, warning: CENTER };
  const search = (q.get('q') || '').trim();
  return search ? { name: search } : null;
}

function readMapy(u, link) {
  const q = u.searchParams;
  if (linkIs(link, 'short')) return { warning: SHORT };
  if (q.get('source') === 'coor') {
    const [lon, lat] = (q.get('id') || '').split(',');
    const exact = point(lat, lon);
    if (exact) return exact;
  }
  const at = point(q.get('y'), q.get('x'));
  const search = (q.get('q') || '').trim();
  // With a place open (source + id) the map is centered on it; a search's map center is not the place.
  if (at && q.get('source') && q.get('id')) return { ...at, name: search };
  if (search) return { name: search };
  return at ? { ...at, warning: CENTER } : null;
}

function readBing(u) {
  const q = u.searchParams;
  const [lat, lon, name] = (q.get('ppois') || '').split('~')[0].split('_');
  const poi = point(lat, lon);
  if (poi) return { ...poi, name: (name || '').trim() };
  const sp = /^point\.(-?[\d.]+)_(-?[\d.]+)(?:_([^~]*))?/.exec(q.get('sp') || '');
  const pin = sp && point(sp[1], sp[2]);
  if (pin) return { ...pin, name: (sp[3] || '').split('_')[0].trim() };
  const search = (q.get('where1') || q.get('q') || '').trim();
  const [cLat, cLon] = (q.get('cp') || '').split('~');
  const center = point(cLat, cLon);
  if (center) return { ...center, name: search, warning: CENTER };
  return search ? { name: search } : null;
}

const READERS = {
  'osm-link': readOsm, 'organic-maps-link': readOrganic, 'comaps-link': readOrganic,
  'waze-link': readWaze, 'here-link': readHere, 'mapy-link': readMapy, 'bing-link': readBing,
};

/** URL and pin source of a map app link; null for a link of no map app. */
function mapAppUrl(link) {
  const s = String(link ?? '').trim();
  if (sourceOf(s) !== 'maps') return null;
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const source = HOST_SOURCES[u.hostname.toLowerCase().replace(/^(www|m)\./, '')];
  return source ? { u, source, link: s } : null;
}

/**
 * A map app's link as one import entry: its exact point and the name when the
 * link has one; lat/lon null when the place still has to be looked up (an
 * OpenStreetMap object, a Mapy short link) or the link only has search text.
 * @throws {Error} for a link of no map app, or one that names no place
 */
export function readMapAppLink(link) {
  const found = mapAppUrl(link);
  if (!found) throw new Error('This is not a map app link.');
  const { u, source, link: url } = found;
  const read = READERS[source](u, url);
  if (!read) throw new Error(`This ${APPS[source]} link has no coordinates or place name.`);
  return {
    name: read.name || standIn(source),
    address: '',
    lat: read.lat ?? null,
    lon: read.lon ?? null,
    url,
    source,
    note: '',
    warning: read.warning || '',
  };
}

/* ---------- Share text around the link ---------- */

/**
 * What a map app's share text adds to its link's entry: Waze's "Use Waze to
 * drive to <name>: <link>" names the place, Mapy's "<name> 41.99N, 6.12W <link>"
 * gives the exact point too. A name only replaces a stand-in name; a point only
 * one the link lacks or has from the map center.
 */
export function withShareText(entry, text) {
  if (!entry || sourceOf(entry.url) !== 'maps') return entry;
  // The text without its links; the one-line input bar glues a link to the word before it.
  const words = String(text ?? '').split(/\s+/).map((w) => {
    const at = w.search(/https?:\/\//i);
    return at !== -1 ? w.slice(0, at) : findLinks(w).length ? '' : w;
  }).filter(Boolean).join(' ');
  if (!words) return entry;
  let name = '';
  let at = null;
  if (entry.source === 'waze-link') {
    name = (/\bdrive to (.+?):?$/i.exec(words)?.[1] || '').trim();
  } else if (entry.source === 'mapy-link') {
    const m = /^(.*?)\s*(\d{1,2}(?:\.\d+)?)([NS]),\s*(\d{1,3}(?:\.\d+)?)([EW])\b/.exec(words);
    if (m) {
      name = m[1].trim();
      at = point((m[3] === 'S' ? -1 : 1) * Number(m[2]), (m[5] === 'W' ? -1 : 1) * Number(m[4]));
    }
  }
  const out = { ...entry };
  if (name && isMapAppStandIn(entry.name)) out.name = name;
  if (at && (!Number.isFinite(entry.lat) || entry.warning === CENTER)) Object.assign(out, at, { warning: '' });
  return out;
}

/* ---------- Lookups: OpenStreetMap objects, Mapy short links ---------- */

/** True for a map app entry still without its point that a request can find: an OpenStreetMap object, a Mapy short link. */
export function needsMapAppLookup(entry) {
  const found = entry && !Number.isFinite(entry.lat) ? mapAppUrl(entry.url) : null;
  return Boolean(found && (linkIs(found.link, 'short') || osmObject(found.u)));
}

/** The entry with what a lookup found: its point, and name and address where the entry had none. */
function completed(entry, found) {
  return {
    ...entry,
    lat: found.lat,
    lon: found.lon,
    name: found.name && isMapAppStandIn(entry.name) ? found.name : entry.name,
    address: entry.address || found.address || '',
    warning: found.warning || '',
  };
}

async function fetchJson(url, queue = (fn) => fn()) {
  try {
    const res = await queue(() => fetch(url));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Name, address and point of an OpenStreetMap object ("N123"): Nominatim, for nodes it doesn't know the OSM API. */
async function osmLookup(id, queue) {
  const hits = await fetchJson(`https://nominatim.openstreetmap.org/lookup?osm_ids=${id}&format=jsonv2`, queue);
  const hit = Array.isArray(hits) ? hits[0] : null;
  const at = hit && point(hit.lat, hit.lon);
  if (at) return { ...at, name: hit.name || String(hit.display_name || '').split(',')[0].trim(), address: hit.display_name || '' };
  if (!id.startsWith('N')) return null;
  const node = (await fetchJson(`https://api.openstreetmap.org/api/0.6/node/${id.slice(1)}.json`))?.elements?.[0];
  const nodeAt = node && point(node.lat, node.lon);
  return nodeAt ? { ...nodeAt, name: node.tags?.name || '', address: '' } : null;
}

/**
 * Finds the point of an entry needsMapAppLookup says needs one.
 * @param {{resolve?: (url: string) => Promise<{ok: boolean, url?: string, message?: string}>,
 *   busy?: (text: string) => void, queue?: Function}} options
 *   resolve: the helper's short-link expansion (api.js resolveShortLink); busy: called with
 *   a "please wait" text before the request; queue: the Nominatim queue (tests pass their own)
 * @returns {Promise<{ok: true, entry: object} | {ok: false, message: string}>}
 */
export async function lookUpMapAppEntry(entry, { resolve, busy = () => {}, queue = nominatimQueue } = {}) {
  const found = mapAppUrl(entry?.url);
  if (!found) return { ok: false, message: 'This is not a map app link.' };
  if (linkIs(found.link, 'short')) {
    busy('Resolving the short link …');
    const j = (await resolve?.(found.link).catch(() => null)) || null;
    let read = null;
    if (j?.ok && j.url && !linkIs(j.url, 'short')) {
      try {
        read = readMapAppLink(j.url);
      } catch { /* not a map app link, or no place */ }
    }
    if (!read || !Number.isFinite(read.lat)) return { ok: false, message: (!j?.ok && j?.message) || "Couldn't resolve this short link." };
    return { ok: true, entry: completed(entry, read) };
  }
  const id = osmObject(found.u);
  busy('Looking up the place on OpenStreetMap …');
  const place = id ? await osmLookup(id, queue) : null;
  if (place) return { ok: true, entry: completed(entry, place) };
  // Nominatim knows only named or addressable objects: the map in the link is the next best thing.
  const at = osmPosition(found.u);
  if (at) return { ok: true, entry: completed(entry, { ...at, warning: at.warning || CENTER }) };
  return { ok: false, message: "OpenStreetMap doesn't know a place for this link." };
}
