/**
 * index.js — Insta Pinmap Worker.
 *
 * Serves web/ as static files (configured in wrangler.toml) and answers three
 * routes the phone cannot do itself because of CORS:
 *   /api/ig            caption of an Instagram post (needs a work ticket)
 *   /api/resolve       where a short map link points to
 *   /api/apple-places  name and coordinates of Apple Maps places by ID (Apple Guides)
 */

import { fetchPost, imageAsDataUrl } from './instagram.js';
import { lookUpPlaces, parseIds, MAX_APPLE_IDS } from './applemaps.js';
import { verifyTicket } from './ticket.js';
import { ticketMinute } from '../web/js/ticket.js';
import versionInfo from '../web/version.json' with { type: 'json' };

/** Short-link hosts the Worker follows. Any other host ends the walk. */
const SHORT_LINK_HOSTS = [
  'maps.app.goo.gl', 'goo.gl', 'g.co',
  'maps.apple', 'maps.apple.com', 'guides.apple.com', 'share.apple.com',
];
const MAX_HOPS = 5;
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MEMORY_LIMIT = 20; // per address and minute, used when the rate-limit binding is missing
const APPLE_LIMIT = 10;  // /api/apple-places: up to 10 lookups each, so a smaller budget
const memoryHits = new Map();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-App-Version': versionInfo.version,
      ...extraHeaders,
    },
  });
}

/** Browsers say where a request comes from; other websites are refused. */
function fromOtherSite(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  return site !== null && site !== 'same-origin';
}

function isShortLinkHost(hostname) {
  const host = hostname.toLowerCase();
  return SHORT_LINK_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/** `binding`: name of the rate-limit binding; `limit`: the same budget for the in-memory fallback. */
async function overLimit(bindings, key, binding = 'IG_LIMIT', limit = MEMORY_LIMIT) {
  if (bindings[binding]) {
    const { success } = await bindings[binding].limit({ key });
    return !success;
  }
  const memoryKey = `${key}:${ticketMinute()}`;
  const hits = (memoryHits.get(memoryKey) || 0) + 1;
  memoryHits.set(memoryKey, hits);
  if (memoryHits.size > 5000) memoryHits.clear();
  return hits > limit;
}

function tooMany(extraHeaders = {}) {
  return json({ ok: false, reason: 'rate-limit', message: 'Too many requests. Wait a minute and try again.' }, 429, extraHeaders);
}

function clientAddress(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

async function handleInstagram(url, request, bindings, deps) {
  const difficulty = Number(bindings.WORK_DIFFICULTY) || 18;
  const difficultyHeader = { 'X-Work-Difficulty': String(difficulty) };
  if (await overLimit(bindings, `ig:${clientAddress(request)}`)) return tooMany(difficultyHeader);
  const nowMinute = ticketMinute();
  const code = url.searchParams.get('code') || '';
  const valid = await verifyTicket({
    code,
    minute: url.searchParams.get('m'),
    nonce: url.searchParams.get('n'),
    difficulty,
    nowMinute,
  });
  if (!valid) {
    return json({ ok: false, reason: 'ticket', message: 'Work ticket missing or expired.' }, 403, {
      ...difficultyHeader,
      'X-Server-Minute': String(nowMinute),
    });
  }
  const post = await fetchPost(code, deps.fetch);
  if (!post.ok) return json(post, 200, difficultyHeader);
  const thumb = await imageAsDataUrl(post.imageUrl, deps.fetch);
  return json({ ok: true, shortcode: post.shortcode, caption: post.caption, username: post.username, thumb }, 200, difficultyHeader);
}

/**
 * Follows a short map link one hop at a time (never automatically) and checks
 * every hop: as soon as a redirect leaves the short-link hosts, that address is
 * the answer and is not fetched.
 */
async function handleResolve(url, request, bindings, deps) {
  if (await overLimit(bindings, `resolve:${clientAddress(request)}`)) return tooMany();
  let start;
  try {
    start = new URL(url.searchParams.get('url') || '');
  } catch {
    return json({ ok: false, message: 'Invalid address.' });
  }
  if (start.protocol !== 'https:' && start.protocol !== 'http:') return json({ ok: false, message: 'Invalid address.' });
  if (!isShortLinkHost(start.hostname)) {
    return json({ ok: false, message: 'Only short Google Maps and Apple Maps links can be resolved.' });
  }

  const failed = () => json({ ok: false, message: "Couldn't resolve this short link." });
  let current = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res;
    try {
      res = await deps.fetch(current.href, {
        redirect: 'manual',
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.8,de;q=0.6' },
      });
    } catch {
      return failed();
    }
    const location = res.headers.get('Location');
    res.body?.cancel().catch(() => {});
    if (res.status < 300 || res.status > 399 || !location) {
      // The walk ended on a short-link host (e.g. an Apple Maps place page).
      return current.href !== start.href
        ? json({ ok: true, url: current.href })
        : json({ ok: false, message: "This short link doesn't lead anywhere." });
    }
    let next;
    try {
      next = new URL(location, current);
    } catch {
      return failed();
    }
    if (next.protocol !== 'https:' && next.protocol !== 'http:') return failed();
    if (!isShortLinkHost(next.hostname)) return json({ ok: true, url: next.href });
    current = next;
  }
  return failed();
}

async function handleApplePlaces(url, request, bindings, deps) {
  if (await overLimit(bindings, `apple:${clientAddress(request)}`, 'APPLE_LIMIT', APPLE_LIMIT)) return tooMany();
  const ids = parseIds(url.searchParams.get('ids'));
  if (!ids) {
    return json({ ok: false, message: `Expected 1 to ${MAX_APPLE_IDS} Apple place IDs.` }, 400);
  }
  return json({ ok: true, places: await lookUpPlaces(ids, deps.fetch, BROWSER_UA) });
}

/** All routes. Tests replace `deps.fetch`; the default calls the global fetch. */
export async function handleRequest(request, bindings, deps = { fetch: (...args) => fetch(...args) }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return bindings.ASSETS.fetch(request);
  if (request.method !== 'GET') return json({ ok: false, message: 'Method not allowed.' }, 405);
  if (fromOtherSite(request)) return json({ ok: false, reason: 'forbidden', message: 'Not available.' }, 403);
  if (url.pathname === '/api/ig') return handleInstagram(url, request, bindings, deps);
  if (url.pathname === '/api/resolve') return handleResolve(url, request, bindings, deps);
  if (url.pathname === '/api/apple-places') return handleApplePlaces(url, request, bindings, deps);
  return json({ ok: false, message: 'Not found.' }, 404);
}

export default {
  fetch(request, bindings) {
    return handleRequest(request, bindings);
  },
};
