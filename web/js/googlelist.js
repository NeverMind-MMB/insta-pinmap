/**
 * googlelist.js — a Google Maps list ("Share list" in Google Maps), imported whole.
 *
 * A list link is google.com/maps/placelists/list/<id> (or a country domain), or the
 * maps.app.goo.gl short link Share gives, which /api/resolve turns into
 * google.com/maps/@/data=…!11m2!2s<id>!3e3.
 * Google answers a list only to its own servers' callers (no CORS), so the
 * Worker's /api/list reads it (worker/googlelist.js); every place of it becomes
 * a checked row of the import dialog, whose tag field starts with the list's name.
 * Only lists shared with "Anyone with the link" can be read.
 */

import { sourceOf, linkIs } from './sources.js';
import { UNNAMED_GOOGLE_PLACE } from './importers.js';

/** The list ID in a list link or its resolved address. */
const LIST_ID = /(?:\/placelists\/list\/|!11m\d+!2s)([\w-]{16,64})(?![\w-])/;

/** The ID of the Google Maps list a Google link names; '' for any other link (a short link: resolve it first). */
export function googleListId(link) {
  if (sourceOf(link) !== 'google') return '';
  return String(link).match(LIST_ID)?.[1] || '';
}

/** True for a Google Maps list link: a placelists link (by its prefix, sources.js), or an address that names a list. */
export function isGoogleList(link) {
  return linkIs(link, 'lists') || googleListId(link) !== '';
}

/** Says a Google Maps list goes in on its own (the batch toast in addflow.js, the import's summary in ui.js). */
export const LISTS_ALONE = 'Google Maps lists go in on their own: paste one list link at a time.';

/**
 * Import rows for the places /api/list sent: all checked, source "google-list".
 * A place without a name takes the first part of its address; one without
 * coordinates is looked up by name on import, like a Takeout row.
 */
export function googleListEntries(places) {
  return (places || []).map((p) => {
    const located = Number.isFinite(p.lat) && Number.isFinite(p.lon);
    const address = String(p.address || '');
    return {
      name: String(p.name || '') || address.split(',')[0].trim() || UNNAMED_GOOGLE_PLACE,
      address,
      lat: located ? p.lat : null,
      lon: located ? p.lon : null,
      url: String(p.url || ''),
      source: 'google-list',
      note: String(p.note || ''),
      warning: located ? '' : 'No coordinates in the list; looked up by name on import.',
    };
  });
}

const LIST_FAILED = "Couldn't read this Google Maps list. Try again later, or import the list's file from Google Takeout in Settings → Import.";

/**
 * Asks the Worker for a list: {ok: true, title, total, places} or {ok: false, message}.
 * The Worker's own messages are shown as they are; anything else (an old Worker,
 * junk) gets one plain message.
 */
export async function fetchGoogleList(link) {
  let res;
  try {
    res = await fetch(`/api/list?link=${encodeURIComponent(link)}`);
  } catch {
    return { ok: false, message: 'No internet. Try again later.' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch { /* not JSON */ }
  if (res.ok && body?.ok && Array.isArray(body.places)) return body;
  return { ok: false, message: body?.ok === false && body.reason && body.message ? String(body.message) : LIST_FAILED };
}

/**
 * The input bar's (and Settings') way for a list link: reads the list, then one
 * import dialog with all its places, titled with the list's name. When it
 * can't be read, an error toast says why and the link stays in the input bar.
 * @param {object} env  { toast, hideToast, showImport, inputDone }
 */
export async function addFromGoogleList(link, env) {
  if (!googleListId(link)) {
    env.toast("This Google Maps list link is incomplete. Copy the list link in Google Maps again (Share list).", 'error', 8000);
    return;
  }
  env.toast('Reading the list …', 'busy', 15000);
  let list;
  try {
    list = await fetchGoogleList(link);
  } finally {
    env.hideToast?.();
  }
  if (!list.ok) {
    env.toast(list.message, 'error', 8000);
    return;
  }
  const entries = googleListEntries(list.places);
  if (!entries.length) {
    env.toast('This Google Maps list has no places.', 'info');
    return;
  }
  env.showImport?.(entries, String(list.title || ''), null);
  env.inputDone?.();
  // The Worker asks Google for up to 1,000 places; a longer list comes back cut.
  if (Number.isInteger(list.total) && list.total > entries.length) {
    env.toast(`Google sent ${entries.length} of the ${list.total} places in this list.`, 'info', 8000);
  }
}
