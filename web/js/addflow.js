/**
 * addflow.js — the path from link to pin.
 *
 * Flow:
 *   normalize link → already there? → fetch caption → extract candidates
 *   → place search → offer matches → YOU confirm → check proximity → save
 *
 * Confirmation is always required, even for a single unambiguous match.
 */

import { store, normTag } from './store.js';
import { PreviewMap } from './map.js';
import {
  shortcode, normalizeLink, embedLink, isInstagramLink,
  findPost, nearbyPins, markApart, distanceText,
} from './dedupe.js';
import { placeCandidates, scoreMatches, tagSuggestions, cleanedText, flagEmoji, eventDate } from './extract.js';
import {
  readLink, appleIdEntries, isAppleGuideLink, isGoogleShortLink, UNNAMED_GOOGLE_PLACE,
} from './importers.js';
import { isGoogleList, addFromGoogleList } from './googlelist.js';
import {
  looksLikeGuidePage, parseGuidePage, guidePageTitle, guidePlaceRow, applyPasteToGuide,
  loadPendingGuide, parseShortcutPages, missingAppleIds, parseShortcutResults,
} from './appleplace.js';
import { searchPlaces } from './geocode.js';
import { fetchPost, resolveShortLink } from './api.js';
import { siteOf, sourceOf, sourceColor, findLinks, pinLook } from './sources.js';
import { colorPicker, pickedColor } from './ui.js';

const $ = (id) => document.getElementById(id);

let preview = null;
let state = null;   // the operation in progress

/* ================================================================== *
 * Entry point
 * ================================================================== */

/**
 * @param {string} input   Instagram link, maps link or free search text
 * @param {object} env  { toast, map, redraw }
 * @param {{severalLinks?: boolean}} [options]  severalLinks: from Settings → Import, where
 *   several place links open one import dialog (the input bar takes one link at a time)
 */
export async function startAdd(input, env, { severalLinks = false } = {}) {
  const text = String(input || '').trim();
  if (!text) return;

  // A guide link with the Shortcut's results below it.
  if (addGuideWithResults(text, env)) return;
  // The whole guide page (what the Shortcut copies) pasted into the input bar.
  if (looksLikeGuidePage(text)) return addFromGuidePage(text, env);
  // Only the Shortcut's "@@" lines: those places as checked rows.
  if (text.includes('@@') && addFromResultLines(text, env)) return;
  // The Shortcut's place pages, likewise, for a waiting guide.
  if (/<html/i.test(text) && addFromPlacePages(text, env)) return;
  // Two or more map place links, one per line: one import dialog for all of them
  // from Settings, a hint there from the input bar.
  if (!/<html/i.test(text) && addFromPlaceLinks(text, env, severalLinks)) return;

  // Fish the link out of shared text: Android often sends
  // "Check this out: https://... " instead of just the URL, and a link may
  // lack its scheme ("see instagram.com/p/…").
  const linkInText = findLinks(text)[0] || '';
  const candidateLink = linkInText || text;

  // The link's source, by its prefix (sources.js), picks the reader.
  if (isInstagramLink(candidateLink)) {
    return addFromInstagram(candidateLink, env);
  }

  if (isMapLink(candidateLink)) {
    return addFromMapLink(candidateLink, env);
  }

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

/** A map link: from Apple Maps (places and guides) or Google Maps, by its prefix (sources.js). */
export function isMapLink(link) {
  const source = sourceOf(link);
  return source === 'apple' || source === 'google';
}

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

/* ================================================================== *
 * Instagram
 * ================================================================== */

async function addFromInstagram(link, env) {
  const canonical = normalizeLink(link);
  const code = shortcode(link);
  if (!code) {
    env.toast("This Instagram link isn't a post or reel.", 'error');
    return;
  }

  // 1) Do we already know this post?
  const existing = findPost(store.db, canonical);
  if (existing) {
    env.toast(`You already saved this post: "${existing.pin.title}"`, 'info');
    env.inputDone?.();
    env.map?.goToPin(existing.pin.id);
    env.showDetail?.(existing.pin.id);
    return;
  }

  // 2) Fetch the caption
  env.toast('Reading the post …', 'busy', 15000);
  let ig;
  try {
    ig = await fetchPost(code);
  } finally {
    env.hideToast?.();
  }

  const caption = ig.ok ? ig.caption || '' : '';
  const postedAt = ig.ok ? ig.postedAt || '' : '';
  const { candidates, countries, hintedCountries } = placeCandidates(caption, {
    username: ig.username, location: ig.location,
  });

  return openConfirm({
    source: 'instagram',
    post: {
      url: canonical, shortcode: code,
      caption, username: ig.username || '', thumb: ig.thumb || '', postedAt,
    },
    igError: ig.ok ? null : ig,
    titleSuggestion: candidates[0]?.text || '',
    whenSuggestion: eventDate(caption, { postedAt })?.text || '',
    candidates,
    countries,
    hintedCountries,
    searchPrefill: cleanedText(caption),
    tagSuggestions: tagSuggestions(caption, store.settings.customStopTags),
    env,
  });
}

/* ================================================================== *
 * Apple and Google links
 * ================================================================== */

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

/** {link, rest} when the first line is an Apple guide link and the rest the Shortcut's results; else null. */
function guideWithResults(text) {
  const [first, ...more] = String(text ?? '').trim().split(/\r?\n/);
  const rest = more.join('\n');
  return isAppleGuideLink(first.trim()) && (/<html/i.test(rest) || rest.includes('@@')) ? { link: first.trim(), rest } : null;
}

/**
 * True for the Shortcut's output (a guide page, place pages, "@@" lines, or a
 * guide link with results below it) and for two or more different links (which
 * startAdd sends to Settings → Import): it goes straight to startAdd, since a
 * text field would drop its line breaks.
 */
export function isShortcutPaste(text) {
  const s = String(text ?? '').trim();
  return looksLikeGuidePage(s) || /<html/i.test(s) || guideWithResults(s) !== null ||
    (s.includes('@@') && parseShortcutResults(s).size > 0) || placeLinks(s).distinct >= 2;
}

/**
 * The Apple place ID of an Apple Maps link that names its place by ID only:
 * auid=<id>, or place-id=I<hex> (Apple's Place ID is the ID in hexadecimal).
 * '' for anything else.
 */
function appleIdOnly(link) {
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
 * The map place links in a paste (text around them is ignored), each link
 * once: their places as import rows, and the Apple IDs of Apple links without
 * coordinates that name their place by ID (each ID once). Guide links stay out:
 * a guide goes its own way, with its title.
 * @returns {{entries: Array, appleIds: string[], links: number, skipped: number, distinct: number, instagram: number}}
 *   links: how many brought a place; skipped: how many other links (guides, links it can't read);
 *   distinct: how many different links the paste has; instagram: how many of them are Instagram posts
 */
function placeLinks(text) {
  const entries = [];
  const appleIds = [];
  const seen = new Set();
  let links = 0;
  let skipped = 0;
  let instagram = 0;
  for (const link of findLinks(text)) {
    if (seen.has(link)) continue;
    seen.add(link);
    if (isInstagramLink(link)) instagram++;
    let parsed = null;
    try {
      parsed = isAppleGuideLink(link) ? null : readLink(link);
    } catch { /* no link readLink knows; perhaps an Apple link with only an ID */ }
    const id = parsed?.entries.some((e) => Number.isFinite(e.lat)) ? '' : appleIdOnly(link);
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
  return { entries, appleIds, links, skipped, distinct: seen.size, instagram };
}

/** The toast for the links a list of place links left out; Instagram posts go in the input bar. */
function skippedNotice(skipped, instagram) {
  const notice = `Skipped ${skipped} ${skipped === 1 ? "link that isn't a place link" : "links that aren't place links"} this app can read.`;
  return instagram ? `${notice} Instagram posts go in the input bar, one at a time.` : notice;
}

/**
 * Two or more map place links in one paste, from Settings → Import
 * (`severalLinks`): one import dialog, one row per place. Rows with coordinates
 * are checked; Apple places named only by ID get the dialog's Shortcut lookup,
 * as a guide's do. An Instagram post among several links never takes over: it
 * is counted as left out, even next to just one place link or none. The input
 * bar takes one link at a time: it imports nothing and says where to go instead.
 * @returns {boolean} false for fewer than two (one link goes on as before)
 */
function addFromPlaceLinks(text, env, severalLinks) {
  const { entries, appleIds, links, skipped, distinct, instagram } = placeLinks(text);
  // The place links "Look up with iPhone Shortcut" copied, pasted before the
  // Shortcut is done (iOS may have reloaded the app): back to the waiting guide.
  const pending = appleIds.length && !entries.length && !skipped ? loadPendingGuide() : null;
  if (pending && appleIds.every((id) => pending.appleIds.includes(id))) {
    env.showImport?.(guideImportEntries(pending), pending.title || 'Apple Guide', pending);
    env.toast("The Shortcut isn't done yet — paste again when it is.", 'info', 6000);
    env.inputDone?.();
    return true;
  }
  if (!severalLinks) {
    // The input bar: any two different links, not just place links. A guide link on
    // the first line is the Shortcut's output (or what is left of it): the guide's way.
    if (distinct < 2 || isAppleGuideLink(text.split(/\r?\n/, 1)[0].trim())) return false;
    env.toast(instagram
      ? 'One Instagram post at a time: paste each link on its own.'
      : 'Several map links? Paste them in Settings → Import (one per line), or import a file there.', 'info', 8000);
    return true;
  }
  if (links < 2 && !(instagram && distinct >= 2)) return false;
  if (links) {
    const guide = appleIds.length ? { title: '', link: '', entries, appleIds } : null;
    env.showImport?.(guide ? guideImportEntries(guide) : entries, '', guide);
  }
  if (skipped) env.toast(skippedNotice(skipped, instagram), 'info', 6000);
  if (links) env.inputDone?.();
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

/** `resolved`: the link is already the answer of /api/resolve. */
async function addFromMapLink(link, env, resolved = false) {
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

  const e0 = parsed.entries[0];
  if (!e0) {
    env.toast('This link contains no place.', 'error');
    return;
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

/* ================================================================== *
 * The confirmation dialog
 * ================================================================== */

export async function openConfirm(cfg) {
  const dlg = $('dlg-confirm');
  preview ??= new PreviewMap('confirm-map');

  state = {
    ...cfg,
    chosen: cfg.readyPlace || null,
    tags: [],
    // Without any suggestion (a map link, a typed search) "want-to-go" is offered.
    tagSuggestions: cfg.tagSuggestions?.length ? cfg.tagSuggestions : ['want-to-go'],
    titleTyped: false,
  };

  // --- Source block ---
  const sourceBlock = $('confirm-source');
  if (cfg.post && (cfg.post.caption || cfg.post.thumb || cfg.post.username)) {
    sourceBlock.hidden = false;
    const thumb = $('confirm-thumb');
    if (cfg.post.thumb) { thumb.src = cfg.post.thumb; thumb.hidden = false; thumb.alt = ''; }
    else thumb.hidden = true;
    $('confirm-user').textContent = cfg.post.username ? `@${cfg.post.username}` : '';
    $('confirm-caption').textContent = cfg.post.caption || '(no text in the post)';
  } else {
    sourceBlock.hidden = true;
  }

  // --- Error notice plus embed as the fallback ---
  const errorBox = $('confirm-error');
  if (cfg.igError) {
    errorBox.hidden = false;
    errorBox.open = true;
    $('confirm-error-text').textContent =
      cfg.igError.message || 'Unknown reason.';
    const embed = embedLink(cfg.post?.url);
    $('confirm-embed').innerHTML = embed
      ? `<iframe src="${embed}" loading="lazy" title="Instagram post"
           referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`
      : '';
  } else {
    errorBox.hidden = true;
    $('confirm-embed').innerHTML = '';
  }

  // --- Reset fields ---
  $('confirm-title').value = cfg.titleSuggestion || '';
  $('confirm-note').value = cfg.note || '';
  $('confirm-when').value = cfg.whenSuggestion || '';
  $('confirm-when-hint').hidden = !cfg.whenSuggestion;
  $('confirm-search').value = '';
  // Colour: Auto, drawn in the colour of where the place comes from.
  state.colorChoice = colorPicker('confirm-color-choice', { auto: sourceColor(cfg.source) });
  $('confirm-color').replaceChildren(state.colorChoice);
  drawTags();
  $('confirm-tags-hint').textContent = cfg.tagSuggestions?.length ? 'Suggested from the post — tap to add:' : 'Suggested — tap to add:';
  drawTagSuggestions(state.tagSuggestions);
  fillTagDatalist();

  if (cfg.readyPlace) {
    choosePlace(cfg.readyPlace);
    $('confirm-candidates').innerHTML = '';
    $('confirm-status').textContent = 'The place came straight from the link. Please give it a quick check anyway.';
  } else {
    $('confirm-preview').hidden = true;
    $('confirm-save').disabled = true;
    $('confirm-candidates').innerHTML = '';
    $('confirm-status').textContent = '';
  }

  dlg.showModal();
  dlg.querySelector('.sheet__body').scrollTop = 0;   // always start at the top

  // --- Look up candidates ---
  if (!cfg.readyPlace && cfg.candidates?.length) {
    await searchCandidates(cfg.candidates, cfg.countries || [], cfg.hintedCountries || []);
  } else if (!cfg.readyPlace) {
    // Don't leave the search field empty: the cleaned-up post text is
    // almost always a better starting point than nothing.
    $('confirm-search').value = cfg.searchPrefill || '';
    $('confirm-status').textContent = cfg.searchPrefill
      ? 'No place could be derived from the text. The post text is ready as a search term: adjust it and search.'
      : 'No place could be derived from the text. Please search above yourself.';
    $('confirm-search').focus();
    $('confirm-search').select();
  }
}

/** Queries the best candidates one after another and merges the matches. */
async function searchCandidates(candidates, countries, hintedCountries = []) {
  const list = $('confirm-candidates');
  const status = $('confirm-status');
  status.textContent = 'Searching for matching places …';
  list.innerHTML = '';

  const all = [];
  const seen = new Set();
  let searchDown = false;

  // At most three candidates, so the place search is not overrun.
  for (const k of candidates.slice(0, 3)) {
    const j = await searchPlaces(k.text, { limit: 5, countryCode: countries.length === 1 ? countries[0] : '' });
    const matches = j.results || [];
    if (!j.ok) searchDown = true;

    for (const t of scoreMatches(matches, { candidatePoints: k.points, countries, hintedCountries })) {
      const key = `${t.lat.toFixed(4)},${t.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...t, searchedAs: k.text });
    }
  }

  all.sort((a, b) => b.points - a.points);
  const top = all.slice(0, 6);

  if (!top.length) {
    status.textContent = searchDown
      ? "Place search isn't responding."
      : 'The place search knows none of these names. Adjust and search again.';
    $('confirm-search').value = candidates[0]?.text || state.searchPrefill || '';
    $('confirm-search').focus();
    $('confirm-search').select();
    return;
  }

  status.textContent = top.length === 1
    ? 'One match — please confirm:'
    : `${top.length} possible places — which one is it?`;
  drawCandidates(top);

  // Show the best one on the preview map already, but don't set it.
  choosePlace(top[0]);
}

function drawCandidates(matches) {
  const list = $('confirm-candidates');
  list.innerHTML = '';
  for (const t of matches) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `
      <span class="candidate__title"><span class="candidate__flag" aria-hidden="true"></span><span class="candidate__name"></span></span>
      <span class="candidate__address"></span>
      <span class="candidate__kind"></span>`;
    btn.querySelector('.candidate__flag').textContent = flagEmoji(t.countryCode);
    btn.querySelector('.candidate__name').textContent = t.name || '(no name)';
    btn.querySelector('.candidate__address').textContent = t.address || '';
    btn.querySelector('.candidate__kind').textContent = kindLabel(t);
    btn.addEventListener('click', () => {
      for (const b of list.querySelectorAll('.candidate')) b.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      choosePlace(t);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  list.querySelector('.candidate')?.setAttribute('aria-pressed', 'true');
}

const KIND_LABELS = {
  cafe: 'Café', restaurant: 'Restaurant', bar: 'Bar', pub: 'Pub', fast_food: 'Fast food',
  bakery: 'Bakery', hotel: 'Hotel', museum: 'Museum', attraction: 'Attraction',
  viewpoint: 'Viewpoint', park: 'Park', beach: 'Beach', peak: 'Peak', city: 'City',
  town: 'Town', village: 'Village', suburb: 'District', country: 'Country', state: 'Region',
  house: 'Address', road: 'Street', residential: 'Street',
};
function kindLabel(t) {
  return KIND_LABELS[t.kind] || t.kind || t.category || '';
}

function choosePlace(place) {
  state.chosen = place;
  $('confirm-preview').hidden = false;
  $('confirm-name').textContent = place.name || '';
  const addr = $('confirm-address');
  addr.textContent = '';
  const flag = flagEmoji(place.countryCode);
  if (flag) {
    const f = document.createElement('span');
    f.className = 'candidate__flag';
    f.setAttribute('aria-hidden', 'true');
    f.textContent = flag;
    addr.appendChild(f);
  }
  addr.appendChild(document.createTextNode(place.address || ''));
  $('confirm-coords').textContent = `${Number(place.lat).toFixed(5)}, ${Number(place.lon).toFixed(5)}`;
  $('confirm-save').disabled = false;

  // The search term from the caption is often "Shop, City": good as search text,
  // bad as a pin name. As soon as a match is selected, take its clean name,
  // unless you have already typed something yourself.
  const titleField = $('confirm-title');
  if (place.name && !state.titleTyped) titleField.value = place.name;

  preview.show([{ lat: place.lat, lon: place.lon, color: '#b8543f', title: place.name }]);
}

/* ---------------- Tags in the dialog ---------------- */

function drawTags() {
  const ul = $('confirm-tags-chosen');
  ul.innerHTML = '';
  for (const t of state.tags) {
    const li = document.createElement('li');
    li.className = 'chip';
    li.style.borderColor = store.tagColor(t);
    const span = document.createElement('span');
    span.textContent = t;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip__x';
    x.setAttribute('aria-label', `Remove tag ${t}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      state.tags = state.tags.filter((a) => a !== t);
      drawTags();
    });
    li.append(span, x);
    ul.appendChild(li);
  }
}

function drawTagSuggestions(suggestions) {
  const ul = $('confirm-tags-suggested');
  const hint = $('confirm-tags-hint');
  ul.innerHTML = '';
  const remaining = suggestions.map(normTag).filter((t) => t && !state.tags.includes(t));
  hint.hidden = remaining.length === 0;
  for (const t of remaining) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = `#${t}`;
    btn.addEventListener('click', () => {
      if (!state.tags.includes(t)) state.tags.push(t);
      drawTags();
      drawTagSuggestions(suggestions);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function fillTagDatalist() {
  const dl = $('tag-datalist');
  dl.innerHTML = '';
  for (const t of store.allTags()) {
    const o = document.createElement('option');
    o.value = t.name;
    dl.appendChild(o);
  }
}

/* ================================================================== *
 * Saving, including the proximity check
 * ================================================================== */

function postsAtPin(n) {
  return n === 1 ? '1 post at this pin' : `${n} posts at this pin`;
}

async function save(env) {
  const place = state.chosen;
  if (!place) return;

  const title = $('confirm-title').value.trim() || place.name || 'Untitled';
  const note = $('confirm-note').value.trim();
  const when = $('confirm-when').value.trim().slice(0, 100);
  const post = state.post || null;

  const neighbors = nearbyPins(store.db, place.lat, place.lon, store.settings.radiusM);
  let keepApartFrom = [];
  if (neighbors.length) {
    const answer = await askNearby(neighbors, place, title);
    if (answer.action === 'cancel') return;
    if (answer.action === 'attach') {
      const target = answer.pin;
      if (post) {
        store.attachPost(target.id, post);
        if (state.tags.length) store.updatePin(target.id, { tags: [...new Set([...(target.tags || []), ...state.tags])] });
        if (when && !target.when) store.updatePin(target.id, { when });
        env.toast(`Post attached to "${target.title}" — ${postsAtPin(store.pin(target.id).posts.length)} now.`, 'success');
      } else {
        env.toast(`"${target.title}" is already here.`, 'info');
      }
      $('dlg-confirm').close();
      env.inputDone?.();
      env.redraw();
      env.map?.goToPin(target.id);
      return;
    }
    keepApartFrom = neighbors.map((n) => n.pin);
  }

  const pin = store.addPin({
    lat: place.lat, lon: place.lon,
    title,
    address: place.address || '',
    note,
    when,
    tags: state.tags,
    post,
    source: state.source,
    color: pickedColor(state.colorChoice),
  });

  // Remember that these pins are meant to stay separate
  if (keepApartFrom.length) store.change(() => { for (const n of keepApartFrom) markApart(pin, n); });

  $('dlg-confirm').close();
  env.inputDone?.();
  env.redraw();
  env.map?.goToPin(pin.id);
  env.toast(`"${pin.title}" saved.`, 'success');
  env.pinwheel?.(pinLook(state.source));
}

/** Lets the user attach to one of the nearby pins, make a new pin, or cancel. */
function askNearby(neighbors, place, title) {
  return new Promise((done) => {
    const dlg = $('dlg-nearby');
    const map = new PreviewMap('nearby-map');
    let chosen = null;

    $('nearby-text').textContent = neighbors.length === 1
      ? `"${title}" is ${distanceText(neighbors[0].distance)} from your pin "${neighbors[0].pin.title}". Do they belong together?`
      : `"${title}" is close to ${neighbors.length} of your pins. Attach it to one, or make a new pin.`;

    const list = $('nearby-list');
    list.innerHTML = '';
    for (const { pin, distance } of neighbors) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'candidate';
      btn.innerHTML = '<span class="candidate__name"></span><span class="candidate__address"></span>';
      btn.querySelector('.candidate__name').textContent = `Attach to "${pin.title}"`;
      btn.querySelector('.candidate__address').textContent = `${distanceText(distance)} away`;
      btn.addEventListener('click', () => { chosen = pin; dlg.close('attach'); });
      li.appendChild(btn);
      list.appendChild(li);
    }

    map.show([
      ...neighbors.map(({ pin }) => ({ lat: pin.lat, lon: pin.lon, color: store.pinColor(pin), title: pin.title })),
      { lat: place.lat, lon: place.lon, color: '#b8543f', title },
    ]);

    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      map.destroy();
      const v = dlg.returnValue;
      done(v === 'attach' && chosen ? { action: 'attach', pin: chosen }
        : v === 'new' ? { action: 'new' } : { action: 'cancel' });
    });
    dlg.returnValue = '';
    dlg.showModal();
  });
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

export function wireConfirm(env) {
  // Saved with the env the add started with: from Settings, it empties Settings' paste box.
  $('confirm-save').addEventListener('click', () => save(state?.env || env));

  // The "from the post" hint goes once the suggestion is cleared.
  $('confirm-when').addEventListener('input', () => {
    if (!$('confirm-when').value.trim()) $('confirm-when-hint').hidden = true;
  });

  // Once you touch the title yourself, no match overwrites it any more.
  $('confirm-title').addEventListener('input', () => {
    if (state) state.titleTyped = true;
  });

  // Add a tag by hand
  const tagAdd = () => {
    const field = $('confirm-tag-input');
    const t = normTag(field.value);
    if (t && !state.tags.includes(t)) state.tags.push(t);
    field.value = '';
    drawTags();
    drawTagSuggestions(state.tagSuggestions || []);
  };
  $('confirm-tag-add').addEventListener('click', tagAdd);
  $('confirm-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagAdd(); }
  });

  // Manual place search
  const runSearch = async () => {
    const q = $('confirm-search').value.trim();
    if (!q) return;
    $('confirm-status').textContent = 'Searching …';
    {
      const j = await searchPlaces(q, { limit: 8 });
      if (!j.ok) {
        $('confirm-status').textContent = "Place search isn't responding.";
        return;
      }
      const matches = scoreMatches(j.results || [], {
        candidatePoints: 60, countries: state.countries || [], hintedCountries: state.hintedCountries || [],
      });
      if (!matches.length) {
        $('confirm-status').textContent = 'Nothing found for that.';
        $('confirm-candidates').innerHTML = '';
        return;
      }
      $('confirm-status').textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}:`;
      drawCandidates(matches);
      choosePlace(matches[0]);
    }
  };
  $('confirm-search-go').addEventListener('click', runSearch);
  $('confirm-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  // Clean up on close, so no iframe keeps loading in the background
  $('dlg-confirm').addEventListener('close', () => {
    $('confirm-embed').innerHTML = '';
    preview?.destroy();
    preview = null;
  });
}
