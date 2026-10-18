/**
 * postflow.js — one flow for social posts: Instagram, TikTok, YouTube and
 * Facebook (posts, reels and pages).
 *
 *   saved already? → read the text (the Worker or oEmbed) → the tagged location
 *   first → the caption's place candidates → Confirm place
 *
 * What differs per site is a small adapter: how a link names a post, how a
 * saved post is found, how the text and location tag are read, and the words.
 * Every adapter's read() gives the same "reading", which the shared part turns
 * into Confirm place (and, for Settings → Import, into one import row).
 */

import { store } from './store.js';
import { shortcode, normalizeLink, isInstagramLink, findPost } from './dedupe.js';
import { placeCandidates, tagSuggestions, cleanedText, eventDate } from './extract.js';
import { searchPlaces } from './geocode.js';
import { fetchPost, resolveShortLink, fetchSocialPost, fetchYouTubeOembed } from './api.js';
import { sourceOf } from './sources.js';
import {
  isTikTokLink, isTikTokShortLink, tiktokVideo, readTikTok, findTikTokPost, tiktokPostKey,
} from './tiktok.js';
import {
  isSocialLink, postRequestKey, socialPostKey, canonicalPostLink, facebookTarget, candidateText,
} from './postlinks.js';
import { openConfirm } from './confirm.js';

/**
 * The post's location tag as a place for Confirm place, or null unless it has a
 * name and real coordinates (the Worker sends `{ name, lat, lon, address? }`).
 */
export function taggedPlace(location) {
  if (!location || typeof location !== 'object' || typeof location.name !== 'string') return null;
  const name = location.name.trim();
  const { lat, lon } = location;
  if (!name || typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;
  const address = typeof location.address === 'string' ? location.address.trim() : '';
  return { name, lat, lon, address, tagged: true };
}

/**
 * A TikTok video's location tag as the tagged place of Confirm place: with coordinates as it
 * is; without (TikTok sends name and address only) the place search's best match for
 * "<name>, <address>", under the tag's name and address. null without a tag or a match.
 */
async function placeOfTikTokTag(tag) {
  const exact = taggedPlace(tag);
  if (exact || typeof tag?.name !== 'string' || !tag.name.trim()) return exact;
  const name = tag.name.trim();
  const address = typeof tag.address === 'string' ? tag.address.trim() : '';
  const hit = (await searchPlaces([name, address].filter(Boolean).join(', '), { limit: 1 })).results?.[0];
  return hit ? { name, lat: hit.lat, lon: hit.lon, address: address || hit.address || '', countryCode: hit.countryCode || '', tagged: true } : null;
}

/* ================================================================== *
 * Adapters
 *
 * isPost(link): the link names a post the site's reader can read.
 * saved(link): the pin that already has it, before anything is read.
 * read(link, {busy, done}): one of
 *   {stop: message}         nothing to pin (an error toast says why)
 *   {saved: existing}       known once the link was followed
 *   {confirm: cfg}          a Facebook page: a place, not a post
 *   a reading: {source, post, text, error, errorTitle?, tagged?, ready?,
 *     locationName?, firstSearch?, titleHint?}
 *     post: what the pin keeps; text: where candidates, tags and the date come
 *     from; error: why the text couldn't be read (null when it could);
 *     tagged: the location tag as a place, first in the list; ready: the tag as
 *     the place itself; locationName: a tag name to search for; firstSearch: a
 *     search before anything from the text; titleHint: the title before any match
 * ================================================================== */

const instagram = {
  notPost: "This Instagram link isn't a post or reel.",
  isPost: (link) => Boolean(shortcode(link)),
  saved: (link) => findPost(store.db, normalizeLink(link)),
  async read(link, { busy, done }) {
    const code = shortcode(link);
    busy('Reading the post …');
    let ig;
    try {
      ig = await fetchPost(code);
    } finally {
      done();
    }
    const caption = ig.ok ? ig.caption || '' : '';
    // The post's location tag (`locationTag`; `location` is only its name, for older apps):
    // with coordinates it is offered first as it is; a tag without usable ones still
    // counts as the best name to search for.
    const tagged = ig.ok ? taggedPlace(ig.locationTag) : null;
    const tagName = typeof ig.locationTag?.name === 'string' ? ig.locationTag.name
      : typeof ig.location === 'string' ? ig.location : '';
    return {
      source: 'instagram',
      post: {
        url: normalizeLink(link), shortcode: code,
        caption, username: ig.username || '', thumb: ig.thumb || '', postedAt: ig.ok ? ig.postedAt || '' : '',
      },
      text: caption,
      error: ig.ok ? null : ig,
      tagged,
      locationName: ig.ok && !tagged ? tagName : '',
      titleHint: tagged?.name || '',
    };
  },
};

/**
 * A TikTok video or photo post: its caption (oEmbed, straight from the phone; a short
 * link oEmbed refuses goes through the Worker first), then its location tag, which only
 * the video page has (the Worker reads it, best effort; without it the caption alone goes on).
 */
const tiktok = {
  notPost: "This TikTok link isn't a video.",
  isPost: (link) => Boolean(tiktokVideo(link) || isTikTokShortLink(link)),
  saved(link) {
    const video = tiktokVideo(link);
    return video ? findTikTokPost(store.db, video.id) : null;
  },
  async read(link, { busy, done }) {
    busy('Reading the video …');
    let tt;
    try {
      tt = await readTikTok(link, { resolve: resolveShortLink });
    } finally {
      done();
    }
    // No video behind the link (a dead short link, no network while expanding it): nothing to pin.
    if (!tt.id) return { stop: tt.message };
    if (!tiktokVideo(link)) {
      const saved = findTikTokPost(store.db, tt.id);
      if (saved) return { saved };
    }
    busy('Reading the video …');
    let page;
    let tagged = null;
    try {
      page = await fetchSocialPost(tt.url, tiktokPostKey(tt.url));
      tagged = await placeOfTikTokTag(page?.ok ? page.location : null);
    } finally {
      done();
    }
    const tagName = page?.ok && typeof page.location?.name === 'string' ? page.location.name.trim() : '';
    const caption = tt.ok ? tt.caption : (page?.ok && typeof page.text === 'string' ? page.text : '');
    return {
      source: 'tiktok',
      post: { url: tt.url, caption, username: tt.username, thumb: '', postedAt: tt.postedAt },
      text: caption,
      error: tt.ok || caption ? null : tt,
      tagged,
      locationName: tagged ? '' : tagName,
      titleHint: tagged?.name || tagName,
    };
  },
};

const SOCIAL_WORDS = {
  youtube: {
    reading: 'Reading the video …', notPost: "This YouTube link isn't a video.", failed: 'Could not read the YouTube video',
  },
  facebook: {
    reading: 'Reading the post …', notPost: "This Facebook link isn't a public post, reel or page.",
    failed: 'Could not read the Facebook post',
  },
};

/** A Facebook page: with its map pin the exact place, else a search for its name and address. */
function facebookPage(info) {
  const tag = info.location || {};
  const name = tag.name || info.title || '';
  const exact = Number.isFinite(tag.lat) && Number.isFinite(tag.lon);
  const search = [name, tag.address].filter(Boolean).join(', ');
  return {
    source: 'facebook',
    titleSuggestion: name,
    readyPlace: exact ? { lat: tag.lat, lon: tag.lon, name, address: tag.address || '', source: 'facebook' } : null,
    candidates: !exact && search ? [{ text: search, points: 70, source: 'link' }] : [],
    countries: [],
    note: info.url || '',
  };
}

/**
 * A YouTube video or a Facebook post, reel or page: the Worker reads its text
 * (and location tag). A location tag comes first: with coordinates (Facebook
 * pages) it is the place, with an address (YouTube) "<name>, <address>" is
 * searched before anything from the text. The video or post stays on the pin;
 * a Facebook page's link goes in the note.
 */
function social(site) {
  const words = SOCIAL_WORDS[site];
  return {
    notPost: words.notPost,
    isPost: (link) => Boolean(postRequestKey(link)),
    saved: (link) => findPost(store.db, link),
    async read(link, { busy, done }) {
      busy(words.reading);
      let info;
      try {
        info = await fetchSocialPost(link, postRequestKey(link));
        // The Worker couldn't read the video: the title, at least, straight from YouTube.
        if (!info.ok && site === 'youtube') info = (await fetchYouTubeOembed(canonicalPostLink(link))) || info;
      } finally {
        done();
      }
      if (info.ok && info.kind === 'facebook-page') return { confirm: facebookPage(info) };
      if (!info.ok && facebookTarget(link)?.kind === 'page') return { stop: info.message || "Couldn't read this Facebook page." };
      // A share link is known as its post once the Worker followed it.
      const url = (info.ok && socialPostKey(info.url) ? canonicalPostLink(info.url) : '') || canonicalPostLink(link) || link;
      const saved = findPost(store.db, url);
      if (saved) return { saved };

      const title = info.ok ? info.title || '' : '';
      const body = info.ok ? info.text || '' : '';
      const tag = info.ok ? info.location || null : null;
      const exact = tag && Number.isFinite(tag.lat) && Number.isFinite(tag.lon);
      return {
        source: site,
        post: {
          url, caption: [title, body].filter(Boolean).join('\n\n'),
          username: info.ok ? info.author || '' : '', thumb: info.ok ? info.thumb || '' : '',
          postedAt: info.ok ? info.publishedAt || '' : '',
        },
        text: site === 'youtube' ? candidateText(title, body) : body,
        error: info.ok ? null : info,
        errorTitle: words.failed,
        ready: exact ? { lat: tag.lat, lon: tag.lon, name: tag.name, address: tag.address || '', source: site } : null,
        locationName: tag?.name || '',
        firstSearch: tag?.name && tag.address ? `${tag.name}, ${tag.address}` : '',
        titleHint: tag?.name || '',
      };
    },
  };
}

const ADAPTERS = { instagram, tiktok, youtube: social('youtube'), facebook: social('facebook') };

/** The adapter for a link from Instagram, TikTok, YouTube or Facebook (by its prefix, sources.js); null otherwise. */
function adapterOf(link) {
  if (isInstagramLink(link)) return ADAPTERS.instagram;
  if (isTikTokLink(link)) return ADAPTERS.tiktok;
  if (isSocialLink(link)) return ADAPTERS[sourceOf(link)];
  return null;
}

/** A link from Instagram, TikTok, YouTube or Facebook (by its prefix), post or not. */
export function isPostSource(link) {
  return adapterOf(link) !== null;
}

/** A post or video link the app reads: an Instagram post, a TikTok video, a YouTube video, a Facebook post or page. */
export function isReadablePost(link) {
  return adapterOf(link)?.isPost(link) || false;
}

/* ================================================================== *
 * The shared flow
 * ================================================================== */

/** "You already saved this post": opens the pin that has it. @returns {boolean} true when it is saved */
function tellSaved(existing, env) {
  if (!existing) return false;
  env.toast(`You already saved this post: "${existing.pin.title}"`, 'info');
  env.inputDone?.();
  env.map?.goToPin(existing.pin.id);
  env.showDetail?.(existing.pin.id);
  return true;
}

/** A reading's place candidates: its location tag's name and its text, a tag's address searched first. */
function postCandidates(reading) {
  const found = placeCandidates(reading.text, { username: reading.post.username, location: reading.locationName || undefined });
  if (reading.firstSearch) found.candidates.unshift({ text: reading.firstSearch, points: 140, source: 'location' });
  return found;
}

/** Confirm place for a reading. */
function confirmOf(reading) {
  const { candidates, countries, hintedCountries } = postCandidates(reading);
  return {
    source: reading.source,
    post: reading.post,
    igError: reading.error,
    errorTitle: reading.errorTitle,
    taggedPlace: reading.tagged || null,
    readyPlace: reading.ready || null,
    titleSuggestion: reading.titleHint || candidates[0]?.text || '',
    whenSuggestion: eventDate(reading.text, { postedAt: reading.post.postedAt })?.text || '',
    candidates,
    countries,
    hintedCountries,
    searchPrefill: cleanedText(reading.text),
    tagSuggestions: tagSuggestions(reading.text, store.settings.customStopTags),
  };
}

/**
 * A post link from the input bar: saved already? → read → Confirm place.
 * @param {string} link  a link isPostSource() takes
 */
export async function addFromPost(link, env) {
  const adapter = adapterOf(link);
  if (!adapter.isPost(link)) {
    env.toast(adapter.notPost, 'error');
    return;
  }
  if (tellSaved(adapter.saved(link), env)) return;
  const reading = await adapter.read(link, {
    busy: (text) => env.toast(text, 'busy', 15000),
    done: () => env.hideToast?.(),
  });
  if (reading.stop) {
    env.toast(reading.stop, 'error', 6000);
    return;
  }
  if (tellSaved(reading.saved, env)) return;
  if (reading.confirm) return openConfirm({ ...reading.confirm, env });
  return openConfirm({ ...confirmOf(reading), env });
}
