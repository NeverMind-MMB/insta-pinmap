/**
 * post.js — reads a public YouTube video, Facebook post, reel or page, or TikTok
 * video for /api/post: its text, and its location tag where there is one.
 *
 * Unofficial, like instagram.js: the pages can change any time. The app then
 * falls back (YouTube: oEmbed straight from the phone; otherwise the manual
 * search). A Cloudflare Worker's address may also be treated differently from
 * a home connection (bot checks, consent pages, login walls).
 *
 * Only these hosts are ever fetched: www.youtube.com (the watch page, built
 * from the video ID), www.google.com (one Maps place page, built from the
 * Place ID), facebook.com / fb.watch (redirects are followed only there) and
 * www.tiktok.com (the video page, built from the video ID; no redirects),
 * plus a post's thumbnail when imageAsDataUrl's hosts allow it (fbcdn.net).
 * Links are never logged. Pages are read with indexOf, not parsed whole: the
 * free plan allows 10 ms of CPU per request.
 */

import { youtubeId, facebookTarget, canonicalPostLink } from '../web/js/postlinks.js';
import { tiktokVideo, tiktokLink } from '../web/js/tiktok.js';
import { metaContent, headOnly, CRAWLER_USER_AGENTS, imageAsDataUrl } from './instagram.js';

export const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const [GOOGLEBOT, FACEBOOK_CRAWLER] = CRAWLER_USER_AGENTS;
/** Google answers Maps place pages with "<name> · <address>" only to this crawler (a browser gets a generic map). */
const PLACE_UA = 'facebookexternalhit/1.1';
const LANGUAGE = 'en-US,en;q=0.8';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_HOPS = 5;
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch', 'www.fb.watch']);

const VIDEO_FAILED = "Couldn't read this video.";
const FACEBOOK_FAILED = "Couldn't read this Facebook post. Only public posts can be read.";
const PAGE_FAILED = "Couldn't read this Facebook page.";
const TIKTOK_FAILED = "Couldn't read this TikTok video.";
const BAD_LINK = "That isn't a YouTube video, Facebook post or TikTok video link.";

/* ------------------------------------------------------------------ *
 * Reading pages
 * ------------------------------------------------------------------ */

/**
 * The body as text, read in chunks: at most `maxBytes`, and once `stopAfter`
 * has turned up, only `extra` characters more. What came before an error is kept.
 */
export async function readText(res, { maxBytes = MAX_BYTES, stopAfter = '', extra = 0 } = {}) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let found = -1;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const before = text.length;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (stopAfter && found === -1) found = text.indexOf(stopAfter, Math.max(0, before - stopAfter.length));
      if (bytes >= maxBytes || (found !== -1 && text.length >= found + stopAfter.length + extra)) {
        reader.cancel().catch(() => {});
        return text;
      }
    }
  } catch { /* keep what came */ }
  return text + decoder.decode();
}

/** The JSON string that starts right after its opening quote at `start`, decoded; '' if broken. */
function jsonStringAt(text, start) {
  let i = start;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 92) i += 2;        // backslash: skip the escaped character
    else if (c === 34) break;    // closing quote
    else i++;
  }
  try {
    return JSON.parse(text.slice(start - 1, i + 1));
  } catch {
    return '';
  }
}

/** The string value of the first "key":"…" at or after `from` (and before `to`); '' when there is none. */
function jsonField(text, key, from = 0, to = text.length) {
  const marker = `"${key}":"`;
  const at = text.indexOf(marker, Math.max(0, from));
  return at === -1 || at >= to ? '' : jsonStringAt(text, at + marker.length);
}

/** The JSON object that starts at the "{" at `start` (strings respected), at most `max` characters; '' otherwise. */
function jsonObjectAt(text, start, max = 20000) {
  if (text[start] !== '{') return '';
  let depth = 0;
  for (let i = start; i < Math.min(text.length, start + max); i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return '';
}

/** 'YYYY-MM-DD' (UTC) of a Unix time in seconds; '' for anything else. */
function dayOfUnix(seconds) {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : '';
}

/** Drops empty optional fields from an answer. */
function compact(answer) {
  for (const k of ['author', 'publishedAt', 'thumb', 'location']) if (!answer[k]) delete answer[k];
  return answer;
}

/* ------------------------------------------------------------------ *
 * YouTube
 * ------------------------------------------------------------------ */

/**
 * The Google Place ID in a location link's searchEndpoint.params: base64(url)
 * of a protobuf whose last field is the ID as text ("ChIJ…"), led by its length.
 */
export function placeIdOf(params) {
  let bytes;
  try {
    const b64 = decodeURIComponent(String(params || '')).replace(/-/g, '+').replace(/_/g, '/');
    bytes = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return '';
  }
  const at = bytes.indexOf('ChIJ');
  if (at === -1) return '';
  const length = bytes.charCodeAt(at - 1);
  const byLength = bytes.slice(at, at + length);
  if (length >= 20 && length <= 120 && /^[\w-]+$/.test(byLength)) return byLength;
  return (bytes.slice(at).match(/^ChIJ[\w-]{16,}/) || [''])[0];
}

/**
 * A watch page: title, full description, channel, publish day and the
 * creator's "Video location" (name + Google Place ID). The location is the
 * first superTitleLink, but only when its search link carries a Place ID —
 * otherwise that line holds hashtags. null when the page isn't this video's.
 */
export function parseWatchPage(html, id) {
  const s = String(html || '');
  const details = s.indexOf('"videoDetails":{');
  if (details === -1 || jsonField(s, 'videoId', details, details + 200) !== id) return null;
  const title = jsonField(s, 'title', details, details + 2000);
  const text = jsonField(s, 'shortDescription', details);
  const author = jsonField(s, 'ownerChannelName', details);
  const published = jsonField(s, 'publishDate', details);
  const publishedAt = /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : '';

  let location = null;
  const link = s.indexOf('"superTitleLink":');
  if (link !== -1) {
    const object = jsonObjectAt(s, link + '"superTitleLink":'.length);
    const search = object.indexOf('"searchEndpoint":{');
    if (search !== -1) {
      const placeId = placeIdOf(jsonField(object, 'params', search));
      const name = jsonField(object, 'query', search) || jsonField(object, 'text');
      if (placeId && name) location = { name, placeId };
    }
  }
  return { title, text, author, publishedAt, location };
}

/** Google's og:title of a place page, "<name> · <address>"; null for a generic map page. */
export function parsePlaceTitle(html) {
  const title = metaContent(headOnly(html), 'og:title') || '';
  const dot = title.indexOf(' · ');
  if (dot <= 0) return null;
  return { name: title.slice(0, dot).trim(), address: title.slice(dot + 3).trim() };
}

/** Name and address of a Google place, best effort; null when Google doesn't say. */
async function placeAddress(placeId, fetchFn) {
  try {
    const res = await fetchFn(`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}&hl=en`, {
      headers: { 'User-Agent': PLACE_UA, 'Accept-Language': LANGUAGE },
      redirect: 'manual',
    });
    if (res.status !== 200) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    return parsePlaceTitle(await readText(res, { stopAfter: '</head>' }));
  } catch {
    return null;
  }
}

async function readYouTube(id, fetchFn) {
  let res;
  try {
    res = await fetchFn(`https://www.youtube.com/watch?v=${id}&hl=en`, {
      // A mobile identity is sent to m.youtube.com, which lacks the location tag;
      // the cookie skips the consent page in the EU.
      headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': LANGUAGE, Cookie: 'SOCS=CAI' },
      redirect: 'manual',
    });
  } catch {
    return { ok: false, reason: 'network', message: VIDEO_FAILED };
  }
  if (res.status !== 200) {
    res.body?.cancel().catch(() => {});
    return { ok: false, reason: `http-${res.status}`, message: VIDEO_FAILED };
  }
  const page = parseWatchPage(await readText(res), id);
  if (!page || !(page.title || page.text)) return { ok: false, reason: 'not-found', message: VIDEO_FAILED };

  let location = null;
  if (page.location) {
    const place = await placeAddress(page.location.placeId, fetchFn);
    location = place
      ? { name: place.name || page.location.name, address: place.address, placeId: page.location.placeId }
      : { ...page.location };
  }
  return compact({
    ok: true, kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}`,
    title: page.title, text: page.text, author: page.author, publishedAt: page.publishedAt,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, location,
  });
}

/* ------------------------------------------------------------------ *
 * Facebook
 * ------------------------------------------------------------------ */

/** "18K views · 287 reactions | " in front of a reel's og:title (any language). */
const REEL_COUNTS = /^[\d.,]+\s*[KMB]?\s+\S+\s*·\s*[\d.,]+\s*[KMB]?\s+\S+\s*\|\s*/i;

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * A post or reel page: og:description (cut at ~200 characters) is the text,
 * unless the post's own JSON (Googlebot's page) holds the full text — taken
 * only when it starts like og:description, so a comment is never mistaken for
 * the post. og:title is the page name; for reels it is "<counts> | <text>".
 */
export function parseFacebookPost(html) {
  const s = String(html || '');
  const head = headOnly(s);
  const ogTitle = metaContent(head, 'og:title') || '';
  const ogText = (metaContent(head, 'og:description') || '').replace(/(?:\.\.\.|…)\s*$/, '').trim();
  const url = metaContent(head, 'og:url') || '';
  if (!ogTitle && !ogText && !url) return null;

  let text = ogText;
  let publishedAt = '';
  let author = '';
  const message = s.indexOf('"message":{"text":"');
  if (message !== -1 && ogText) {
    const full = jsonStringAt(s, message + '"message":{"text":"'.length);
    if (squash(full).startsWith(squash(ogText).slice(0, 40))) {
      text = full;
      const near = s.slice(Math.max(0, message - 20000), message + 20000);
      const times = [...near.matchAll(/"creation_time":(\d{9,11})/g)];
      if (times.length) {
        const closest = times.reduce((a, b) => (Math.abs(b.index - 20000) < Math.abs(a.index - 20000) ? b : a));
        publishedAt = dayOfUnix(closest[1]);
      }
      const actors = s.indexOf('"actors":[', message);
      if (actors !== -1 && actors - message < 20000) author = jsonField(s, 'name', actors, actors + 1000);
    }
  }
  const reel = REEL_COUNTS.test(ogTitle);
  return {
    url, title: reel ? '' : ogTitle, text, author: reel ? author : ogTitle || author, publishedAt,
    imageUrl: metaContent(head, 'og:image') || '',
  };
}

/** A page's about page: name (og:title up to " | "), the map pin's coordinates and the address line. */
export function parseFacebookAbout(html) {
  const s = String(html || '');
  const head = headOnly(s);
  const name = (metaContent(head, 'og:title') || '').split(' | ')[0].trim();
  const pin = s.match(/"map_pin_coordinates":\{"latitude":(-?\d+(?:\.\d+)?),"longitude":(-?\d+(?:\.\d+)?)\}/);
  if (!name && !pin) return null;
  const location = { name };
  if (pin) {
    const lat = Number(pin[1]);
    const lon = Number(pin[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) Object.assign(location, { lat, lon });
  }
  const field = s.indexOf('"field_type":"address"');
  if (field !== -1) {
    const text = s.lastIndexOf('"text":"', field);
    if (text !== -1 && field - text < 2000) {
      const address = jsonStringAt(s, text + '"text":"'.length);
      if (address) location.address = address;
    }
  }
  return { url: metaContent(head, 'og:url') || '', name, location };
}

/**
 * Fetches a Facebook address as `ua`, following redirects one at a time and
 * only inside facebook.com and fb.watch. A redirect to Facebook's own
 * sections (the login wall) ends the walk unfetched; one to a page ends it
 * with that page (`pageWay` 'stop'), or goes on to its about page ('about').
 * @returns {Promise<{url: string, html: string}|{page: object}|{reason: string}>}
 */
async function fetchFacebook(start, ua, fetchFn, { pageWay = 'stop', read = {} } = {}) {
  let url = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let res;
    try {
      res = await fetchFn(url, { headers: { 'User-Agent': ua, 'Accept-Language': LANGUAGE }, redirect: 'manual' });
    } catch {
      return { reason: 'network' };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      res.body?.cancel().catch(() => {});
      let next;
      try {
        next = new URL(location || '', url);
      } catch {
        return { reason: 'redirect' };
      }
      if (next.protocol !== 'https:' || !FACEBOOK_HOSTS.has(next.hostname.toLowerCase())) return { reason: 'redirect' };
      const target = facebookTarget(next.href);
      if (!target) return { reason: 'login' };
      if (target.kind === 'page') {
        if (pageWay === 'stop') return { page: target };
        url = target.aboutUrl !== url ? target.aboutUrl : next.href;
      } else {
        url = target.url;
      }
      continue;
    }
    if (res.status !== 200) {
      res.body?.cancel().catch(() => {});
      return { reason: `http-${res.status}` };
    }
    return { url, html: await readText(res, read) };
  }
  return { reason: 'redirects' };
}

async function readFacebookPage(aboutUrl, fetchFn) {
  // Only Googlebot's version of the about page carries the map pin.
  const got = await fetchFacebook(aboutUrl, GOOGLEBOT, fetchFn, {
    pageWay: 'about', read: { stopAfter: '"map_pin_coordinates"', extra: 200 },
  });
  const page = got.html ? parseFacebookAbout(got.html) : null;
  if (!page) return { ok: false, reason: got.reason || 'not-found', message: PAGE_FAILED };
  return {
    ok: true, kind: 'facebook-page', url: page.url || got.url, title: page.name, text: '', location: page.location,
  };
}

async function readFacebook(link, fetchFn) {
  const target = facebookTarget(link);
  if (target.kind === 'page') return readFacebookPage(target.aboutUrl, fetchFn);
  let reason = 'not-found';
  // Googlebot's page has the post's JSON with the full text; facebookexternalhit only the og tags.
  for (const ua of [GOOGLEBOT, FACEBOOK_CRAWLER]) {
    const got = await fetchFacebook(target.url, ua, fetchFn);
    if (got.page) return readFacebookPage(got.page.aboutUrl, fetchFn);
    if (!got.html) {
      reason = got.reason;
      continue;
    }
    const landed = facebookTarget(got.url);
    if (landed?.kind === 'page') return readFacebookPage(landed.aboutUrl, fetchFn);
    const post = parseFacebookPost(got.html);
    if (!post || !(post.text || post.title)) continue;
    return compact({
      ok: true, kind: 'facebook', url: canonicalPostLink(post.url) || canonicalPostLink(got.url) || got.url,
      title: post.title, text: post.text, author: post.author, publishedAt: post.publishedAt,
      thumb: await imageAsDataUrl(post.imageUrl, fetchFn),
    });
  }
  return { ok: false, reason, message: FACEBOOK_FAILED };
}

/* ------------------------------------------------------------------ *
 * TikTok
 * ------------------------------------------------------------------ */

/** A trimmed string, '' for anything else. */
const textOf = (v) => (typeof v === 'string' ? v.trim() : '');

/** A coordinate as a number (TikTok may send numbers or numeric strings); NaN for anything else. */
function coordinate(v) {
  if (typeof v === 'number') return v;
  return typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

/**
 * A TikTok video page: caption, author, day and the creator's location tag (`poi` of the
 * video's itemStruct in the rehydration JSON: name, address, city, …). Seen on 2026-10-18:
 * no coordinates; they are taken should TikTok ever send them. Only the itemStruct is
 * parsed (CPU budget). null when the page isn't this video's (another video, a challenge page).
 */
export function parseTikTokPage(html, id) {
  const s = String(html || '');
  const scope = s.indexOf('"webapp.video-detail"');
  const at = scope === -1 ? -1 : s.indexOf('"itemStruct":{', scope);
  if (at === -1) return null;
  let item;
  try {
    item = JSON.parse(jsonObjectAt(s, at + '"itemStruct":'.length, 2_000_000));
  } catch {
    return null;
  }
  if (String(item?.id ?? '') !== id) return null;

  const poi = item.poi && typeof item.poi === 'object' ? item.poi : {};
  const name = textOf(poi.name);
  let location = null;
  if (name) {
    location = { name };
    const address = textOf(poi.address) || [poi.city, poi.province, poi.country].map(textOf).filter(Boolean).join(', ');
    if (address) location.address = address;
    const lat = coordinate(poi.latitude ?? poi.lat);
    const lon = coordinate(poi.longitude ?? poi.lng ?? poi.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) {
      Object.assign(location, { lat, lon });
    }
  }
  return { text: textOf(item.desc), author: textOf(item.author?.uniqueId), publishedAt: dayOfUnix(item.createTime), location };
}

/**
 * A TikTok video or photo post, best effort: TikTok hardens this page (bot checks, challenge
 * pages), so the app reads the caption through oEmbed first and takes only what this adds.
 */
async function readTikTok(video, fetchFn) {
  const failed = (reason) => ({ ok: false, reason, message: TIKTOK_FAILED });
  let res;
  try {
    res = await fetchFn(tiktokLink({ user: video.user, id: video.id, kind: 'video' }), {
      headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': LANGUAGE },
      redirect: 'manual',
    });
  } catch {
    return failed('network');
  }
  if (res.status !== 200) {
    res.body?.cancel().catch(() => {});
    return failed(`http-${res.status}`);
  }
  const page = parseTikTokPage(await readText(res), video.id);
  if (!page) return failed('not-found');
  return compact({
    ok: true, kind: 'tiktok', url: tiktokLink({ user: page.author || video.user, id: video.id, kind: video.kind }),
    title: '', text: page.text, author: page.author, publishedAt: page.publishedAt, location: page.location,
  });
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Reads a YouTube video, a Facebook post, reel, share link or page, or a TikTok video or photo post.
 * @returns {Promise<object>} { ok: true, kind: 'youtube'|'facebook'|'facebook-page'|'tiktok', url, title, text,
 *   author?, publishedAt?, thumb?, location?: { name, lat?, lon?, address?, placeId? } }
 *   or { ok: false, reason, message }
 */
export async function readPost(link, fetchFn = fetch) {
  const id = youtubeId(link);
  if (id) return readYouTube(id, fetchFn);
  if (facebookTarget(link)) return readFacebook(link, fetchFn);
  const video = tiktokVideo(link);
  if (video) return readTikTok(video, fetchFn);
  return { ok: false, reason: 'bad-link', message: BAD_LINK };
}
