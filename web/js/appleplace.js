/**
 * appleplace.js — Apple Maps places of Apple Guides, looked up outside the app.
 *
 * Apple Guides name the places Apple Maps knows only by an ID. maps.apple.com
 * refuses Cloudflare's servers, but answers phones and home computers. So the
 * lookup runs either in an iPhone Shortcut (SHORTCUT_NAME) or in the computer
 * script tools/apple-guide.mjs; this module holds what both sides share.
 *
 * Pure and browser-safe: no Node imports, no DOM. Storage is passed in.
 * Depends only on ./dedupe.js (distanceM, for matching guide-page places to rows).
 *
 * The Shortcut fetches the whole guide page once (see parseGuidePage); older
 * Shortcuts fetched one place page per Apple ID.
 *
 * The place page https://maps.apple.com/place?auid=<id> has in its <head>:
 *   <meta property="og:title" content="<name>">
 *   <meta property="place:location:latitude|longitude" content="…">
 *   <title><name> in <city>, <country> - Apple Maps</title>
 */

import { distanceM } from './dedupe.js';

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Content of <meta name="key"> or <meta property="key">, decoded; null when the tag is missing. */
function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const id = tag.match(/\b(?:name|property)\s*=\s*"([^"]*)"/i);
    if (!id || id[1].toLowerCase() !== key) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i);
    return content ? decodeEntities(content[1]) : '';
  }
  return null;
}

const TITLE_SUFFIX = / - Apple Maps\s*$/;

/** "<name> in <rest> - Apple Maps" → "<rest>"; '' when the title has another shape. */
function addressFromTitle(title, name) {
  const t = decodeEntities(title).trim();
  if (!TITLE_SUFFIX.test(t)) return '';
  const core = t.replace(TITLE_SUFFIX, '');
  if (name && core.startsWith(`${name} in `)) return core.slice(name.length + 4).trim();
  const at = core.lastIndexOf(' in ');
  return at === -1 ? '' : core.slice(at + 4).trim();
}

/** "48,8196" or " 48.8196 " → number; NaN for anything else. */
function coordinate(text) {
  const s = String(text ?? '').trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/**
 * Reads an Apple Maps place page. Only its <head> counts.
 * @returns {{name: string, lat: number, lon: number, address: string} | null}
 */
export function parseApplePlaceHtml(html) {
  const s = String(html ?? '');
  const end = s.search(/<\/head\s*>/i);
  const head = end === -1 ? s : s.slice(0, end);
  const name = (metaContent(head, 'og:title') || '').trim();
  const lat = coordinate(metaContent(head, 'place:location:latitude'));
  const lon = coordinate(metaContent(head, 'place:location:longitude'));
  if (!name || !validLatLon(lat, lon)) return null;
  const title = (head.match(/<title[^>]*>([^<]*)<\/title\s*>/i) || [])[1] || '';
  return { name, lat, lon, address: addressFromTitle(title, name) };
}

/* ================================================================== *
 * The iPhone Shortcut
 * ================================================================== */

/** The Shortcut's name in the Shortcuts app; the README tells the user to use exactly this. */
export const SHORTCUT_NAME = 'Fetch Apple Guide';
export const SHORTCUT_RUN_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=clipboard`;

const PLACE_URL_ID = /^https:\/\/maps\.apple\.com\/place\?auid=(\d{1,20})$/;
const BARE_ID = /^\d{1,20}$/;

/** One place address per line, in guide order (what the older per-place Shortcuts took). */
export function shortcutInput(appleIds) {
  return appleIds.map((id) => `https://maps.apple.com/place?auid=${id}`).join('\n');
}

/**
 * The guide link in a form without special characters:
 * https://maps.apple.com/guides?user=<base64url>. iOS can cut a link at a %2F,
 * so the percent-encoded base64 of the original is turned into base64url.
 * A link without a ug/user parameter comes back unchanged.
 */
export function safeGuideLink(link) {
  let param = '';
  try {
    const u = new URL(link);
    param = u.searchParams.get('ug') || u.searchParams.get('user') || '';
  } catch {
    return link;
  }
  const b64u = param.replace(/\s/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return /^[A-Za-z0-9_-]+$/.test(b64u) ? `https://maps.apple.com/guides?user=${b64u}` : link;
}

/**
 * What "Look up with iPhone Shortcut" copies: the guide link in its safe form
 * (the Shortcut fetches the whole guide page once). '' for a guide saved
 * without its link (by 2.0.4): then the user has to paste the guide link again.
 */
export function shortcutClipboard(guide) {
  return guide.link ? safeGuideLink(guide.link) : '';
}

export const SHORTCUT_NEEDS_LINK = 'Paste the guide link again to use the Shortcut.';

/** Apple place ID of an auid place address or a bare ID; '' for anything else. */
export function appleIdOf(text) {
  const s = String(text ?? '').trim();
  if (BARE_ID.test(s)) return s;
  return (s.match(PLACE_URL_ID) || [])[1] || '';
}

/**
 * Reads what the Shortcut copied: one place per line,
 *   <auid or place address>@@<name>@@<lat>@@<lon>@@<address>
 * (tabs instead of "@@" work too). Lines without usable coordinates are skipped.
 * A line with exactly the name and coordinates of an earlier, other ID is
 * skipped too: that is a Shortcut repeating the previous place's values for a
 * place it couldn't read.
 * @returns {Map<string, {name, lat, lon, address}>}
 */
export function parseShortcutResults(text) {
  const found = new Map();
  const firstIdOf = new Map(); // "name|lat|lon" → the ID that brought it first
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const fields = (line.includes('@@') ? line.split('@@') : line.split('\t')).map((f) => f.trim());
    if (fields.length < 4) continue;
    const id = appleIdOf(fields[0]);
    const lat = coordinate(fields[2]);
    const lon = coordinate(fields[3]);
    if (!id || !validLatLon(lat, lon)) continue;
    const name = decodeEntities(fields[1]).trim() || 'Apple Maps place';
    const signature = `${name}|${lat}|${lon}`;
    if ((firstIdOf.get(signature) ?? id) !== id) continue;
    firstIdOf.set(signature, id);
    found.set(id, { name, lat, lon, address: decodeEntities(fields.slice(4).join(' ')).trim() });
  }
  return found;
}

const DOCTYPE_START = /<!doctype html/gi;
const HTML_START = /<html[\s>]/gi;
const PAGE_HEAD_CHARS = 64 * 1024;

/**
 * Pasted text → the raw pages in it; text before the first is dropped.
 * Pages start at `<!DOCTYPE html`; only a paste without any doctype is split at
 * `<html` (a page may contain "<html" inside a script or JSON string).
 */
function splitPages(text) {
  let starts = [...text.matchAll(DOCTYPE_START)].map((m) => m.index);
  if (!starts.length) starts = [...text.matchAll(HTML_START)].map((m) => m.index);
  return starts.map((at, i) => text.slice(at, starts[i + 1] ?? text.length));
}

/** The first of `wanted` that `page` names with `pattern` (document order), or ''. */
function firstNamedId(page, pattern, wanted) {
  for (const m of page.matchAll(pattern)) if (wanted.has(m[1])) return m[1];
  return '';
}

/**
 * Reads what the short Shortcut copied: the raw Apple Maps pages, one after the
 * other. A page belongs to the guide ID it names first as data-ref="<id>"
 * (else claimId=<id>); pages of other places or without usable coordinates are
 * ignored, and an ID already filled keeps its first page.
 * @returns {Map<string, {name, lat, lon, address}>}
 */
export function parseShortcutPages(text, appleIds) {
  const found = new Map();
  const wanted = new Set(appleIds);
  for (const page of splitPages(String(text ?? ''))) {
    const id = firstNamedId(page, /data-ref="(\d{1,20})"/g, wanted) ||
      firstNamedId(page, /claimId=(\d{1,20})/g, wanted);
    if (!id || found.has(id)) continue;
    const place = parseApplePlaceHtml(page.slice(0, PAGE_HEAD_CHARS));
    if (place) found.set(id, place);
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * The whole guide page
 *
 * The guide link (guides.apple.com/?ug=…) redirects to
 * maps.apple.com/guides?user=…, a page that names every place of the guide,
 * custom pins and Apple Maps places alike, in two forms:
 *   1. the list: <a href="…/place?address=…&amp;coordinate=<lat>%2C<lon>&amp;name=…&amp;place-id=…"
 *      data-ref="<Apple ID>"> … <div class="mw-collection-place-name …">name</div>
 *      (custom pins: data-ref="ll.<lat>,<lon>", no place-id)
 *   2. the map's JSON: {"ref":"<Apple ID>","title":"…","center":[<lat>,<lon>], …}
 * ------------------------------------------------------------------ */

const GUIDE_LINK_TAG = /<a\b[^>]*?\shref="([^"]*\/place\?[^"]*)"[^>]*>/gi;
const GUIDE_LINK_COUNT = /href="[^"]*\/place\?[^"]*coordinate=/gi;
const PLACE_NAME_DIV = /\bclass="[^"]*\bmw-collection-place-name\b[^"]*"[^>]*>([^<]*)</i;
const JSON_SCALAR = String.raw`(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|true|false|null)`;
const JSON_SKIP = String.raw`(?:"\w+":${JSON_SCALAR},)*?`;
const JSON_NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;
const ANNOTATION = new RegExp(
  String.raw`\{"ref":"([^"\\]{1,80})",${JSON_SKIP}"title":("(?:[^"\\]|\\.)*"),${JSON_SKIP}` +
  String.raw`"center":\[\s*${JSON_NUMBER}\s*,\s*${JSON_NUMBER}\s*\]`, 'g');
/** How far past a list link its name may be (the closing </a> usually comes first). */
const LINK_BODY_CHARS = 4000;

/** Apple appends "?" to the names of places a guide author added as an address or pin. */
const withoutQuestionMark = (s) => s.replace(/\?+$/, '').trim();
const sameName = (a, b) =>
  withoutQuestionMark(String(a ?? '')).toLowerCase() === withoutQuestionMark(String(b ?? '')).toLowerCase();
const sameSpot = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

function placeOf(id, name, address, lat, lon) {
  const n = id ? name.trim() : withoutQuestionMark(name);
  return { id, name: n || address.split(',')[0].trim() || 'Apple Maps place', address, lat, lon };
}

/** Form 2: the map annotations with an Apple ID (numeric ref) or a custom pin (any other ref). */
function guideAnnotations(s) {
  const out = [];
  for (const m of s.matchAll(ANNOTATION)) {
    let title;
    try { title = String(JSON.parse(m[2])); } catch { continue; }
    const lat = Number(m[3]);
    const lon = Number(m[4]);
    if (!validLatLon(lat, lon)) continue;
    out.push(placeOf(BARE_ID.test(m[1]) ? m[1] : null, title, '', lat, lon));
  }
  return out;
}

/** Form 1: the list links. Without a numeric data-ref, the ID comes from an annotation at the same spot. */
function guideLinks(s, annotations) {
  const out = [];
  for (const m of s.matchAll(GUIDE_LINK_TAG)) {
    let params;
    try {
      params = new URL(decodeEntities(m[1]), 'https://maps.apple.com').searchParams;
    } catch {
      continue;
    }
    const [latText, lonText, ...rest] = (params.get('coordinate') || '').split(',');
    const lat = coordinate(latText);
    const lon = coordinate(lonText);
    if (rest.length || !validLatLon(lat, lon)) continue;
    const ref = (m[0].match(/\bdata-ref="([^"]*)"/i) || [])[1] || '';
    const spot = { lat, lon };
    const id = BARE_ID.test(ref) ? ref
      : (annotations.find((a) => a.id && sameSpot(a, spot)) || {}).id || null;
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + LINK_BODY_CHARS);
    const end = after.search(/<\/a\s*>/i);
    const body = end === -1 ? after : after.slice(0, end);
    const shown = decodeEntities((body.match(PLACE_NAME_DIV) || [])[1] || '');
    out.push(placeOf(id, params.get('name') || shown, (params.get('address') || '').trim(), lat, lon));
  }
  return out;
}

/**
 * True when the paste looks like a guide page rather than place pages or "@@"
 * lines: it has the guide's place list, or it is no place page (those carry
 * place:location meta tags) and names maps.apple.com/guides or ≥ 2 place links.
 */
export function isGuidePage(text) {
  const s = String(text ?? '');
  if (s.includes('mw-collection-place-name')) return true;
  if (s.includes('place:location:latitude')) return false;
  return s.includes('maps.apple.com/guides') || (s.match(GUIDE_LINK_COUNT) || []).length >= 2;
}

/**
 * Reads every place of an Apple Maps guide page: the list links first (page
 * order), then places only the map annotations name. Places without valid
 * coordinates are skipped; a place named twice (same ID, or same name at the
 * same spot) is kept once.
 * @returns {Array<{id: string|null, name: string, address: string, lat: number, lon: number}>}
 */
export function parseGuidePage(html) {
  const s = String(html ?? '');
  const annotations = guideAnnotations(s);
  const places = [];
  const known = (p) => places.some((q) => (p.id && q.id === p.id) || (sameName(q.name, p.name) && sameSpot(q, p)));
  for (const p of [...guideLinks(s, annotations), ...annotations]) {
    if (!known(p)) places.push(p);
  }
  return places;
}

/**
 * What "Paste results" reads, in this order: a guide page, raw place pages
 * (the text contains `<html`), the "@@" / tab lines.
 * @returns {{results: Map<string, {name, lat, lon, address}>, places: Array | null}}
 *   results: the guide's Apple IDs found; places: every place of a guide page, else null
 */
export function readShortcutPaste(text, appleIds) {
  const s = String(text ?? '');
  if (isGuidePage(s)) {
    const places = parseGuidePage(s);
    if (places.length) {
      const wanted = new Set(appleIds);
      const results = new Map();
      for (const { id, name, lat, lon, address } of places) {
        if (id && wanted.has(id) && !results.has(id)) results.set(id, { name, lat, lon, address });
      }
      return { results, places };
    }
  }
  if (/<html/i.test(s)) {
    const pages = parseShortcutPages(s, appleIds);
    if (pages.size) return { results: pages, places: null };
  }
  return { results: parseShortcutResults(s), places: null };
}

/** The guide's Apple IDs found in a paste (see readShortcutPaste). */
export function parseShortcutPaste(text, appleIds) {
  return readShortcutPaste(text, appleIds).results;
}

/** Same place: the same Apple ID, or the same name within this many meters. */
const SAME_PLACE_M = 30;

/**
 * Appends the places of a guide page that the import rows lack (no row with
 * their Apple ID, none with their name within 30 m) as checked rows. A page
 * that has nothing in common with the rows belongs to another guide: then
 * nothing is added.
 * @returns {Array} the added rows
 */
export function appendGuidePlaces(entries, places) {
  const inList = (p) => entries.some((e) =>
    (p.id && appleIdOf(e.url) === p.id) ||
    (Number.isFinite(e.lat) && Number.isFinite(e.lon) && sameName(e.name, p.name) &&
      distanceM(e.lat, e.lon, p.lat, p.lon) <= SAME_PLACE_M));
  const missing = places.filter((p) => !inList(p));
  if (missing.length === places.length) return [];
  const added = missing.map((p) => ({
    name: p.name, address: p.address, lat: p.lat, lon: p.lon,
    url: p.id ? `https://maps.apple.com/place?auid=${p.id}` : '',
    source: 'apple-guide', note: '', warning: '', checked: true,
  }));
  entries.push(...added);
  return added;
}

/**
 * Fills the import rows of Apple Maps places that `results` knows: name,
 * address, coordinates, checked, no warning. Other rows stay as they are.
 * @returns {number} how many Apple rows have coordinates from `results`
 */
export function applyShortcutResults(entries, results) {
  let found = 0;
  for (const e of entries) {
    const id = (String(e.url || '').match(PLACE_URL_ID) || [])[1];
    const p = id && results.get(id);
    if (!p) continue;
    Object.assign(e, { name: p.name, address: p.address, lat: p.lat, lon: p.lon, warning: '', checked: true });
    found++;
  }
  return found;
}

/* ================================================================== *
 * A guide import waiting for its Apple Maps places
 *
 * Running the Shortcut leaves the app; iOS may unload it meanwhile. The guide
 * is kept for 24 hours so the import can go on after a restart.
 * ================================================================== */

export const PENDING_GUIDE_KEY = 'insta-pinmap.pending-guide';
const PENDING_MAX_AGE_MS = 24 * 3600 * 1000;

function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** @param {{title, link?, entries, appleIds}} guide  link: the guide link the user gave */
export function savePendingGuide(guide, { storage = browserStorage(), now = Date.now() } = {}) {
  try {
    storage?.setItem(PENDING_GUIDE_KEY, JSON.stringify({
      title: guide.title, link: guide.link || '', entries: guide.entries, appleIds: guide.appleIds, savedAt: now,
    }));
  } catch { /* full or blocked: the open dialog still has everything */ }
}

export function clearPendingGuide({ storage = browserStorage() } = {}) {
  try { storage?.removeItem(PENDING_GUIDE_KEY); } catch { /* nothing to do */ }
}

/** The waiting guide import, or null when there is none, it is broken or older than 24 hours. */
export function loadPendingGuide({ storage = browserStorage(), now = Date.now() } = {}) {
  let g;
  try {
    const raw = storage?.getItem(PENDING_GUIDE_KEY);
    if (!raw) return null;
    g = JSON.parse(raw);
  } catch {
    return null;
  }
  const usable = g && typeof g === 'object' &&
    Array.isArray(g.entries) && Array.isArray(g.appleIds) && g.appleIds.length > 0 &&
    g.appleIds.every((id) => BARE_ID.test(String(id))) &&
    Number.isFinite(g.savedAt) && g.savedAt <= now;
  if (!usable) return null;
  if (now - g.savedAt > PENDING_MAX_AGE_MS) {
    clearPendingGuide({ storage });
    return null;
  }
  return {
    title: String(g.title ?? ''), link: typeof g.link === 'string' ? g.link : '',
    entries: g.entries, appleIds: g.appleIds, savedAt: g.savedAt,
  };
}
