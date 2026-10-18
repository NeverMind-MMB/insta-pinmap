/**
 * mapflow.js — map links and coordinates: Apple Maps (places and guides),
 * Google Maps (places, short links, lists) and other map apps, by their prefix
 * (sources.js); coordinates, geo: links and Plus Codes (coords.js).
 *
 * A link with its own point opens Confirm place with that point; a name only is
 * searched; a guide or a list brings several places at once, so it goes
 * through the import dialog.
 */

import { readLink, appleIdEntries, isGoogleShortLink, UNNAMED_GOOGLE_PLACE } from './importers.js';
import { isGoogleList, addFromGoogleList } from './googlelist.js';
import { placeShortCode } from './coords.js';
import { resolveShortLink } from './api.js';
import { sourceOf } from './sources.js';
import { withShareText, needsMapAppLookup, lookUpMapAppEntry } from './maplinks.js';
import { openConfirm } from './confirm.js';

/** A map link: from Apple Maps (places and guides), Google Maps or another map app, by its prefix (sources.js). */
export function isMapLink(link) {
  const source = sourceOf(link);
  return source === 'apple' || source === 'google' || source === 'maps';
}

/**
 * The Apple place ID of an Apple Maps link that names its place by ID only:
 * auid=<id>, or place-id=I<hex> (Apple's Place ID is the ID in hexadecimal).
 * '' for anything else.
 */
export function appleIdOnly(link) {
  if (sourceOf(link) !== 'apple') return '';
  let u;
  try {
    u = new URL(link);
  } catch {
    return '';
  }
  const auid = u.searchParams.get('auid') || '';
  if (/^\d{1,20}$/.test(auid)) return auid;
  const hex = /^I([0-9A-Fa-f]{1,16})$/.exec(u.searchParams.get('place-id') || '');
  return hex ? BigInt(`0x${hex[1]}`).toString() : '';
}

/**
 * Import list of a guide: its inline entries plus one row per Apple Maps place
 * it names only by ID, filled for the places a pending guide already found,
 * unchecked for the rest. The import dialog looks those up through the iPhone
 * Shortcut; the computer script makes a file instead (see appleplace.js).
 * @param {{entries: Array, appleIds?: string[], found?: Map}} guide  readLink's answer or a pending guide
 */
export function guideImportEntries(guide) {
  const entries = guide.entries.map((e) => ({ ...e }));
  return [...entries, ...appleIdEntries(guide.appleIds || [], guide.found || new Map())];
}

/** What the import dialog needs to look up a guide's Apple Maps places; null without any. */
export function guideOf(parsed) {
  return parsed.appleIds?.length
    ? { title: parsed.name, link: parsed.link || '', entries: parsed.entries, appleIds: parsed.appleIds }
    : null;
}

/**
 * `resolved`: the link is already the answer of /api/resolve. `shareText`: the pasted
 * text around the link (a map app's share text may name the place, see maplinks.js).
 */
export async function addFromMapLink(link, env, resolved = false, shareText = '') {
  // A Google Maps list (also what a list's short link resolves to): all its places in one import.
  if (isGoogleList(link)) return addFromGoogleList(link, env);
  let parsed;
  try {
    parsed = readLink(link);
  } catch (e) {
    env.toast(e.message, 'error');
    return;
  }

  // An Apple Guide brings several places at once, so it goes through the import.
  // With Apple place IDs it always does: the dialog looks them up.
  if (parsed.entries.length > 1 || parsed.appleIds?.length) {
    env.showImport?.(guideImportEntries(parsed), parsed.name, guideOf(parsed));
    env.inputDone?.();
    return;
  }

  let e0 = parsed.entries[0];
  if (!e0) {
    env.toast('This link contains no place.', 'error');
    return;
  }
  if (shareText) e0 = withShareText(e0, shareText);

  // Another map app's link that needs a request first: an OpenStreetMap object, a Mapy short link.
  if (!Number.isFinite(e0.lat) && needsMapAppLookup(e0)) {
    const done = await lookUpMapAppEntry(e0, { resolve: resolveShortLink, busy: (text) => env.toast(text, 'busy', 8000) });
    env.hideToast?.();
    if (!done.ok) {
      env.toast(done.message, 'error', 6000);
      return;
    }
    e0 = done.entry;
  }

  // Short link? Resolve it first.
  // Resolved at most once: an answer that is again a short link is not sent back.
  if (!resolved && !Number.isFinite(e0.lat) && isGoogleShortLink(e0.url || link)) {
    const sent = e0.url || link;
    env.toast('Resolving the short link …', 'busy', 8000);
    const j = await resolveShortLink(sent);
    env.hideToast?.();
    if (j.ok && j.url && j.url !== sent) return addFromMapLink(j.url, env, true);
    env.toast(j.message || "Couldn't resolve this short link.", 'error', 6000);
    return;
  }

  return openConfirm({
    source: e0.source,
    titleSuggestion: e0.name,
    readyPlace: Number.isFinite(e0.lat)
      ? { lat: e0.lat, lon: e0.lon, name: e0.name, address: e0.address, source: e0.source }
      : null,
    // No search for a name the link doesn't have ("Google place"): the dialog asks for one.
    candidates: Number.isFinite(e0.lat) || e0.name === UNNAMED_GOOGLE_PLACE ? [] : [{ text: e0.name, points: 70, source: 'link' }],
    countries: [],
    note: e0.note || '',
    env,
  });
}

/** readCoords' answer: Confirm place with the exact point (a short Plus Code finds its town first). */
export async function addFromCoords(found, env) {
  if (found.kind === 'error') {
    env.toast(found.message, 'error', 6000);
    return;
  }
  // geo:0,0?q=Name names its place only: search for the name.
  if (found.kind === 'search') {
    return openConfirm({
      source: 'manual', titleSuggestion: found.query, candidates: [{ text: found.query, points: 60, source: 'input' }], countries: [], env,
    });
  }
  let point = found;
  if (found.kind === 'short') {
    if (found.place) env.toast('Finding the Plus Code\'s town …', 'busy', 8000);
    try {
      point = await placeShortCode(found);
    } finally {
      if (found.place) env.hideToast?.();
    }
    if (!point.ok) {
      env.toast(point.message, 'error', 8000);
      return;
    }
  }
  return openConfirm({
    source: 'coords',
    titleSuggestion: point.name,
    readyPlace: { lat: point.lat, lon: point.lon, name: point.name, address: '', source: 'coords' },
    readyStatus: point.status,
    candidates: [],
    countries: [],
    env,
  });
}
