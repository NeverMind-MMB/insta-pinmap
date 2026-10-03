/**
 * index.js — Insta Pinmap Worker.
 *
 * Serves web/ as static files (configured in wrangler.toml) and answers two
 * routes the phone cannot do itself because of CORS:
 *   /api/ig       caption of an Instagram post (needs a work ticket)
 *   /api/resolve  where a short map link points to
 */

import { fetchPost, imageAsDataUrl } from './instagram.js';
import { verifyTicket } from './ticket.js';
import { ticketMinute } from '../web/js/ticket.js';
import versionInfo from '../web/version.json';

const RESOLVE_ALLOW = [
  'maps.app.goo.gl', 'goo.gl', 'g.co', 'maps.google.com', 'www.google.com', 'google.com',
  'maps.apple', 'maps.apple.com', 'guides.apple.com', 'share.apple.com',
];
const MEMORY_LIMIT = 20; // per address and minute, used when the rate-limit binding is missing
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

async function overLimit(env, address) {
  if (env.IG_LIMIT) {
    const { success } = await env.IG_LIMIT.limit({ key: address });
    return !success;
  }
  const key = `${address}:${ticketMinute()}`;
  const hits = (memoryHits.get(key) || 0) + 1;
  memoryHits.set(key, hits);
  if (memoryHits.size > 5000) memoryHits.clear();
  return hits > MEMORY_LIMIT;
}

async function handleInstagram(url, request, env) {
  const address = request.headers.get('CF-Connecting-IP') || 'local';
  if (await overLimit(env, address)) {
    return json({ ok: false, reason: 'rate-limit', message: 'Too many requests. Wait a minute and try again.' }, 429);
  }
  const difficulty = Number(env.WORK_DIFFICULTY) || 20;
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
      'X-Work-Difficulty': String(difficulty),
      'X-Server-Minute': String(nowMinute),
    });
  }
  const post = await fetchPost(code);
  if (!post.ok) return json(post);
  const thumb = await imageAsDataUrl(post.imageUrl);
  return json({ ok: true, shortcode: post.shortcode, caption: post.caption, username: post.username, thumb });
}

async function handleResolve(url) {
  let target;
  try {
    target = new URL(url.searchParams.get('url') || '');
  } catch {
    return json({ ok: false, message: 'Invalid address.' });
  }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return json({ ok: false, message: 'Invalid address.' });
  if (!RESOLVE_ALLOW.some((h) => host === h || host.endsWith('.' + h))) {
    return json({ ok: false, message: `I don't resolve this address: ${host}` });
  }
  try {
    const res = await fetch(target.href, { redirect: 'follow' });
    return json({ ok: true, url: res.url });
  } catch (e) {
    return json({ ok: false, message: `Couldn't resolve: ${e.message}` });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return json({ ok: false, message: 'Method not allowed.' }, 405);
    if (fromOtherSite(request)) return json({ ok: false, reason: 'forbidden', message: 'Not available.' }, 403);
    if (url.pathname === '/api/ig') return handleInstagram(url, request, env);
    if (url.pathname === '/api/resolve') return handleResolve(url);
    return json({ ok: false, message: 'Not found.' }, 404);
  },
};
