/**
 * appleplace.js — Apple Maps places of Apple Guides, looked up outside the app.
 *
 * Apple Guides name the places Apple Maps knows only by an ID. maps.apple.com
 * refuses Cloudflare's servers, but answers phones and home computers. So the
 * lookup runs either in an iPhone Shortcut ("Insta Pinmap Apple") or in the
 * computer script tools/apple-guide.mjs; this module holds what both sides share.
 *
 * Pure and browser-safe: no Node imports, no DOM. Storage is passed in.
 *
 * The place page https://maps.apple.com/place?auid=<id> has in its <head>:
 *   <meta property="og:title" content="<name>">
 *   <meta property="place:location:latitude|longitude" content="…">
 *   <title><name> in <city>, <country> - Apple Maps</title>
 */

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

export const SHORTCUT_NAME = 'Insta Pinmap Apple';
export const SHORTCUT_RUN_URL = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=clipboard`;

const PLACE_URL_ID = /^https:\/\/maps\.apple\.com\/place\?auid=(\d{1,20})$/;
const BARE_ID = /^\d{1,20}$/;

/** What the Shortcut gets: one place address per line, in guide order. */
export function shortcutInput(appleIds) {
  return appleIds.map((id) => `https://maps.apple.com/place?auid=${id}`).join('\n');
}

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

/** What "Paste results" reads: raw pages when the text contains `<html`, else (or when no page matches) the "@@" / tab lines. */
export function parseShortcutPaste(text, appleIds) {
  const s = String(text ?? '');
  if (/<html/i.test(s)) {
    const pages = parseShortcutPages(s, appleIds);
    if (pages.size) return pages;
  }
  return parseShortcutResults(s);
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

/** @param {{title, entries, appleIds}} guide */
export function savePendingGuide(guide, { storage = browserStorage(), now = Date.now() } = {}) {
  try {
    storage?.setItem(PENDING_GUIDE_KEY, JSON.stringify({
      title: guide.title, entries: guide.entries, appleIds: guide.appleIds, savedAt: now,
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
  return { title: String(g.title ?? ''), entries: g.entries, appleIds: g.appleIds, savedAt: g.savedAt };
}
