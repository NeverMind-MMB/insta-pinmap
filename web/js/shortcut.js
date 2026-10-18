/**
 * shortcut.js — what the iPhone Shortcut "Fetch Apple Guide" hands back,
 * pasted into the input bar (or Settings → Import): a guide link with the
 * results below it (Safari), "@@" lines, place pages for a waiting guide (the
 * Maps app); and the place links the app copied for the Shortcut, pasted again
 * before it has run ("The Shortcut isn't done yet"). A whole guide page, what
 * Shortcuts before 2.0.8 copied, is read only by "Paste results" in the import
 * dialog now.
 * What the results look like is read in appleplace.js.
 */

import { readLink, isAppleGuideLink } from './importers.js';
import {
  guidePlaceRow, applyPasteToGuide, loadPendingGuide, parseShortcutPages, missingAppleIds, parseShortcutResults,
} from './appleplace.js';
import { findLinks } from './sources.js';
import { guideImportEntries, guideOf, appleIdOnly } from './mapflow.js';

/** {link, rest} when the first line is an Apple guide link and the rest the Shortcut's results; else null. */
function guideWithResults(text) {
  const [first, ...more] = String(text ?? '').trim().split(/\r?\n/);
  const rest = more.join('\n');
  return isAppleGuideLink(first.trim()) && (/<html/i.test(rest) || rest.includes('@@')) ? { link: first.trim(), rest } : null;
}

/**
 * A guide link on the first line and below it only that guide's own Apple place links (what the
 * Maps route copies when it got no pages): the guide's way, not an import of several links.
 */
export function isGuideWithOwnPlaces(text) {
  const [first, ...rest] = String(text ?? '').trim().split(/\r?\n/);
  if (!isAppleGuideLink(first.trim())) return false;
  let ids;
  try {
    ids = readLink(first.trim()).appleIds || [];
  } catch {
    return false;
  }
  return findLinks(rest.join('\n')).every((link) => ids.includes(appleIdOnly(link)));
}

/** True for the Shortcut's output: place pages (any raw HTML), "@@" lines, or a guide link with results below it. */
export function isShortcutOutput(text) {
  const s = String(text ?? '').trim();
  return /<html/i.test(s) || guideWithResults(s) !== null ||
    (s.includes('@@') && parseShortcutResults(s).size > 0);
}

/**
 * The Shortcut's output, the way "Paste results" in the import dialog takes it.
 * @returns {boolean} false when `text` is none of it (it goes on as any other paste)
 */
export function addShortcutOutput(text, env) {
  // A guide link with the Shortcut's results below it.
  if (addGuideWithResults(text, env)) return true;
  // Only the Shortcut's "@@" lines: those places as checked rows.
  if (text.includes('@@') && addFromResultLines(text, env)) return true;
  // The Shortcut's place pages, likewise, for a waiting guide.
  return /<html/i.test(text) && addFromPlacePages(text, env);
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
