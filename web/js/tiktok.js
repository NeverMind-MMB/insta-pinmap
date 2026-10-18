/**
 * tiktok.js — TikTok videos and photo posts: which links name one, and their caption,
 * read straight from the phone through TikTok's oEmbed endpoint (it answers any site:
 * CORS "*"). The caption then goes the Instagram way: extract.js → Confirm place.
 *
 * Seen on 2026-10-18: oEmbed refuses /photo/<id> links (the same ID asked as
 * /video/<id> works) and some short links (their expanded link works). A refused short
 * link is expanded by the Worker's /api/resolve and asked again.
 * TikTok's own location tag is not read here: it is only in the video page.
 */

import { sourceOf, linkIs } from './sources.js';

export const TIKTOK_OEMBED = 'https://www.tiktok.com/oembed';

/** A TikTok video ID: a decimal number (its top 32 bits are the Unix time it was made). */
const VIDEO_ID = /^\d{6,25}$/;
/** A TikTok username: letters, digits, "_" and ".". */
const USERNAME = /^[\w.]{1,40}$/;
const TIMEOUT_MS = 12000;

const NOT_A_VIDEO = "This TikTok link isn't a video.";

/** True for a link from TikTok, by its prefix (sources.js); tiktokVideo() then reads the video. */
export function isTikTokLink(link) {
  return sourceOf(link) === 'tiktok';
}

/** True for a TikTok short link (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/): it names its video only once expanded. */
export function isTikTokShortLink(link) {
  return isTikTokLink(link) && linkIs(link, 'short');
}

/**
 * The video a TikTok link names: tiktok.com/@<user>/video/<id> or /photo/<id> (the sharing
 * query doesn't matter), m.tiktok.com/v/<id>.html and tiktok.com/embed/v2/<id>.
 * @returns {{user: string, id: string, kind: 'video'|'photo'}|null}  user '' when the link has none;
 *   null for short links, profiles and any other link
 */
export function tiktokVideo(link) {
  if (!isTikTokLink(link)) return null;
  let path;
  try {
    const s = String(link).trim();
    path = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`).pathname;
  } catch {
    return null;
  }
  const full = /^\/@([\w.]{0,40})\/(video|photo)\/(\d+)\/?$/i.exec(path);
  if (full && VIDEO_ID.test(full[3])) return { user: full[1], id: full[3], kind: full[2].toLowerCase() };
  const bare = /^\/(?:v|video|embed|embed\/v2)\/(\d+)(?:\.html)?\/?$/i.exec(path);
  if (bare && VIDEO_ID.test(bare[1])) return { user: '', id: bare[1], kind: 'video' };
  return null;
}

/** The link kept on the pin: https://www.tiktok.com/@<user>/<video|photo>/<id>. */
export function tiktokLink({ user = '', id, kind = 'video' }) {
  return `https://www.tiktok.com/@${user}/${kind === 'photo' ? 'photo' : 'video'}/${id}`;
}

/** TikTok's embed of the video a link names, for the "couldn't read" notice; null without one. */
export function tiktokEmbed(link) {
  const video = tiktokVideo(link);
  return video ? `https://www.tiktok.com/embed/v2/${video.id}` : null;
}

/** The day (UTC, 'YYYY-MM-DD') a TikTok video ID was made: its top 32 bits; '' for an implausible one. */
export function tiktokDay(id) {
  const s = String(id ?? '');
  if (!VIDEO_ID.test(s)) return '';
  const ms = Number(BigInt(s) >> 32n) * 1000;
  if (ms < Date.UTC(2014, 0, 1) || ms > Date.now() + 86400000) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A pin's post of the TikTok video `id`, whatever link form it was saved as.
 * @returns {{pin: object, post: object}|null}
 */
export function findTikTokPost(db, id) {
  for (const pin of db?.pins || []) {
    for (const post of pin.posts || []) {
      if (tiktokVideo(post.url)?.id === id) return { pin, post };
    }
  }
  return null;
}

/**
 * The caption of a TikTok video or photo post, from oEmbed.
 * @param {string} link  a video, photo or short link
 * @param {{fetch?: Function, resolve?: (link: string) => Promise<{ok: boolean, url?: string, message?: string}>}} [deps]
 *   resolve: the Worker's /api/resolve (api.js), asked only for a short link oEmbed refuses
 * @returns {Promise<object>} {ok: true, id, url, caption, username, postedAt}, or
 *   {ok: false, reason, message, id, url, username, postedAt}, where id and url are '' when no video is known
 */
export async function readTikTok(link, { fetch: get = (...args) => globalThis.fetch(...args), resolve } = {}) {
  const shared = String(link ?? '').trim();
  let video = tiktokVideo(shared);
  if (!video && !isTikTokShortLink(shared)) return failed(null, 'not-a-video', NOT_A_VIDEO);

  let answer = await oembed(video ? tiktokLink({ ...video, kind: 'video' }) : shared, get);
  if (!answer.ok && !video && answer.reason === 'refused') {
    const expanded = resolve ? await resolve(shared) : null;
    if (!expanded?.ok) return failed(null, 'resolve', expanded?.message || "Couldn't resolve this short link.");
    video = tiktokVideo(expanded.url);
    if (!video) return failed(null, 'gone', "This short link doesn't lead to a TikTok video.");
    answer = await oembed(tiktokLink({ ...video, kind: 'video' }), get);
  }
  if (!answer.ok) return failed(video, answer.reason, answer.message);

  const { id, username, caption } = answer;
  const kind = video?.id === id ? video.kind : 'video';
  return { ok: true, id, url: tiktokLink({ user: username || video?.user || '', id, kind }), caption, username, postedAt: tiktokDay(id) };
}

/** What readTikTok answers when it has no caption; with `video`, the video is still known. */
function failed(video, reason, message) {
  return video
    ? { ok: false, reason, message, id: video.id, url: tiktokLink(video), username: video.user, postedAt: tiktokDay(video.id) }
    : { ok: false, reason, message, id: '', url: '', username: '', postedAt: '' };
}

/** One oEmbed request: {ok: true, id, caption, username} or {ok: false, reason, message}. */
async function oembed(link, get) {
  let res;
  try {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
    res = await get(`${TIKTOK_OEMBED}?url=${encodeURIComponent(link)}`, { referrerPolicy: 'no-referrer', signal });
  } catch (e) {
    return e?.name === 'TimeoutError'
      ? { ok: false, reason: 'timeout', message: "TikTok didn't answer. Try again later." }
      : { ok: false, reason: 'network', message: 'No internet. Try again later.' };
  }
  let j = null;
  try {
    j = await res.json();
  } catch { /* no JSON: handled below */ }
  // A short link to a profile or a sound: oEmbed answers, but with no video.
  if (res.ok && j?.embed_type && j.embed_type !== 'video') return { ok: false, reason: 'not-a-video', message: NOT_A_VIDEO };
  if (!res.ok || !VIDEO_ID.test(String(j?.embed_product_id ?? ''))) {
    return res.status === 400 || res.status === 404
      ? { ok: false, reason: 'refused', message: "TikTok gave no text for this video: it may be private or deleted." }
      : { ok: false, reason: 'bad-response', message: "Couldn't read this TikTok video. Try again later." };
  }
  return {
    ok: true,
    id: String(j.embed_product_id),
    caption: typeof j.title === 'string' ? j.title : '',
    username: USERNAME.test(String(j.author_unique_id ?? '')) ? j.author_unique_id : '',
  };
}
