/**
 * postlinks.js — YouTube and Facebook links: which video, post or page a link
 * names, the key it is known by, and the text its place candidates come from.
 * Shared by the app and the Worker's /api/post (worker/post.js), so both
 * compute the same key for the work ticket. No network, no DOM.
 *
 * Keys (research: docs "post key"): YouTube "yt:<11-character id>"; Facebook
 * posts "fb:<numeric id or pfbid…>"; links whose post the Worker still has to
 * find: share links "fb:s:<code>", fb.watch "fb:w:<code>", pages "fb:page:<name>".
 */

import { sourceOf, SOURCE_GROUPS } from './sources.js';

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const FACEBOOK_ID = /^(?:\d{5,25}|pfbid[A-Za-z0-9]{20,80})$/;
const SHARE_CODE = /^[\w-]{4,40}$/;
const PAGE_NAME = /^[\w.-]{2,80}$/;

/** First path parts that are Facebook's own sections, not page names. */
const FACEBOOK_SECTIONS = new Set([
  'watch', 'reel', 'reels', 'share', 'groups', 'events', 'marketplace', 'gaming', 'login', 'login.php', 'help', 'settings',
  'privacy', 'policies', 'policy.php', 'hashtag', 'search', 'stories', 'story.php', 'permalink.php', 'photo.php', 'photo',
  'photos', 'video.php', 'videos', 'plugins', 'sharer', 'sharer.php', 'dialog', 'home.php', 'l.php', 'messages', 'friends',
  'notifications', 'bookmarks', 'saved', 'ads', 'business', 'legal', 'terms', 'about', 'pages', 'p', 'profile.php', 'people',
  'public', 'places', 'media', 'live', 'fundraisers', 'jobs', 'weather', 'recover', 'checkpoint', 'r.php', 'tr',
]);

/** A link as a URL (the scheme may be missing); null for anything else. */
function parse(link) {
  let s = String(link ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

/** Host without "www." or "m.", as sources.js compares it. */
function hostOf(u) {
  return u.hostname.toLowerCase().replace(/^(?:www|m)\./, '');
}

/** The 11-character video ID of a YouTube video link (watch, Shorts, live, embed, youtu.be); '' otherwise. */
export function youtubeId(link) {
  const u = parse(link);
  if (!u) return '';
  const host = hostOf(u);
  const parts = u.pathname.split('/').filter(Boolean);
  let id = '';
  if (host === 'youtu.be') id = parts[0] || '';
  else if (host === 'youtube.com') {
    if (parts[0] === 'watch') id = u.searchParams.get('v') || '';
    else if (['shorts', 'live', 'embed'].includes(parts[0])) id = parts[1] || '';
  }
  return YOUTUBE_ID.test(id) ? id : '';
}

/** https://www.facebook.com/<path> with only the query parameters that name the post. */
function facebookUrl(u, keep = []) {
  const q = new URLSearchParams();
  for (const k of keep) if (u.searchParams.get(k)) q.set(k, u.searchParams.get(k));
  const search = q.toString();
  return `https://www.facebook.com${u.pathname}${search ? `?${search}` : ''}`;
}

/**
 * What a Facebook link names:
 *   { kind: 'post', key, url }    a post, reel, video or photo (url: its canonical form)
 *   { kind: 'share', key, url }   a share or fb.watch link; the Worker follows it to the post
 *   { kind: 'page', key, aboutUrl } a page, whose about page may carry its address
 * null for anything else (Facebook's own sections, lookalikes, other sites).
 */
export function facebookTarget(link) {
  const u = parse(link);
  if (!u) return null;
  const host = hostOf(u);
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'fb.watch') {
    return SHARE_CODE.test(parts[0] || '') ? { kind: 'share', key: `fb:w:${parts[0]}`, url: `https://fb.watch/${parts[0]}/` } : null;
  }
  if (host !== 'facebook.com') return null;
  const first = (parts[0] || '').toLowerCase();
  const param = (k) => u.searchParams.get(k) || '';
  const post = (id, keep = []) => (FACEBOOK_ID.test(id || '') ? { kind: 'post', key: `fb:${id}`, url: facebookUrl(u, keep) } : null);

  if (first === 'share') {
    const code = ['p', 'r', 'v'].includes(parts[1]) ? parts[2] : parts[1];
    return SHARE_CODE.test(code || '') ? { kind: 'share', key: `fb:s:${code}`, url: facebookUrl(u) } : null;
  }
  if (first === 'reel') return post(parts[1]);
  if (first === 'watch') return post(param('v'), ['v']);
  if (first === 'permalink.php' || first === 'story.php') return post(param('story_fbid'), ['story_fbid', 'id']);
  if (first === 'photo' || first === 'photo.php') return post(param('fbid'), ['fbid']);
  if (first === 'profile.php') {
    const id = param('id');
    return /^\d{5,25}$/.test(id)
      ? { kind: 'page', key: `fb:page:${id}`, aboutUrl: `https://www.facebook.com/profile.php?id=${id}&sk=about` }
      : null;
  }
  if (FACEBOOK_SECTIONS.has(first) || !PAGE_NAME.test(parts[0] || '')) return null;
  if (['posts', 'videos', 'photos'].includes(parts[1])) return post(parts.at(-1));
  if (parts.length === 1 || (parts.length === 2 && parts[1] === 'about')) {
    return { kind: 'page', key: `fb:page:${first}`, aboutUrl: `https://www.facebook.com/${parts[0]}/about/` };
  }
  return null;
}

/** The key /api/post's work ticket is computed over: any YouTube video or Facebook post, share or page link; '' otherwise. */
export function postRequestKey(link) {
  const id = youtubeId(link);
  if (id) return `yt:${id}`;
  return facebookTarget(link)?.key || '';
}

/** The key a saved post is known by (dedupe.js): "yt:<id>" or "fb:<id>"; '' for share links, pages and other links. */
export function socialPostKey(link) {
  const id = youtubeId(link);
  if (id) return `yt:${id}`;
  const target = facebookTarget(link);
  return target?.kind === 'post' ? target.key : '';
}

/** The one link a video or post is stored under; '' when the link names none (yet). */
export function canonicalPostLink(link) {
  const id = youtubeId(link);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  const target = facebookTarget(link);
  return target?.kind === 'post' ? target.url : '';
}

/** The embed for the "couldn't read" fallback of the confirm dialog; '' when there is none. */
export function postEmbedLink(link) {
  const id = youtubeId(link);
  if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
  const target = facebookTarget(link);
  if (target?.kind !== 'post') return '';
  const plugin = /\/(?:reel|watch|videos)\b/.test(target.url) ? 'video' : 'post';
  return `https://www.facebook.com/plugins/${plugin}.php?href=${encodeURIComponent(target.url)}&show_text=true`;
}

/** "YouTube" or "Facebook" for a link from there (sources.js), '' otherwise. */
export function postSiteName(link) {
  const id = sourceOf(link);
  return id === 'youtube' || id === 'facebook' ? SOURCE_GROUPS.find((g) => g.id === id).name : '';
}

/** True for any YouTube or Facebook link, by its prefix (sources.js); the reader then tells a video or post from the rest. */
export function isSocialLink(link) {
  return postSiteName(link) !== '';
}

const BOILERPLATE = /^\s*(?:subscribe|follow|download|credits)\b/i;
const KEEP_LATER = /\u{1F4CD}|\b(?:address|location)\s*:/iu;
const HAS_LINK = /https?:\/\/\S/i;

/**
 * The text place candidates are taken from: the title plus the description up
 * to its first boilerplate block — a line starting with "Subscribe", "Follow",
 * "Download" or "Credits", a run of two link lines, or about `max` characters.
 * Later lines with 📍, "Address:" or "Location:" are kept. Long descriptions
 * otherwise bury the place under channel plugs and false country hints.
 */
export function candidateText(title, description, max = 600) {
  const kept = [];
  let used = 0;
  let stopped = false;
  let runStart = -1; // index in `kept` where the current run of link lines began
  for (const line of String(description || '').split(/\r?\n/)) {
    if (!stopped) {
      if (BOILERPLATE.test(line)) {
        stopped = true;
      } else if (HAS_LINK.test(line)) {
        if (runStart !== -1) {
          kept.splice(runStart);
          stopped = true;
        } else {
          runStart = kept.length;
        }
      } else if (line.trim()) {
        runStart = -1;
      }
      if (!stopped) {
        if (used + line.length > max) {
          kept.push(line.slice(0, Math.max(0, max - used)).trim());
          stopped = true;
        } else {
          kept.push(line);
          used += line.length + 1;
        }
        continue;
      }
    }
    if (KEEP_LATER.test(line)) kept.push(line);
  }
  return [String(title || '').trim(), ...kept].join('\n').trim();
}
