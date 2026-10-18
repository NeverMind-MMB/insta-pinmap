/**
 * router.js — where a paste goes. One if-chain, in this order:
 *
 *   the Shortcut's output (shortcut.js) → two or more items: Settings → Import
 *   (batch.js) → the link in the text → its source by prefix (sources.js) picks
 *   the reader: posts (postflow.js), map links (mapflow.js) → coordinates, geo:
 *   links and Plus Codes (mapflow.js) → a link of no source this version reads
 *   (the unsupported dialog) → anything else is a place search (confirm.js)
 */

import { readCoords } from './coords.js';
import { siteOf, findLinks } from './sources.js';
import { isPostSource, addFromPost } from './postflow.js';
import { isMapLink, addFromMapLink, addFromCoords } from './mapflow.js';
import { isShortcutOutput, addShortcutOutput, isGuideWithOwnPlaces } from './shortcut.js';
import { pasteItems, itemCount, reopenGuideFor } from './batch.js';
import { openConfirm } from './confirm.js';

/**
 * The input bar takes one item: a post link, a map link, coordinates or free search text.
 * @param {string} input
 * @param {object} env  { toast, map, redraw, importPaste, … }; importPaste(text) opens
 *   Settings → Import with `text` in its box and runs it
 */
export async function startAdd(input, env) {
  const text = String(input || '').trim();
  if (!text) return;

  // The Shortcut's results: a guide link with results, "@@" lines, place pages.
  if (addShortcutOutput(text, env)) return;
  const items = pasteItems(text);
  // The place links the app copied for the Shortcut, pasted before it has run.
  if (reopenGuideFor(items, env)) return;
  // Two or more items (links of any kind, coordinates): one import list in Settings → Import.
  // Not awaited: the batch is Settings' now, and the input bar is free again at once.
  if (items.length >= 2 && !isGuideWithOwnPlaces(text)) {
    env.inputDone?.();
    env.importPaste?.(text);
    return;
  }

  // Fish the link out of shared text: Android often sends
  // "Check this out: https://... " instead of just the URL, and a link may
  // lack its scheme ("see instagram.com/p/…"). Raw HTML keeps its first link.
  const linkInText = findLinks(text)[0] || '';
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
 * True for the Shortcut's output (place pages, "@@" lines, or a guide link
 * with results below it) and for two or more items (which startAdd sends to
 * Settings → Import): it goes straight to startAdd, since a text field would
 * drop its line breaks.
 */
export function isShortcutPaste(text) {
  return isShortcutOutput(text) || itemCount(text) >= 2;
}
