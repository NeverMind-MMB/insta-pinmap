/**
 * sources.js — what the app reads, in one place: the "Supported links and
 * files" list of the unsupported-link dialog, and where to ask for more.
 * A new source is one more entry here (test/sources.test.mjs checks each entry
 * against the code that reads it).
 */

/** The project's GitHub issues: where people ask for a site the app doesn't read yet. */
export const ISSUES_URL = 'https://github.com/NeverMind-MMB/insta-pinmap/issues';

/** GitHub's issue search for `site`, e.g. "pinterest.com". */
export function issuesSearchUrl(site) {
  return `${ISSUES_URL}?q=${encodeURIComponent(`is:issue ${site}`)}`;
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
      'Google Maps saved places (Google Takeout)',
      'Google Maps lists (Google Takeout)',
      'Google My Maps and Google Earth maps',
      "GPS files from Komoot, Strava, Garmin and other outdoor apps (their waypoints and a route's start point)",
      'Other map files (GeoJSON)',
      'oPin backups',
    ],
  },
];
