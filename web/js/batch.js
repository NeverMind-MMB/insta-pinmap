/**
 * batch.js — several items in one paste: the Settings → Import box, and what
 * the input bar does with two or more links.
 */

import { readLink, isAppleGuideLink } from './importers.js';
import { isGoogleList, LISTS_ALONE } from './googlelist.js';
import { findLinks } from './sources.js';
import { isPostSource, isReadablePost } from './postflow.js';
import { appleIdOnly, guideImportEntries } from './mapflow.js';
import { reopenWaitingGuide } from './shortcut.js';
import { startAdd } from './router.js';

/**
 * Settings → Import → "Read": the pasted text goes the input bar's way, and
 * several place links open one import dialog. Settings closes first, so the
 * dialog startAdd opens is on top; like the input bar, the field empties once
 * a dialog has the text.
 * @param {{value: string}} field  the paste box
 */
export async function addFromSettings(field, env, closeSettings) {
  const text = field.value.trim();
  if (!text) return;
  closeSettings();
  await startAdd(text, { ...env, inputDone: () => { field.value = ''; } }, { severalLinks: true });
}

/** A link that gives a place (also by Apple ID), a guide, a Google list or a post or video. */
export function givesPlaceOrPost(link) {
  if (isReadablePost(link) || isAppleGuideLink(link) || isGoogleList(link) || appleIdOnly(link)) return true;
  try {
    return readLink(link).entries.length > 0;
  } catch {
    return false;
  }
}

/** How many different links in a paste give a place, a guide, a list or a post (see placeLinks). */
export function readableLinks(text) {
  return placeLinks(text).readable;
}

/**
 * The map place links in a paste (text around them is ignored), each link
 * once: their places as import rows, and the Apple IDs of Apple links without
 * coordinates that name their place by ID (each ID once). Guide links stay out:
 * a guide goes its own way, with its title.
 * @returns {{entries: Array, appleIds: string[], links: number, skipped: number, distinct: number,
 *   readable: number, social: number, posts: number}}
 *   links: how many brought a place; skipped: how many other links (guides, links it can't read);
 *   distinct: how many different links the paste has; readable: how many of them give a place, a
 *   guide, a list or a post (not, say, a map app's download link); social: how many are Instagram,
 *   TikTok, YouTube or Facebook links; posts: how many of those are posts or videos the app reads
 */
function placeLinks(text) {
  const entries = [];
  const appleIds = [];
  const seen = new Set();
  let links = 0;
  let skipped = 0;
  let readable = 0;
  let social = 0;
  let posts = 0;
  let lists = 0;
  for (const link of findLinks(text)) {
    if (seen.has(link)) continue;
    seen.add(link);
    if (isPostSource(link)) social++;
    const post = isReadablePost(link);
    if (post) posts++;
    // A Google Maps list (also its resolved address, which readLink would take for a
    // place without coordinates) goes in on its own, never as a row of a batch.
    if (isGoogleList(link)) {
      readable++;
      skipped++;
      lists++;
      continue;
    }
    let parsed = null;
    try {
      parsed = isAppleGuideLink(link) ? null : readLink(link);
    } catch { /* no link readLink knows; perhaps an Apple link with only an ID */ }
    const id = parsed?.entries.some((e) => Number.isFinite(e.lat)) ? '' : appleIdOnly(link);
    if (givesPlaceOrPost(link)) readable++;
    if (id) {
      if (appleIds.includes(id)) continue;
      appleIds.push(id);
    } else if (parsed?.entries.length) {
      entries.push(...parsed.entries);
    } else {
      skipped++;
      continue;
    }
    links++;
  }
  return { entries, appleIds, links, skipped, distinct: seen.size, readable, social, posts, lists };
}

/**
 * The toast for the links a list of place links left out (`lists` of them Google Maps
 * lists, named apart); posts and videos go in the input bar.
 */
function skippedNotice(skipped, social, lists = 0) {
  const other = skipped - lists;
  const parts = [];
  if (other) parts.push(`${other} ${other === 1 ? "link that isn't a place link" : "links that aren't place links"} this app can read`);
  if (lists) parts.push(`${lists} Google Maps ${lists === 1 ? 'list' : 'lists'}`);
  let notice = `Skipped ${parts.join(' and ')}.`;
  if (lists) notice += ` ${LISTS_ALONE}`;
  return social ? `${notice} Posts and videos go in the input bar, one at a time.` : notice;
}

/**
 * Two or more map place links in one paste, from Settings → Import
 * (`severalLinks`): one import dialog, one row per place. Rows with coordinates
 * are checked; Apple places named only by ID get the dialog's Shortcut lookup,
 * as a guide's do. A post or video (Instagram, TikTok, YouTube, Facebook) among
 * several links never takes over: it is counted as left out, even next to just
 * one place link or none. The input bar takes one link at a time: with two or
 * more links that give a place or a post it imports nothing and says where to go
 * instead (a link that gives neither, such as a map app's download link in its
 * share text, doesn't count).
 * @returns {boolean} false for fewer than two (one link goes on as before)
 */
export function addFromPlaceLinks(text, env, severalLinks) {
  const { entries, appleIds, links, skipped, distinct, readable, social, posts, lists } = placeLinks(text);
  // The place links "Look up with iPhone Shortcut" copied, pasted before the
  // Shortcut is done (iOS may have reloaded the app): back to the waiting guide.
  if (!entries.length && !skipped && reopenWaitingGuide(appleIds, env)) return true;
  if (!severalLinks) {
    // The input bar: any two different links that give a place or a post. A guide link on
    // the first line is the Shortcut's output (or what is left of it): the guide's way.
    if (readable < 2 || isAppleGuideLink(text.split(/\r?\n/, 1)[0].trim())) return false;
    env.toast(posts
      ? 'One post or video at a time: paste each link on its own.'
      : 'Several map links? Paste them in Settings → Import (one per line), or import a file there.', 'info', 8000);
    return true;
  }
  if (links < 2 && !((social || lists) && distinct >= 2)) return false;
  if (links) {
    const guide = appleIds.length ? { title: '', link: '', entries, appleIds } : null;
    env.showImport?.(guide ? guideImportEntries(guide) : entries, '', guide);
  }
  if (skipped) env.toast(skippedNotice(skipped, social, lists), 'info', 6000);
  if (links) env.inputDone?.();
  return true;
}
