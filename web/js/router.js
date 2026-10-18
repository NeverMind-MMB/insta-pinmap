/**
 * router.js — where a paste goes. One if-chain, in this order:
 *
 *   the Shortcut's output (shortcut.js) → several links (batch.js) → find the
 *   link in the text → its source by prefix (sources.js) picks the reader:
 *   posts (postflow.js), map links (mapflow.js) → coordinates, geo: links and
 *   Plus Codes (mapflow.js) → a link of no source this version reads (the
 *   unsupported dialog) → anything else is a place search (confirm.js)
 */

import { readCoords } from './coords.js';
import { siteOf, findLinks } from './sources.js';
import { isPostSource, addFromPost } from './postflow.js';
import { isMapLink, addFromMapLink, addFromCoords } from './mapflow.js';
import { isShortcutOutput, addShortcutOutput } from './shortcut.js';
import { givesPlaceOrPost, readableLinks, addFromPlaceLinks } from './batch.js';
import { openConfirm } from './confirm.js';

/**
 * @param {string} input   a post link, a map link, coordinates or free search text
 * @param {object} env  { toast, map, redraw }
 * @param {{severalLinks?: boolean}} [options]  severalLinks: from Settings → Import, where
 *   several place links open one import dialog (the input bar takes one link at a time)
 */
export async function startAdd(input, env, { severalLinks = false } = {}) {
  const text = String(input || '').trim();
  if (!text) return;

  // The Shortcut's results: a guide link with results, a guide page, "@@" lines, place pages.
  if (addShortcutOutput(text, env)) return;
  // Two or more map place links, one per line: one import dialog for all of them
  // from Settings, a hint there from the input bar.
  if (!/<html/i.test(text) && addFromPlaceLinks(text, env, severalLinks)) return;

  // Fish the link out of shared text: Android often sends
  // "Check this out: https://... " instead of just the URL, and a link may
  // lack its scheme ("see instagram.com/p/…").
  // The first link that gives a place or a post: a map app's download link in its share
  // text, or a link to another site, comes after it (raw HTML keeps its first link).
  const linksInText = findLinks(text);
  const linkInText = (!/<html/i.test(text) && linksInText.find(givesPlaceOrPost)) || linksInText[0] || '';
  // The text itself counts as a link only with a scheme ("geo:…") or a "/": a site's
  // name alone ("tiktok.com") is free text, as in findLinks.
  const candidateLink = linkInText || (/^[a-z][a-z0-9+.-]*:|\//i.test(text) ? text : '');

  // The link's source, by its prefix (sources.js), picks the reader.
  if (isPostSource(candidateLink)) return addFromPost(candidateLink, env);
  if (isMapLink(candidateLink)) return addFromMapLink(candidateLink, env, false, linkInText ? text : '');

  // Coordinates, a geo: link or a Plus Code (coords.js; also next to a link this version
  // doesn't read): the exact point instead of a place search.
  const coords = readCoords(text);
  if (coords) return addFromCoords(coords, env);

  // A link from no source this version reads: say so instead of searching for its address.
  if (linkInText && siteOf(candidateLink)) {
    env.showUnsupported?.(candidateLink);
    return;
  }

  // Free text: treat it as a place search
  return openConfirm({
    source: 'manual',
    titleSuggestion: text,
    candidates: [{ text, points: 60, source: 'input' }],
    countries: [],
    env,
  });
}

/**
 * True for the Shortcut's output (a guide page, place pages, "@@" lines, or a
 * guide link with results below it) and for two or more different links (which
 * startAdd sends to Settings → Import): it goes straight to startAdd, since a
 * text field would drop its line breaks.
 */
export function isShortcutPaste(text) {
  return isShortcutOutput(text) || readableLinks(String(text ?? '').trim()) >= 2;
}
