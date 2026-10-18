/**
 * shortcut.js — what the iPhone Shortcut "Fetch Apple Guide" hands back,
 * pasted into the input bar (or Settings → Import): a guide link with the
 * results below it, "@@" lines, place pages for a waiting guide, a whole guide
 * page; and the place links the app copied for the Shortcut, pasted again
 * before it has run ("The Shortcut isn't done yet").
 * What the results look like is read in appleplace.js.
 */

import { readLink, isAppleGuideLink } from './importers.js';
import {
  looksLikeGuidePage, parseGuidePage, guidePageTitle, guidePlaceRow, applyPasteToGuide,
  loadPendingGuide, parseShortcutPages, missingAppleIds, parseShortcutResults,
} from './appleplace.js';
import { guideImportEntries, guideOf } from './mapflow.js';

/** {link, rest} when the first line is an Apple guide link and the rest the Shortcut's results; else null. */
function guideWithResults(text) {
  const [first, ...more] = String(text ?? '').trim().split(/\r?\n/);
  const rest = more.join('\n');
  return isAppleGuideLink(first.trim()) && (/<html/i.test(rest) || rest.includes('@@')) ? { link: first.trim(), rest } : null;
}

/** True for the Shortcut's output: a guide page, place pages, "@@" lines, or a guide link with results below it. */
export function isShortcutOutput(text) {
  const s = String(text ?? '').trim();
  return looksLikeGuidePage(s) || /<html/i.test(s) || guideWithResults(s) !== null ||
    (s.includes('@@') && parseShortcutResults(s).size > 0);
}

/**
 * The Shortcut's output, the way "Paste results" in the import dialog takes it.
 * @returns {boolean} false when `text` is none of it (it goes on as any other paste)
 */
export function addShortcutOutput(text, env) {
  // A guide link with the Shortcut's results below it.
  if (addGuideWithResults(text, env)) return true;
  // The whole guide page (what the Shortcut copies) pasted into the input bar.
  if (looksLikeGuidePage(text)) {
    addFromGuidePage(text, env);
    return true;
  }
  // Only the Shortcut's "@@" lines: those places as checked rows.
  if (text.includes('@@') && addFromResultLines(text, env)) return true;
  // The Shortcut's place pages, likewise, for a waiting guide.
  return /<html/i.test(text) && addFromPlacePages(text, env);
}

/**
 * The Shortcut's answer pasted into the main input bar instead of the import
 * dialog: goes the same way as "Paste results" (a waiting guide gets its Apple
 * places filled), else every place of the page becomes a checked row.
 */
function addFromGuidePage(html, env) {
  const places = parseGuidePage(html);
  if (!places.length) {
    env.toast('This Apple Guide page lists no places. Copy the guide link in the app again and rerun the Shortcut.', 'error', 8000);
    return;
  }
  const pending = loadPendingGuide();
  if (pending) {
    const entries = guideImportEntries(pending);
    const { found, added } = applyPasteToGuide(entries, pending.appleIds, html);
    // Nothing in common: the page belongs to another guide.
    if (found || added) {
      env.showImport?.(entries, pending.title || guidePageTitle(html) || 'Apple Guide', pending);
      env.inputDone?.();
      return;
    }
  }
  env.showImport?.(places.map(guidePlaceRow), guidePageTitle(html) || 'Apple Guide', null);
  env.inputDone?.();
}

/**
 * The Shortcut's place pages pasted into the main input bar: with a waiting guide
 * whose Apple IDs they name, the import dialog opens with them filled in.
 * @returns {boolean} false when there is no such guide (the text goes on as before)
 */
function addFromPlacePages(html, env) {
  const pending = loadPendingGuide();
  if (!pending) return false;
  const entries = guideImportEntries(pending);
  if (!parseShortcutPages(html, missingAppleIds(pending.appleIds, entries)).size) return false;
  applyPasteToGuide(entries, pending.appleIds, html);
  env.showImport?.(entries, pending.title || 'Apple Guide', pending);
  env.inputDone?.();
  return true;
}

/**
 * A paste whose first line is an Apple guide link and the rest the Shortcut's
 * results (place pages and/or "@@" lines): the import dialog for that guide with
 * the results applied, as "Paste results" there would.
 * @returns {boolean} false when it is no such paste (a guide link alone goes on as before)
 */
function addGuideWithResults(text, env) {
  const paste = guideWithResults(text);
  if (!paste) return false;
  const { link, rest } = paste;
  let parsed;
  try {
    parsed = readLink(link);
  } catch (e) {
    env.toast(e.message, 'error');
    return true;
  }
  const entries = guideImportEntries(parsed);
  applyPasteToGuide(entries, parsed.appleIds || [], rest);
  env.showImport?.(entries, parsed.name, guideOf(parsed));
  env.inputDone?.();
  return true;
}

/** Only "@@" lines (no guide link): their places as checked import rows. */
function addFromResultLines(text, env) {
  const found = parseShortcutResults(text);
  if (!found.size) return false;
  env.showImport?.([...found].map(([id, p]) => guidePlaceRow({ id, ...p })), 'Apple Maps places', null);
  env.inputDone?.();
  return true;
}

/**
 * The place links "Look up with iPhone Shortcut" copied, pasted before the
 * Shortcut is done (iOS may have reloaded the app): back to the waiting guide,
 * when `appleIds` (the paste's Apple IDs, and nothing else in it) are all its own.
 * @returns {boolean} false when no guide waits for exactly these
 */
export function reopenWaitingGuide(appleIds, env) {
  const pending = appleIds.length ? loadPendingGuide() : null;
  if (!pending || !appleIds.every((id) => pending.appleIds.includes(id))) return false;
  env.showImport?.(guideImportEntries(pending), pending.title || 'Apple Guide', pending);
  env.toast("The Shortcut isn't done yet — paste again when it is.", 'info', 6000);
  env.inputDone?.();
  return true;
}
