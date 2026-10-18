/**
 * sources.js — what the app reads, in one place: the "Supported links and
 * files" list of the unsupported-link dialog, and where to ask for more.
 * A new source is one more entry here (test/sources.test.mjs checks each entry
 * against the code that reads it).
 */

/** The project's GitHub issues: where people ask for a site the app doesn't read yet. */
export const ISSUES_URL = 'https://github.com/NeverMind-MMB/insta-pinmap/issues';

/**
 * The app moved from insta-pinmap.… to opin.… in 2.1.0: on the old address it shows a banner
 * that sends people to the new one (address.js). A copy that keeps the Worker name
 * insta-pinmap sets this to false.
 */
export const MOVED_TO_OPIN = true;

/** GitHub's issue search for `site`, e.g. "pinterest.com". */
export function issuesSearchUrl(site) {
  return `${ISSUES_URL}?q=${encodeURIComponent(`is:issue ${site}`)}`;
}

/**
 * The sources a link can come from. Which one a link belongs to is decided by
 * its prefix and nothing else (sourceOf): a host and the start of a path,
 * where "*" in the host stands for a domain ending ("com", "de", "co.uk").
 * Reading the link (post codes, coordinates, guides) comes after, in that
 * source's reader. A new source is one more entry.
 *   name: what the add-pin animation says for it; logo: the image it shows instead (256 px box,
 *   the mark inside the inscribed circle; other companies' logos are never rotated);
 *   color: the default colour of its pins (store.pinColor), from the palette in store.js;
 *   sources: the pin `source` values the readers write for it;
 *   guides: the prefixes of Apple guide links; short: those of short links the helper expands;
 *   lists: those of Google Maps lists (not read yet).
 */
export const SOURCE_GROUPS = [
  {
    id: 'instagram',
    name: 'Instagram',
    logo: '/icons/sources/instagram.png',
    color: '#8f4b6b',
    sources: ['instagram'],
    prefixes: [
      'instagram.com/p/', 'instagram.com/reel/', 'instagram.com/reels/', 'instagram.com/tv/',
      // Any other instagram.com link is Instagram's too: the post reader tells a post
      // (also instagram.com/<user>/p/<code>) from the rest.
      'instagram.com/', 'instagr.am/p/', 'instagr.am/reel/', 'ig.me/p/', 'ig.me/reel/',
    ],
  },
  {
    id: 'apple',
    name: 'Apple Maps',
    logo: '/icons/sources/apple.svg',
    color: '#3a6ea5',
    sources: ['apple-ort', 'apple-guide'],
    prefixes: ['maps.apple.com/guides', 'guides.apple.com/', 'maps.apple.com/'],
    guides: ['maps.apple.com/guides', 'guides.apple.com/'],
  },
  {
    id: 'google',
    name: 'Google Maps',
    logo: '/icons/sources/google.png',
    color: '#2f7d5d',
    sources: ['google-link', 'google-takeout', 'google-csv'],
    prefixes: ['google.*/maps', 'google.*/maps/placelists/', 'maps.google.*/', 'maps.app.goo.gl/', 'goo.gl/maps/'],
    short: ['maps.app.goo.gl/', 'goo.gl/maps/'],
    lists: ['google.*/maps/placelists/'],
  },
  { id: 'gps', name: 'GPS file', color: '#a3762b', sources: ['gpx'] },
  { id: 'files', name: 'Map file', color: '#7a4b8f', sources: ['kml', 'geojson'] },
  { id: 'search', name: 'Place search', color: '#b8543f', sources: ['manual'] },
];

/** The colour of pins from a source the table doesn't know. */
export const UNKNOWN_SOURCE_COLOR = '#8a8f98';

/** What the add-pin animation shows for a pin's `source`: its group's logo, or else its name as a caption. */
export function pinLook(pinSource) {
  const group = SOURCE_GROUPS.find((g) => g.sources.includes(pinSource));
  return group?.logo ? { logo: group.logo, caption: '' } : { logo: '', caption: group?.name || '' };
}

/** A pin's default colour: that of the group its `source` value belongs to. */
export function sourceColor(pinSource) {
  return SOURCE_GROUPS.find((g) => g.sources.includes(pinSource))?.color ?? UNKNOWN_SOURCE_COLOR;
}

/** What "*" in a prefix's host stands for: a country or com ending such as "com", "de", "co.uk", "com.au". */
const DOMAIN_ENDING = /^(?:com?\.)?[a-z]{2,3}$/;

/** Host (lowercase, without "www." or "m.") and path of an http(s) link, also without its scheme; null otherwise. */
function linkParts(link) {
  let s = String(link ?? '').trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  return { host: u.hostname.toLowerCase().replace(/^(www|m)\./, ''), path: u.pathname.toLowerCase() };
}

/**
 * The links in a text, in order: every http(s) link (also glued to a word
 * before it), and every word that starts with a registered prefix but lacks
 * the scheme ("instagram.com/p/…" becomes "https://instagram.com/p/…").
 * Trailing ")", "," and "." are dropped.
 */
export function findLinks(text) {
  const links = [];
  for (const word of String(text ?? '').split(/\s+/)) {
    const at = word.search(/https?:\/\//i);
    const token = (at === -1 ? word : word.slice(at)).replace(/[),.]+$/, '');
    if (!token) continue;
    if (at !== -1) links.push(token);
    else if (sourceOf(token)) links.push(`https://${token}`);
  }
  return links;
}

function prefixMatches(prefix, { host, path }) {
  const slash = prefix.indexOf('/');
  const wantHost = prefix.slice(0, slash);
  if (wantHost.endsWith('*')) {
    const stem = wantHost.slice(0, -1);
    if (!host.startsWith(stem) || !DOMAIN_ENDING.test(host.slice(stem.length))) return false;
  } else if (host !== wantHost) {
    return false;
  }
  return path.startsWith(prefix.slice(slash));
}

/** The longest prefix `link` starts with, and its source group; null when there is none. */
function matchPrefix(link) {
  const parts = linkParts(link);
  if (!parts) return null;
  let best = null;
  for (const group of SOURCE_GROUPS) {
    for (const prefix of group.prefixes || []) {
      if (prefixMatches(prefix, parts) && (!best || prefix.length > best.prefix.length)) best = { group, prefix };
    }
  }
  return best;
}

/** The source a link belongs to ("instagram", "apple", "google"), by its longest matching prefix; null for none. */
export function sourceOf(link) {
  return matchPrefix(link)?.group.id ?? null;
}

/** True when the longest prefix `link` starts with is one of its source's `kind` prefixes ("guides", "short", "lists"). */
export function linkIs(link, kind) {
  const m = matchPrefix(link);
  return Boolean(m?.group[kind]?.includes(m.prefix));
}

/** The host a link is on, without "www." ("https://www.pinterest.com/pin/1" → "pinterest.com"); '' for no link. */
export function siteOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * The supported links and files, grouped by where they go in.
 * @type {Array<{id: string, title: string, items: string[], note?: string}>}
 */
export const SUPPORTED_SOURCES = [
  {
    id: 'bar',
    title: 'One link at a time (input bar)',
    items: [
      'instagram.com/p/…', 'instagram.com/reel/…', 'maps.apple.com/… (places and guides)', 'guides.apple.com/…',
      'google.com/maps/…', 'maps.google.com/…', 'maps.app.goo.gl/…', 'goo.gl/maps/…',
    ],
    note: 'or type a place name to search',
  },
  {
    id: 'several',
    title: 'Several links at once (Settings → Import)',
    items: ['maps.apple.com/… place links', 'google.com/maps/…', 'maps.google.com/…', 'maps.app.goo.gl/…', 'goo.gl/maps/…'],
  },
  {
    id: 'files',
    title: 'Files (Settings → Import → Choose files)',
    items: [
      'Google Maps saved places and lists (files from the Google Takeout zip)',
      'Google My Maps and Google Earth maps',
      "GPS files (GPX) from Komoot, Strava, Garmin and other outdoor apps (their waypoints and a route's start point)",
      'Other map files (GeoJSON)',
      'oPin backups',
    ],
  },
];
