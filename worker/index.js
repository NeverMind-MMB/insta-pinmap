/**
 * index.js — Insta Pinmap Worker.
 *
 * Serves web/ as static files (configured in wrangler.toml) and answers two
 * routes the phone cannot do itself because of CORS:
 *   /api/ig       caption of an Instagram post (needs a work ticket)
 *   /api/resolve  where a short map link (or a TikTok short link) points to
 *   /api/guide    the place links of an Apple guide link, read from the link
 *                 itself (for the iPhone Shortcut; Apple is never contacted)
 *   /api/list     the places of a shared Google Maps list (worker/googlelist.js)
 *
 * Apple Maps places of Apple Guides are not looked up here: maps.apple.com
 * refuses Cloudflare's servers (see web/js/appleplace.js).
 */

import { fetchPost, imageAsDataUrl } from './instagram.js';
import { verifyTicket } from './ticket.js';
import { ticketMinute } from '../web/js/ticket.js';
import versionInfo from '../web/version.json' with { type: 'json' };
import { readAppleGuide, isAppleGuideLink, appleIdLink } from '../web/js/importers.js';
import { googleListId } from '../web/js/googlelist.js';
import { getlistUrl, parseGoogleList, isMissingList } from './googlelist.js';

/** Short-link hosts the Worker follows. Any other host ends the walk. */
const SHORT_LINK_HOSTS = [
  'maps.app.goo.gl', 'goo.gl', 'g.co',
  'maps.apple', 'maps.apple.com', 'guides.apple.com', 'share.apple.com',
  'vm.tiktok.com', 'vt.tiktok.com',
];
/**
 * Short links on a host that serves other pages too: only these paths are followed (host, path start);
 * any other address there is an answer, not a hop.
 */
const SHORT_LINK_PATHS = [['mapy.com', '/s/'], ['mapy.cz', '/s/'], ['tiktok.com', '/t/']];
const MAX_HOPS = 5;
const BROWSER_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MEMORY_LIMIT = 20; // per address and minute, used when the rate-limit binding is missing
const memoryHits = new Map();
const GUIDE_MEMORY_LIMIT = 30; // per address and minute for /api/guide without its binding

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

/** A short-link host, or a short-link path on a host with other pages (mapy.com/s/…, tiktok.com/t/…). */
function isShortLink(url) {
  const host = url.hostname.toLowerCase();
  return isShortLinkHost(host) ||
    SHORT_LINK_PATHS.some(([h, path]) => (host === h || host.endsWith('.' + h)) && url.pathname.startsWith(path));
}

/** `limiter`: a rate-limit binding; without one, an in-memory count of `max` per minute. */
async function overLimit(limiter, key, max = MEMORY_LIMIT) {
  if (limiter) {
    const { success } = await limiter.limit({ key });
    return !success;
  }
  const memoryKey = `${key}:${ticketMinute()}`;
  const hits = (memoryHits.get(memoryKey) || 0) + 1;
  memoryHits.set(memoryKey, hits);
  if (memoryHits.size > 5000) memoryHits.clear();
  return hits > max;
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
  if (await overLimit(bindings.IG_LIMIT, `ig:${clientAddress(request)}`)) return tooMany(difficultyHeader);
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
  return json({
    ok: true, shortcode: post.shortcode, caption: post.caption, username: post.username,
    postedAt: post.postedAt || '', thumb,
    ...(post.location ? { location: post.location } : {}),
  }, 200, difficultyHeader);
}

/**
 * Follows a short map link one hop at a time (never automatically) and checks
 * every hop: as soon as a redirect leaves the short-link hosts, that address is
 * the answer and is not fetched.
 */
async function handleResolve(url, request, bindings, deps) {
  if (await overLimit(bindings.IG_LIMIT, `resolve:${clientAddress(request)}`)) return tooMany();
  let start;
  try {
    start = new URL(url.searchParams.get('url') || '');
  } catch {
    return json({ ok: false, message: 'Invalid address.' });
  }
  if (start.protocol !== 'https:' && start.protocol !== 'http:') return json({ ok: false, message: 'Invalid address.' });
  if (!isShortLink(start)) {
    return json({ ok: false, message: 'Only short map and TikTok links can be resolved.' });
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
    if (!isShortLink(next)) return json({ ok: true, url: next.href });
    current = next;
  }
  return failed();
}

function plainText(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-App-Version': versionInfo.version,
    },
  });
}

/**
 * One place link per Apple ID of the guide link, in guide order. The IDs are in
 * the link itself, so nothing is fetched; no work ticket (a Shortcut can't solve
 * one). Links are never logged.
 */
async function handleGuide(url, request, bindings) {
  if (await overLimit(bindings.GUIDE_LIMIT, `guide:${clientAddress(request)}`, GUIDE_MEMORY_LIMIT)) {
    return plainText('Too many requests. Wait a minute and try again.', 429);
  }
  // A Shortcut may glue the guide link in without URL-encoding it: then everything
  // after "link=" is the link, verbatim (its own %2B and further parameters included).
  const raw = url.search.match(/[?&]link=(https?:.*)$/is);
  const link = raw ? raw[1] : url.searchParams.get('link') || '';
  let appleIds = [];
  if (isAppleGuideLink(link)) {
    try {
      appleIds = readAppleGuide(link).appleIds;
    } catch {
      appleIds = [];
    }
  }
  if (!appleIds.length) return plainText('Not an Apple guide link with Apple Maps places.', 400);
  return plainText(appleIds.map(appleIdLink).join('\n'));
}

/**
 * The places of a shared Google Maps list. The link only gives the list ID: the
 * one request goes to Google's getlist on www.google.com, never where the link
 * points, and no redirect is followed. Own limit (LIST_LIMIT); links are never logged.
 */
async function handleList(url, request, bindings, deps) {
  if (await overLimit(bindings.LIST_LIMIT, `list:${clientAddress(request)}`)) return tooMany();
  const listId = googleListId(url.searchParams.get('link') || '');
  if (!listId) return json({ ok: false, reason: 'not-a-list', message: 'Not a Google Maps list link.' }, 400);
  const failed = () => json({
    ok: false, reason: 'upstream',
    message: "Google didn't send this list. Try again later, or import the list's file from Google Takeout in Settings → Import.",
  }, 502);
  let answer;
  try {
    const res = await deps.fetch(getlistUrl(listId), {
      redirect: 'manual',
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.8' },
    });
    if (res.status !== 200) {
      res.body?.cancel().catch(() => {});
      return failed();
    }
    answer = await res.text();
  } catch {
    return failed();
  }
  const list = parseGoogleList(answer);
  if (list) return json({ ok: true, ...list });
  if (isMissingList(answer)) {
    return json({
      ok: false, reason: 'not-found',
      message: `This Google Maps list can't be read. Only lists shared with "Anyone with the link" can be imported.`,
    }, 404);
  }
  return failed();
}

/** All routes. Tests replace `deps.fetch`; the default calls the global fetch. */
export async function handleRequest(request, bindings, deps = { fetch: (...args) => fetch(...args) }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return bindings.ASSETS.fetch(request);
  if (request.method !== 'GET') return json({ ok: false, message: 'Method not allowed.' }, 405);
  if (fromOtherSite(request)) return json({ ok: false, reason: 'forbidden', message: 'Not available.' }, 403);
  if (url.pathname === '/api/ig') return handleInstagram(url, request, bindings, deps);
  if (url.pathname === '/api/resolve') return handleResolve(url, request, bindings, deps);
  if (url.pathname === '/api/guide') return handleGuide(url, request, bindings);
  if (url.pathname === '/api/list') return handleList(url, request, bindings, deps);
  return json({ ok: false, message: 'Not found.' }, 404);
}

export default {
  fetch(request, bindings) {
    return handleRequest(request, bindings);
  },
};
