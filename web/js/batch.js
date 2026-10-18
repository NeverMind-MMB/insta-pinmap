/**
 * batch.js — several items in one paste: the Settings → Import box, which
 * takes every kind of item into one import list, and what the input bar hands
 * over to it (two or more items; the input bar takes one).
 *
 * An item is a link (each different link once), or a line without a link that
 * holds coordinates, a geo: link or a Plus Code. In the import list:
 *   map links and coordinates → their places (checked)
 *   Apple Guides → their places (Apple Maps places unchecked, for the Shortcut lookup)
 *   Google Maps lists → their places, read through the Worker
 *   posts → read one after another, one row each at its best place (postflow.js)
 *   links of no source this version reads → one notice with the GitHub link
 * The same post or the same place comes in once. Nothing is saved before
 * "Import selected".
 */

import { readLink, isAppleGuideLink, appleIdEntries, isGoogleShortLink } from './importers.js';
import { isGoogleList, googleListId, fetchGoogleList, googleListEntries } from './googlelist.js';
import { readCoords, placeShortCode } from './coords.js';
import { makeQueue } from './geocode.js';
import { findLinks, siteOf, sourceOf } from './sources.js';
import { resolveShortLink } from './api.js';
import { isInstagramLink, postKey } from './dedupe.js';
import { isPostSource, postRow } from './postflow.js';
import { isMapLink, appleIdOnly, guideOf } from './mapflow.js';
import { addShortcutOutput, reopenWaitingGuide } from './shortcut.js';

/**
 * The pace of the posts an import reads: each Worker route at most one request per `gapMs`
 * (under its 20 per minute and address); after a "too many requests" one more try once
 * `limitWaitMs` has passed. An object, so tests can make it quick.
 */
export const BATCH_PACE = { gapMs: 3500, limitWaitMs: 61000 };

/**
 * The items of a paste, in paste order: every different link, and every line without a link
 * whose coordinates, geo: link or Plus Code readCoords reads. Raw HTML has none.
 * @returns {Array<{link: string} | {coords: object, line: string}>}
 */
export function pasteItems(text) {
  const s = String(text ?? '');
  if (/<html/i.test(s)) return [];
  const items = [];
  const seen = new Set();
  for (const raw of s.split(/\r?\n/)) {
    const line = raw.trim();
    const links = findLinks(line);
    for (const link of links) {
      if (seen.has(link)) continue;
      seen.add(link);
      items.push({ link });
    }
    if (links.length || seen.has(`coords:${line}`)) continue;
    const coords = readCoords(line);
    if (coords && coords.kind !== 'error') {
      seen.add(`coords:${line}`);
      items.push({ coords, line });
    }
  }
  return items;
}

/**
 * The place links "Look up with iPhone Shortcut" copied, pasted again before the Shortcut has
 * run: back to the waiting guide, when they are its Apple IDs and nothing else.
 * @returns {boolean} true when the waiting guide opened
 */
export function reopenGuideFor(items, env) {
  const ids = items.map((item) => (item.link ? appleIdOnly(item.link) : ''));
  return ids.length > 0 && ids.every(Boolean) && reopenWaitingGuide([...new Set(ids)], env);
}

/** The batch being read, `{cancelled}`; null when none runs. One at a time. */
let running = null;

/** True while Settings → Import reads a paste. */
export function batchRunning() {
  return running !== null;
}

/** Stops the batch being read (Settings was closed): no further item is read, no import list opens. */
export function cancelBatch() {
  if (running) running.cancelled = true;
}

export const STILL_READING = 'An import is still being read. Wait for it, or close Settings to stop it.';

/**
 * Settings → Import → "Read": everything in the box into one import list (the Shortcut's
 * output goes to its guide, as in the input bar). Settings stays open while the posts are
 * read and closes as a dialog opens; the box empties once the import list has the text.
 * Where nothing could be read, a toast says so and the text stays. One batch at a time;
 * cancelBatch() stops it. An import list the user has open by the end is never replaced.
 * @param {{value: string}} field  the paste box
 * @param {object} env  also `importOpen()`: true while an import list is open
 */
export async function addFromSettings(field, env, closeSettings) {
  const text = field.value.trim();
  if (!text) return;
  if (running) {
    env.toast(STILL_READING, 'info', 6000);
    return;
  }
  const batch = { cancelled: false };
  running = batch;
  let closed = false;
  const close = () => {
    if (!closed) closeSettings();
    closed = true;
  };
  const opening = (show) => (...args) => {
    if (batch.cancelled) return;
    if (env.importOpen?.()) {
      env.toast('The import list is still open: finish it, then tap Read again.', 'info', 6000);
      batch.cancelled = true;
      return;
    }
    // Done reading: Settings closing now is no stop any more.
    if (running === batch) running = null;
    close();
    show?.(...args);
  };
  try {
    await importPaste(text, {
      ...env,
      batch,
      inputDone: () => { if (!batch.cancelled) field.value = ''; },
      showImport: opening(env.showImport),
      showUnsupported: opening(env.showUnsupported),
    });
  } finally {
    if (running === batch) running = null;
  }
}

/** A paste as one import list (see addFromSettings). */
async function importPaste(text, env) {
  if (addShortcutOutput(text, env)) return;
  const items = pasteItems(text);
  if (reopenGuideFor(items, env)) return;
  await importItems(items, env);
}

/** The pin rows of a coordinates line (a short Plus Code with a town finds the town first). */
async function coordsRow({ coords, line }) {
  const row = { name: '', address: '', lat: null, lon: null, url: '', source: 'coords', note: '', warning: '' };
  if (coords.kind === 'search') return { ...row, name: coords.query, warning: 'No coordinates; looked up by name on import.' };
  const point = coords.kind === 'short' ? await placeShortCode(coords) : coords;
  if (!point.ok && point.kind !== 'point') return { ...row, name: coords.code || line, warning: point.message, checked: false, unplaced: true };
  return { ...row, name: point.name, lat: point.lat, lon: point.lon };
}

/** The rows of a Google Maps list, read through the Worker; one row with the reason when it can't be read. */
async function listRows(link) {
  const failed = (warning) => ({
    rows: [{ name: 'Google Maps list', address: link, lat: null, lon: null, url: link, source: 'google-list', note: '', warning, checked: false, unplaced: true }],
  });
  if (!googleListId(link)) return failed('This Google Maps list link is incomplete. Copy the list link in Google Maps again (Share list).');
  const list = await fetchGoogleList(link);
  if (!list.ok) return failed(list.message);
  const rows = googleListEntries(list.places);
  if (!rows.length) return failed('This Google Maps list has no places.');
  const cut = Number.isInteger(list.total) && list.total > rows.length ? `Google sent ${rows.length} of the ${list.total} places in this list.` : '';
  return { rows, title: String(list.title || ''), cut };
}

/** The rows readLink gives a map link, or one row with the reason why it gives none. */
function linkRows(link) {
  try {
    const { entries } = readLink(link);
    if (entries.length) return entries.map((e) => ({ ...e }));
  } catch (e) {
    return [unreadRow(link, e.message)];
  }
  return [unreadRow(link, 'This link contains no place.')];
}

/** A row for a map link readLink can't read (it says why); never imported. */
function unreadRow(link, warning) {
  return { name: 'Map link', address: link, lat: null, lon: null, url: link, source: '', note: '', warning, checked: false, unplaced: true };
}

/** "sites" as words: "a.com", "a.com and b.com", "a.com, b.com and c.com". */
function joinSites(sites) {
  return sites.length < 2 ? sites.join('') : `${sites.slice(0, -1).join(', ')} and ${sites.at(-1)}`;
}

/** A Google short link (maps.app.goo.gl, goo.gl/maps): only the helper can say what it leads to. */
function isGoogleShort(link) {
  return sourceOf(link) === 'google' && isGoogleShortLink(link);
}

/**
 * The items as one import list. Posts, Google short links and lists go through the Worker one
 * after another, each route at BATCH_PACE, with a "Reading 2 of 5 …" toast; a short link that
 * turns out to be a list brings the list's places. OpenStreetMap objects and Mapy short links
 * wait for the import, as in a file import.
 */
async function importItems(given, env) {
  const rows = [];
  const appleIds = [];
  const unsupported = [];
  const guides = [];
  const lists = [];
  const notes = [];
  const pace = {
    ig: makeQueue(BATCH_PACE.gapMs), post: makeQueue(BATCH_PACE.gapMs),
    resolve: makeQueue(BATCH_PACE.gapMs), list: makeQueue(BATCH_PACE.gapMs),
  };
  // The same post in two link forms is one item, before anything is counted or read.
  const seenPosts = new Set();
  const items = given.filter((i) => {
    const key = i.link && isPostSource(i.link) ? postKey(i.link) : '';
    if (!key) return true;
    if (seenPosts.has(key)) return false;
    seenPosts.add(key);
    return true;
  });
  const slow = items.filter((i) => (i.link && (isPostSource(i.link) || isGoogleList(i.link) || isGoogleShort(i.link))) ||
    (i.coords?.kind === 'short' && i.coords.place)).length;
  let step = 0;
  const progress = () => env.toast(`Reading ${Math.min(step, slow)} of ${slow} …`, 'busy', 0);
  const waiting = () => env.toast(`The helper's limit: waiting a minute (${Math.min(step, slow)} of ${slow}) …`, 'busy', 0);

  const stopped = () => env.batch?.cancelled;
  for (const item of items) {
    if (stopped()) break;
    if (item.coords) {
      if (item.coords.kind === 'short' && item.coords.place) { step++; progress(); }
      rows.push(await coordsRow(item));
      continue;
    }
    let { link } = item;
    if (isPostSource(link)) {
      const key = postKey(link);
      step++;
      progress();
      const row = await readPost(link, pace, waiting, stopped);
      // A share link can turn out to be a post met before.
      const keyRead = row.post ? postKey(row.post.url) || row.post.url : '';
      if (keyRead && keyRead !== key && seenPosts.has(keyRead)) continue;
      if (keyRead) seenPosts.add(keyRead);
      rows.push(row);
      continue;
    }
    if (isGoogleShort(link)) {
      step++;
      progress();
      await pace.resolve(() => {});
      const j = await resolveShortLink(link);
      // Not expanded now: the row waits for the import, which tries again.
      if (!j.ok || !j.url || j.url === link || isGoogleShort(j.url)) {
        rows.push(...linkRows(link));
        continue;
      }
      if (!isGoogleList(j.url)) {
        let entries = [];
        try {
          entries = readLink(j.url).entries;
        } catch { /* a Google link readLink doesn't know: the short link's row instead */ }
        rows.push(...(entries.length ? entries.map((e) => ({ ...e })) : linkRows(link)));
        continue;
      }
      link = j.url;
      step--; // the list is the same item
    }
    if (isGoogleList(link)) {
      step++;
      progress();
      await pace.list(() => {});
      const list = await listRows(link);
      rows.push(...list.rows);
      if (list.title !== undefined) lists.push(list.title);
      if (list.cut) notes.push(list.cut);
      continue;
    }
    if (isAppleGuideLink(link)) {
      try {
        const parsed = readLink(link);
        rows.push(...parsed.entries.map((e) => ({ ...e })));
        appleIds.push(...(parsed.appleIds || []));
        guides.push(parsed);
      } catch (e) {
        rows.push(unreadRow(link, e.message));
      }
      continue;
    }
    if (isMapLink(link)) {
      let parsed = null;
      let error = '';
      try {
        parsed = readLink(link);
      } catch (e) {
        error = e.message;
      }
      // An Apple link that names its place by ID only: a row for the Shortcut lookup.
      const id = parsed?.entries.some((e) => Number.isFinite(e.lat)) ? '' : appleIdOnly(link);
      if (id) appleIds.push(id);
      else if (parsed?.entries.length) rows.push(...parsed.entries.map((e) => ({ ...e })));
      else rows.push(unreadRow(link, error || 'This link contains no place.'));
      continue;
    }
    // A link of no source this version reads (a link-like word without a site is no link).
    if (siteOf(link)) unsupported.push(link);
  }
  if (slow || stopped()) env.hideToast?.();
  if (stopped()) return;

  const ids = [...new Set(appleIds)];
  const unique = withoutRepeats(rows);
  const all = [...unique, ...appleIdEntries(ids, new Map())];
  if (!all.length) {
    if (unsupported.length) {
      const sites = [...new Set(unsupported.map(siteOf))];
      // Several sites: the issue list itself, not a sentence as a search.
      if (sites.length > 1) env.showUnsupported?.(unsupported[0], `Links from ${joinSites(sites)}`, '');
      else env.showUnsupported?.(unsupported[0]);
    } else {
      env.toast('No place, post, guide or list found in this text.', 'error', 6000);
    }
    return;
  }
  // The tag field starts with a name only when the whole import is one guide or one list.
  const one = items.length === 1;
  const sourceName = one && guides.length === 1 ? guides[0].name : one && lists.length === 1 ? lists[0] : '';
  const guide = !ids.length ? null
    : one && guides.length === 1 ? guideOf(guides[0])
      : { title: '', link: '', entries: unique, appleIds: ids };
  env.showImport?.(all, sourceName, guide, unsupported.length ? { unsupported } : undefined);
  env.inputDone?.();
  if (notes.length) env.toast(notes.join(' '), 'info', 8000);
}

/** One post as a row at BATCH_PACE; after "too many requests", once more a minute later (unless stopped). */
async function readPost(link, pace, waiting, stopped) {
  const route = isInstagramLink(link) ? 'ig' : 'post';
  for (let attempt = 0; ; attempt++) {
    await pace[route](() => {});
    const { row, rateLimited } = await postRow(link);
    if (!rateLimited || attempt) return row;
    waiting();
    await new Promise((resolve) => setTimeout(resolve, BATCH_PACE.limitWaitMs));
    if (stopped()) return row;
  }
}

/**
 * The rows with each place once: a row without a post at the spot of an earlier one (five
 * decimals) is left out, and so is a link row met before. Rows with a post stay: the import
 * attaches the post to the pin at that spot.
 */
function withoutRepeats(rows) {
  const spots = new Set();
  const links = new Set();
  return rows.filter((row) => {
    if (row.post) return true;
    if (Number.isFinite(row.lat) && Number.isFinite(row.lon)) {
      const spot = `${row.lat.toFixed(5)},${row.lon.toFixed(5)}`;
      if (spots.has(spot)) return false;
      spots.add(spot);
      return true;
    }
    if (!row.url) return true;
    if (links.has(row.url)) return false;
    links.add(row.url);
    return true;
  });
}

/** How many items a paste has (see pasteItems): two or more go to Settings → Import. */
export function itemCount(text) {
  return pasteItems(text).length;
}
