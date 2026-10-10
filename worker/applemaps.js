/**
 * applemaps.js — name, address and coordinates of Apple Maps places by ID.
 *
 * Apple Guide links carry places Apple Maps knows only as an ID. The place page
 * https://maps.apple.com/place?auid=<id> has what the app needs in its <head>:
 *   <meta property="og:title" content="<name>">
 *   <meta property="place:location:latitude|longitude" content="…">
 *   <title><name> in <city>, <country> - Apple Maps</title>
 * maps.apple.com sends no CORS header, so this runs in the Worker.
 *
 * Local dev: Apple answers 403 when the CF-Worker header (added by workerd)
 * names example.com, which is wrangler dev's default zone. Start it with
 * `--local-upstream insta-pinmap.workers.dev` to look up places locally.
 */

import { decodeEntities, metaContent, headOnly } from './instagram.js';

export const APPLE_ID_RE = /^\d{1,20}$/;
export const MAX_APPLE_IDS = 10;
const APPLE_HOST = 'maps.apple.com';
const MAX_HEAD_BYTES = 256 * 1024;
const TITLE_SUFFIX = / - Apple Maps\s*$/;

/** Reads the body only until </head> (or MAX_HEAD_BYTES) and cancels the rest. */
export async function readHead(res, maxBytes = MAX_HEAD_BYTES) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(text) || bytes >= maxBytes) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return headOnly(text);
}

/** "<name> in <rest> - Apple Maps" → "<rest>"; '' when the title has another shape. */
export function addressFromTitle(title, name) {
  const t = decodeEntities(String(title || '')).trim();
  if (!TITLE_SUFFIX.test(t)) return '';
  const core = t.replace(TITLE_SUFFIX, '');
  if (name && core.startsWith(`${name} in `)) return core.slice(name.length + 4).trim();
  const at = core.lastIndexOf(' in ');
  return at === -1 ? '' : core.slice(at + 4).trim();
}

export function parsePlaceHead(head) {
  const name = (metaContent(head, 'og:title') || '').trim();
  const latText = (metaContent(head, 'place:location:latitude') || '').trim();
  const lonText = (metaContent(head, 'place:location:longitude') || '').trim();
  if (!name || !latText || !lonText) return null;
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const title = (head.match(/<title[^>]*>([^<]*)<\/title\s*>/i) || [])[1] || '';
  return { name, address: addressFromTitle(title, name), lat, lon };
}

/** One place; never throws. A redirect away from maps.apple.com counts as not found. */
export async function lookUpPlace(id, fetchFn, userAgent) {
  const failed = { id, ok: false };
  let res;
  try {
    res = await fetchFn(`https://${APPLE_HOST}/place?auid=${id}`, {
      redirect: 'follow',
      headers: { 'User-Agent': userAgent, 'Accept-Language': 'en-US,en;q=0.8' },
    });
  } catch {
    return failed;
  }
  let finalHost = '';
  try { finalHost = new URL(res.url).hostname.toLowerCase(); } catch { /* stays '' */ }  if (res.status !== 200 || finalHost !== APPLE_HOST) {
    res.body?.cancel().catch(() => {});
    return failed;
  }
  try {
    const place = parsePlaceHead(await readHead(res));
    return place ? { id, ok: true, ...place } : failed;
  } catch {
    return failed;
  }
}

/** Sequential on purpose: ≤ 10 ids with one redirect each stays inside the free plan's subrequest limit. */
export async function lookUpPlaces(ids, fetchFn, userAgent) {
  const places = [];
  for (const id of ids) places.push(await lookUpPlace(id, fetchFn, userAgent));
  return places;
}

/** "1,2,3" → ['1','2','3'] or null when anything is off. */
export function parseIds(param) {
  if (typeof param !== 'string' || param === '') return null;
  const ids = param.split(',');
  if (ids.length > MAX_APPLE_IDS || !ids.every((id) => APPLE_ID_RE.test(id))) return null;
  return ids;
}
