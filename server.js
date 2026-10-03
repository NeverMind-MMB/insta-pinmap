#!/usr/bin/env node
/**
 * Instagram Location Saver — mini server
 *
 * Deliberately WITHOUT npm dependencies. Node built-ins only.
 * Runs the same in Termux (Android) and on Windows/WSL/Linux.
 *
 *   node server.js [--port 8car] [--host 127.0.0.1] [--mock]
 *
 * Why a server at all, if everything is local?
 *  1. To Chrome, http://127.0.0.1 is a "secure origin": real separate
 *     storage, service worker, installable as an app icon, share target.
 *     An HTML file opened from a file manager (file://) gets none of that.
 *  2. Instagram and the place search cannot be queried from the browser
 *     (CORS). From the server they can.
 *  3. Nominatim's usage policy requires an identifying User-Agent,
 *     which browser JavaScript is not allowed to set. Here it is possible.
 */

'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { URL } = require('node:url');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const PINS_FILE = path.join(DATA_DIR, 'pins.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const MAX_BACKUPS = 20;

const APP_NAME = 'InstaPinMap';
const APP_VERSION = '1.0.0';
/** Nominatim requires an identifying user agent. */
const USER_AGENT = `${APP_NAME}/${APP_VERSION} (personal offline map collection)`;
/** For the Instagram fetch: a normal browser UA, otherwise a login wall often appears. */
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Mobile Safari/537.36';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const PORT = parseInt(argValue('--port', process.env.PINMAP_PORT || '8080'), 10) || 8080;
const HOST = argValue('--host', process.env.PINMAP_HOST || '127.0.0.1');
const MOCK = args.includes('--mock');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function log(...a) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}]`, ...a);
}

function sendJSON(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': body.length });
  res.end(body);
}

/** Reads a request body with a size limit. */
function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * HTTPS fetch that follows redirects.
 * Returns { status, headers, body, finalUrl }.
 */
function fetchUrl(target, opts = {}) {
  const {
    headers = {},
    maxRedirects = 5,
    timeout = 15000,
    method = 'GET',
    followRedirects = true,
    maxBytes = 8 * 1024 * 1024,
  } = opts;

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(target);
    } catch {
      return reject(new Error('Invalid URL'));
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return reject(new Error('Only http/https allowed'));
    }
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      url,
      {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          ...headers,
        },
        timeout,
      },
      (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc) {
          res.resume();
          if (!followRedirects) {
            return resolve({ status, headers: res.headers, body: '', finalUrl: new URL(loc, url).href });
          }
          if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
          const next = new URL(loc, url).href;
          return resolve(fetchUrl(next, { ...opts, maxRedirects: maxRedirects - 1 }));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            finalUrl: url.href,
          })
        );
        res.on('error', reject);
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Storage: pins.json is the single source of truth
// ---------------------------------------------------------------------------

const EMPTY_DB = { version: 1, tags: [], pins: [], postIndex: {}, settings: {} };

async function ensureDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

async function readPins() {
  try {
    const raw = await fsp.readFile(PINS_FILE, 'utf8');
    const db = JSON.parse(raw);
    if (!db || typeof db !== 'object' || !Array.isArray(db.pins)) {
      throw new Error('Unexpected structure');
    }
    return { ...EMPTY_DB, ...db };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...EMPTY_DB };
    // Broken file: do not overwrite it; move it aside and restore from the
    // most recent usable backup.
    log('!! pins.json unreadable:', err.message);
    const broken = path.join(BACKUP_DIR, `KAPUTT-${Date.now()}.json`);
    try {
      await fsp.rename(PINS_FILE, broken);
      log('   moved aside as', path.basename(broken));
    } catch { /* doesn't matter */ }
    const restored = await restoreLatestBackup();
    if (restored) {
      log('   restored from backup:', restored.file, `(${restored.db.pins.length} pins)`);
      // Write it back right away. Without this, pins.json is still missing and
      // the next request returns an empty collection again; the restore
      // would only be a one-time consolation in the log.
      try {
        await doWritePins(restored.db);
        log('   written back to data/pins.json');
      } catch (e) {
        log('   !! Writing back failed:', e.message);
      }
      return restored.db;
    }
    log('   no usable backup found, starting empty');
    return { ...EMPTY_DB };
  }
}

async function restoreLatestBackup() {
  let names;
  try {
    names = (await fsp.readdir(BACKUP_DIR)).filter((n) => /^pins-\d+\.json$/.test(n)).sort().reverse();
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const db = JSON.parse(await fsp.readFile(path.join(BACKUP_DIR, name), 'utf8'));
      if (db && Array.isArray(db.pins)) return { file: name, db: { ...EMPTY_DB, ...db } };
    } catch { /* try the next one */ }
  }
  return null;
}

let writeChain = Promise.resolve();
/** Writes are serialized so two tabs never get in each other's way. */
function writePins(db) {
  writeChain = writeChain.then(() => doWritePins(db)).catch((e) => {
    log('!! Write error:', e.message);
    throw e;
  });
  return writeChain;
}

async function doWritePins(db) {
  await ensureDirs();
  // First back up what is there ...
  try {
    const prev = await fsp.readFile(PINS_FILE);
    const stamp = String(Date.now()).padStart(14, '0');
    await fsp.writeFile(path.join(BACKUP_DIR, `pins-${stamp}.json`), prev);
    const old = (await fsp.readdir(BACKUP_DIR))
      .filter((n) => /^pins-\d+\.json$/.test(n))
      .sort()
      .slice(0, -MAX_BACKUPS);
    await Promise.all(old.map((n) => fsp.unlink(path.join(BACKUP_DIR, n)).catch(() => {})));
  } catch (e) {
    if (e.code !== 'ENOENT') log('Backup skipped:', e.message);
  }
  // ... then write atomically: temp + rename, so a power failure
  // in the middle of writing never leaves half a file behind.
  const tmp = `${PINS_FILE}.${process.pid}.tmp`;
  const payload = JSON.stringify(db, null, 2);
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(payload, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, PINS_FILE);
}

// ---------------------------------------------------------------------------
// Optional API keys (LocationIQ / Geoapify), stored locally only
// ---------------------------------------------------------------------------

async function readKeys() {
  try {
    return JSON.parse(await fsp.readFile(KEYS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
async function writeKeys(obj) {
  await ensureDirs();
  await fsp.writeFile(KEYS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Instagram: caption, username and thumbnail from the embed page
// ---------------------------------------------------------------------------

/** Extracts the shortcode from every common Instagram link form. */
function igShortcode(input) {
  if (!input) return null;
  const m = String(input).match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const bare = String(input).trim().match(/^[A-Za-z0-9_-]{5,20}$/);
  return bare ? bare[0] : null;
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

/**
 * Several extraction strategies in turn. Instagram has rebuilt this page
 * several times in the past; if one strategy fails, the next one takes over.
 * Each returns { caption, username, thumb } or null.
 */
const IG_STRATEGIES = [
  // 1) Embedded JSON object "shortcode_media" (the richest source)
  function fromSharedData(html) {
    const m = html.match(/"shortcode_media"\s*:\s*(\{)/);
    if (!m) return null;
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = start; i < html.length && i < start + 400000; i++) {
      const c = html[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      } else if (c === '"') {
        // Skip strings so braces inside text do not count
        i++;
        while (i < html.length && !(html[i] === '"' && html[i - 1] !== '\\')) i++;
      }
    }
    if (end === -1) return null;
    let obj;
    try {
      obj = JSON.parse(html.slice(start, end));
    } catch {
      return null;
    }
    const caption =
      obj?.edge_media_to_caption?.edges?.[0]?.node?.text ??
      obj?.caption?.text ??
      obj?.accessibility_caption ??
      '';
    return {
      caption: String(caption || ''),
      username: obj?.owner?.username || '',
      thumb: obj?.display_url || obj?.thumbnail_src || '',
      location: obj?.location?.name || '',
      strategy: 'shortcode_media',
    };
  },

  // 2) The visible caption of the /embed/captioned/ page
  function fromCaptionedMarkup(html) {
    // Only start capturing after the closing bracket of the opening tag,
    // otherwise 'class="Caption">' itself ends up in the text.
    const block = html.match(/class="Caption"[^>]*>([\s\S]{0,20000}?)<\/div>/i);
    if (!block) return null;
    let text = block[1];
    const user = text.match(/class="CaptionUsername"[\s\S]{0,400}?>([^<]+)</i);
    // Cut off the username block and the comment count
    text = text.replace(/<div class="CaptionComments">[\s\S]*$/i, '');
    text = text.replace(/<a[^>]*class="CaptionUsername"[\s\S]*?<\/a>/i, '');
    const caption = decodeEntities(text).replace(/\s+\n/g, '\n').trim();
    if (!caption) return null;
    return {
      caption,
      username: user ? decodeEntities(user[1]).trim() : '',
      thumb: (html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i) || [])[1] || '',
      location: '',
      strategy: 'captioned-markup',
    };
  },

  // 3) og: metadata (still there when everything else fails)
  function fromOpenGraph(html) {
    const pick = (p) =>
      (html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${p}["']`, 'i')) ||
        [])[1] || '';
    const desc = decodeEntities(pick('og:description'));
    const img = pick('og:image');
    if (!desc && !img) return null;
    // Typical: '123 likes, 4 comments - username on January 1, 2026: "The text"'
    const q = desc.match(/:\s*[""](.+)[""]\s*$/s);
    const user = desc.match(/-\s*([A-Za-z0-9._]+)\s+on\s/) || desc.match(/^([A-Za-z0-9._]+)\s+on\s/);
    return {
      caption: q ? q[1] : desc,
      username: user ? user[1] : '',
      thumb: decodeEntities(img),
      location: '',
      strategy: 'opengraph',
    };
  },
];

async function fetchInstagram(rawUrl) {
  const code = igShortcode(rawUrl);
  if (!code) return { ok: false, reason: 'kein-shortcode', message: 'That does not look like an Instagram link.' };

  if (MOCK) {
    // Various caption forms for trying things out without real posts.
    // The shortcode decides which one you get:
    //   .../p/SOLO1/     only a place name and emoji
    //   .../p/NOPLACE1/  text without any place
    //   .../p/KAPUTT1/   fetch fails (fallback path with embed)
    //   anything else    detailed caption with a place marker
    const proben = {
      SOLO: { caption: 'Zermatt 🇨🇭❄️', username: 'bergfex' },
      NOPLACE: { caption: 'Guten Morgen ihr Lieben ❤️ #love #reels #instagood', username: 'jemand' },
      LANG: {
        caption: 'Sunset an der Praia da Marinha 🇵🇹🌅\nEiner dieser Abende, die man nicht vergisst.\n#algarve #portugal #sunset',
        username: 'reisefee',
      },
    };
    const gross = code.toUpperCase();
    if (gross.startsWith('KAPUTT')) {
      return {
        ok: false, reason: 'nicht-gefunden',
        message: 'Mock mode: simulating a failed fetch here.',
      };
    }
    const treffer = Object.keys(proben).find((k) => gross.startsWith(k));
    const p = treffer
      ? proben[treffer]
      : {
          caption: 'Bester Kaffee der Stadt ☕ 📍 Machhoerndl Kaffee, Nürnberg 🇩🇪 #coffee #nuernberg #speciality',
          username: 'testaccount',
        };
    return { ok: true, shortcode: code, strategy: 'mock', thumb: '', location: '', ...p };
  }

  const url = `https://www.instagram.com/p/${code}/embed/captioned/`;
  let res;
  try {
    res = await fetchUrl(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (e) {
    return { ok: false, reason: 'netzwerk', message: `Instagram not reachable: ${e.message}` };
  }
  if (res.status !== 200) {
    return { ok: false, reason: `http-${res.status}`, message: `Instagram responded with ${res.status}.` };
  }
  if (/LoginAndSignupPage|loginForm|"login_page"/i.test(res.body) && res.body.length < 60000) {
    return { ok: false, reason: 'login-wand', message: 'Instagram currently requires a login for this post.' };
  }

  for (const strat of IG_STRATEGIES) {
    let out = null;
    try {
      out = strat(res.body);
    } catch { /* next strategy */ }
    if (out && (out.caption || out.thumb)) {
      return { ok: true, shortcode: code, ...out };
    }
  }
  return {
    ok: false,
    reason: 'nicht-gefunden',
    message: 'The page arrived, but no text could be read from it. Instagram has probably changed something.',
  };
}

// ---------------------------------------------------------------------------
// Place search: Photon first, Nominatim as fallback
// ---------------------------------------------------------------------------

/** Nominatim allows at most one request per second. We stick to that. */
function makeLimiter(minGapMs) {
  let last = 0;
  let queue = Promise.resolve();
  return function limited(fn) {
    queue = queue.then(async () => {
      const wait = Math.max(0, last + minGapMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    return queue;
  };
}
const nominatimLimit = makeLimiter(1100);
const photonLimit = makeLimiter(250);

function normPhoton(json) {
  const feats = json?.features || [];
  return feats.map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    const parts = [p.name, p.street && `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}`, p.postcode, p.city || p.town || p.village, p.state, p.country];
    return {
      lat, lon,
      name: p.name || p.street || p.city || p.country || '',
      address: [...new Set(parts.filter(Boolean))].join(', '),
      kind: p.osm_value || p.type || '',
      category: p.osm_key || '',
      countryCode: (p.countrycode || '').toUpperCase(),
      importance: typeof p.importance === 'number' ? p.importance : null,
      source: 'photon',
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

function normNominatim(arr) {
  return (arr || []).map((r) => ({
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    name: r.name || (r.display_name || '').split(',')[0],
    address: r.display_name || '',
    kind: r.type || '',
    category: r.class || '',
    countryCode: (r.address?.country_code || '').toUpperCase(),
    importance: typeof r.importance === 'number' ? r.importance : null,
    source: 'nominatim',
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

const MOCK_PLACES = [
  { q: 'machhoerndl', lat: 49.4521, lon: 11.0767, name: 'Machhörndl Kaffee', address: 'Obere Kanalstraße 11, 90429 Nürnberg', kind: 'cafe', category: 'amenity', countryCode: 'DE', importance: 0.4 },
  { q: 'nuernberg', lat: 49.4539, lon: 11.0775, name: 'Nürnberg', address: '90402 Nürnberg, Bayern, Deutschland', kind: 'city', category: 'place', countryCode: 'DE', importance: 0.75 },
  { q: 'berlin', lat: 52.5170, lon: 13.3889, name: 'Berlin', address: 'Berlin, Deutschland', kind: 'city', category: 'place', countryCode: 'DE', importance: 0.85 },
  { q: 'paris', lat: 48.8566, lon: 2.3522, name: 'Paris', address: 'Paris, Île-de-France, Frankreich', kind: 'city', category: 'place', countryCode: 'FR', importance: 0.9 },
  { q: 'paris texas', lat: 33.6609, lon: -95.5555, name: 'Paris', address: 'Paris, Texas, Vereinigte Staaten', kind: 'city', category: 'place', countryCode: 'US', importance: 0.5 },
  { q: 'olympiapark', lat: 48.1698, lon: 11.5405, name: 'Olympiapark', address: 'Toni-Merkens-Weg 4, 80809 München', kind: 'park', category: 'leisure', countryCode: 'DE', importance: 0.5 },
  { q: 'zermatt', lat: 46.0207, lon: 7.7491, name: 'Zermatt', address: '3920 Zermatt, Wallis, Schweiz', kind: 'village', category: 'place', countryCode: 'CH', importance: 0.6 },
  { q: 'hallstatt', lat: 47.5622, lon: 13.6493, name: 'Hallstatt', address: '4830 Hallstatt, Oberösterreich', kind: 'village', category: 'place', countryCode: 'AT', importance: 0.6 },
  { q: 'lissabon', lat: 38.7223, lon: -9.1393, name: 'Lissabon', address: 'Lissabon, Portugal', kind: 'city', category: 'place', countryCode: 'PT', importance: 0.85 },
  { q: 'praia da marinha', lat: 37.0894, lon: -8.4118, name: 'Praia da Marinha', address: 'Lagoa, Algarve, Portugal', kind: 'beach', category: 'natural', countryCode: 'PT', importance: 0.45 },
];

async function geocode(q, opts = {}) {
  const { limit = 8, countryCode = '', lang = 'de' } = opts;
  const query = String(q || '').trim();
  if (!query) return { ok: true, results: [] };

  if (MOCK) {
    const needle = query.toLowerCase();
    const hits = MOCK_PLACES.filter((p) => needle.includes(p.q) || p.q.includes(needle.split(/\s+/)[0]))
      .map((p) => ({ ...p, source: 'mock' }));
    return { ok: true, results: hits.slice(0, limit), provider: 'mock' };
  }

  const keys = await readKeys();

  // 1) Photon: allows search-as-you-type, which Nominatim forbids.
  try {
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('lang', lang === 'de' ? 'de' : 'en');
    const r = await photonLimit(() => fetchUrl(u.href, { headers: { 'User-Agent': USER_AGENT } }));
    if (r.status === 200) {
      const results = normPhoton(JSON.parse(r.body));
      if (results.length) return { ok: true, results, provider: 'photon' };
    }
  } catch (e) {
    log('Photon failed:', e.message);
  }

  // 2) Nominatim, at most one request per second, with identification.
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('accept-language', lang);
    if (countryCode) u.searchParams.set('countrycodes', countryCode.toLowerCase());
    const r = await nominatimLimit(() => fetchUrl(u.href, { headers: { 'User-Agent': USER_AGENT } }));
    if (r.status === 200) {
      const results = normNominatim(JSON.parse(r.body));
      if (results.length) return { ok: true, results, provider: 'nominatim' };
    }
  } catch (e) {
    log('Nominatim failed:', e.message);
  }

  // 3) Optional keyed service as the last fallback.
  if (keys.locationiq) {
    try {
      const u = new URL('https://eu1.locationiq.com/v1/search');
      u.searchParams.set('key', keys.locationiq);
      u.searchParams.set('q', query);
      u.searchParams.set('format', 'json');
      u.searchParams.set('addressdetails', '1');
      u.searchParams.set('limit', String(limit));
      const r = await fetchUrl(u.href);
      if (r.status === 200) {
        const results = normNominatim(JSON.parse(r.body)).map((x) => ({ ...x, source: 'locationiq' }));
        if (results.length) return { ok: true, results, provider: 'locationiq' };
      }
    } catch (e) {
      log('LocationIQ failed:', e.message);
    }
  }

  return { ok: true, results: [], provider: 'keiner', note: 'No service returned a result.' };
}

async function reverseGeocode(lat, lon) {
  if (MOCK) {
    return { ok: true, result: { lat, lon, name: 'Testort', address: `Teststraße 1, ${lat.toFixed(3)}/${lon.toFixed(3)}`, countryCode: 'DE', source: 'mock' } };
  }
  try {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('accept-language', 'de');
    const r = await nominatimLimit(() => fetchUrl(u.href, { headers: { 'User-Agent': USER_AGENT } }));
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      const one = normNominatim([j])[0];
      if (one) return { ok: true, result: one };
    }
  } catch (e) {
    log('Reverse search failed:', e.message);
  }
  // Photon can do this too
  try {
    const u = new URL('https://photon.komoot.io/reverse');
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lon));
    u.searchParams.set('lang', 'de');
    const r = await photonLimit(() => fetchUrl(u.href, { headers: { 'User-Agent': USER_AGENT } }));
    if (r.status === 200) {
      const one = normPhoton(JSON.parse(r.body))[0];
      if (one) return { ok: true, result: one };
    }
  } catch { /* give up */ }
  return { ok: false, message: 'No address found.' };
}

// ---------------------------------------------------------------------------
// Resolve short links (maps.app.goo.gl, maps.apple, instagr.am ...)
// ---------------------------------------------------------------------------

const RESOLVE_ALLOW = [
  'maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.google.com', 'www.google.com', 'google.com',
  'maps.apple', 'maps.apple.com', 'guides.apple.com', 'share.apple.com',
  'instagram.com', 'www.instagram.com', 'instagr.am',
];

async function resolveShort(target) {
  let u;
  try {
    u = new URL(target);
  } catch {
    return { ok: false, message: 'Invalid URL.' };
  }
  const host = u.hostname.toLowerCase();
  if (!RESOLVE_ALLOW.some((h) => host === h || host.endsWith('.' + h))) {
    return { ok: false, message: `Not resolving this host: ${host}` };
  }
  if (MOCK) {
    return { ok: true, url: 'https://www.google.com/maps/place/Testort/@49.4539,11.0775,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d49.4539!4d11.0775' };
  }
  try {
    const r = await fetchUrl(u.href, { headers: { 'User-Agent': BROWSER_UA } });
    return { ok: true, url: r.finalUrl };
  } catch (e) {
    return { ok: false, message: `Could not resolve: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // Prevent path traversal
  const abs = path.join(WEB_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(WEB_DIR)) return sendText(res, 403, 'Forbidden');

  let st;
  try {
    st = await fsp.stat(abs);
  } catch {
    return sendText(res, 404, 'Not found');
  }
  if (st.isDirectory()) return serveStatic(req, res, path.posix.join(rel, 'index.html'));

  const ext = path.extname(abs).toLowerCase();
  const etag = `W/"${st.size}-${st.mtimeMs.toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    ETag: etag,
    // The service worker takes care of caching; the server should not
    // interfere during development.
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=0, must-revalidate',
  });
  fs.createReadStream(abs).pipe(res);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function handle(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  // Only allow local origins. The server is not meant for the internet.
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
    return sendJSON(res, 403, { ok: false, message: 'Foreign origin rejected.' });
  }

  if (p === '/api/health') {
    return sendJSON(res, 200, { ok: true, app: APP_NAME, version: APP_VERSION, mock: MOCK, node: process.version });
  }

  if (p === '/api/pins') {
    if (req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, db: await readPins() });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      let db;
      try {
        db = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        return sendJSON(res, 400, { ok: false, message: 'Invalid JSON: ' + e.message });
      }
      if (!db || !Array.isArray(db.pins)) {
        return sendJSON(res, 400, { ok: false, message: 'Expected an object with a pins array.' });
      }
      await writePins({ ...EMPTY_DB, ...db });
      return sendJSON(res, 200, { ok: true, count: db.pins.length });
    }
    return sendJSON(res, 405, { ok: false, message: 'Method not allowed' });
  }

  if (p === '/api/ig') {
    return sendJSON(res, 200, await fetchInstagram(u.searchParams.get('url')));
  }

  if (p === '/api/geocode') {
    const out = await geocode(u.searchParams.get('q'), {
      limit: parseInt(u.searchParams.get('limit') || '8', 10),
      countryCode: u.searchParams.get('cc') || '',
    });
    return sendJSON(res, 200, out);
  }

  if (p === '/api/reverse') {
    const lat = parseFloat(u.searchParams.get('lat'));
    const lon = parseFloat(u.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return sendJSON(res, 400, { ok: false, message: 'lat and lon required' });
    }
    return sendJSON(res, 200, await reverseGeocode(lat, lon));
  }

  if (p === '/api/resolve') {
    return sendJSON(res, 200, await resolveShort(u.searchParams.get('url') || ''));
  }

  if (p === '/api/keys') {
    if (req.method === 'GET') {
      const k = await readKeys();
      // Never return keys, only whether one is set.
      return sendJSON(res, 200, { ok: true, set: Object.keys(k).filter((n) => k[n]) });
    }
    if (req.method === 'PUT') {
      try {
        await writeKeys(JSON.parse((await readBody(req, 8192)).toString('utf8')));
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        return sendJSON(res, 400, { ok: false, message: e.message });
      }
    }
  }

  // Android sharing lands here: the target in the manifest is a POST form.
  // We redirect to the start page and append the text as a parameter,
  // so the interface can pick it up.
  if (p === '/share' && req.method === 'POST') {
    let text = '';
    try {
      const body = (await readBody(req, 1024 * 1024)).toString('utf8');
      const params = new URLSearchParams(body);
      text = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
    } catch { /* doesn't matter */ }
    res.writeHead(303, { Location: '/?shared=' + encodeURIComponent(text) });
    return res.end();
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { ok: false, message: 'Method not allowed' });
  }
  return serveStatic(req, res, p);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    log('!! Error on', req.method, req.url, '->', err.message);
    if (!res.headersSent) sendJSON(res, 500, { ok: false, message: err.message });
    else res.end();
  });
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

ensureDirs()
  .then(() => new Promise((r) => server.listen(PORT, HOST, r)))
  .then(async () => {
    const db = await readPins();
    console.log('');
    console.log(`  ${APP_NAME} ${APP_VERSION}${MOCK ? '  [MOCK MODE]' : ''}`);
    console.log(`  Node ${process.version}`);
    console.log('');
    console.log(`  Open in browser:     http://127.0.0.1:${PORT}/`);
    if (HOST === '0.0.0.0') {
      for (const a of lanAddresses()) console.log(`  On home network:     http://${a}:${PORT}/`);
    }
    console.log(`  Self-test:           http://127.0.0.1:${PORT}/selftest.html`);
    console.log('');
    console.log(`  Data:                ${PINS_FILE}`);
    console.log(`  Saved pins:          ${db.pins.length}`);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');
  })
  .catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is in use. Is the app already running?`);
      console.error(`  Choose another port:  node server.js --port ${PORT + 1}\n`);
    } else {
      console.error('\n  Startup failed:', err.message, '\n');
    }
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log('\n  Stopped.');
  process.exit(0);
});

module.exports = { igShortcode, decodeEntities, IG_STRATEGIES, normPhoton, normNominatim };
