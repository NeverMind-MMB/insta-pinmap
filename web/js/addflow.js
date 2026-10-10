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
import { placeCandidates, scoreMatches, tagSuggestions, cleanedText } from './extract.js';
import { readLink } from './importers.js';
import { searchPlaces } from './geocode.js';
import { fetchPost, resolveShortLink } from './api.js';

const $ = (id) => document.getElementById(id);

let preview = null;
let state = null;   // the operation in progress

/* ================================================================== *
 * Entry point
 * ================================================================== */

/**
 * @param {string} input   Instagram link, maps link or free search text
 * @param {object} env  { toast, map, redraw }
 */
export async function startAdd(input, env) {
  const text = String(input || '').trim();
  if (!text) return;

  // Fish the link out of shared text: Android often sends
  // "Check this out: https://... " instead of just the URL.
  const linkInText = text.match(/https?:\/\/\S+/);
  const candidateLink = linkInText ? linkInText[0].replace(/[),.]+$/, '') : text;

  if (isInstagramLink(candidateLink)) {
    return addFromInstagram(candidateLink, env);
  }

  if (/maps\.apple|guides\.apple|google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl/i.test(candidateLink)) {
    return addFromMapLink(candidateLink, env);
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

/* ================================================================== *
 * Instagram
 * ================================================================== */

async function addFromInstagram(link, env) {
  const canonical = normalizeLink(link);
  const code = shortcode(link);

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
  env.toast('Reading the post …', 'info', 15000);
  let ig;
  try {
    ig = await fetchPost(code);
  } finally {
    env.hideToast?.();
  }

  const caption = ig.ok ? ig.caption || '' : '';
  const { candidates, countries } = placeCandidates(caption, {
    username: ig.username, location: ig.location,
  });

  return openConfirm({
    source: 'instagram',
    post: {
      url: canonical, shortcode: code,
      caption, username: ig.username || '', thumb: ig.thumb || '',
    },
    igError: ig.ok ? null : ig,
    titleSuggestion: candidates[0]?.text || '',
    candidates,
    countries,
    searchPrefill: cleanedText(caption),
    tagSuggestions: tagSuggestions(caption, store.settings.customStopTags),
    env,
  });
}

/* ================================================================== *
 * Apple and Google links
 * ================================================================== */

/** `resolved`: the link is already the answer of /api/resolve. */
async function addFromMapLink(link, env, resolved = false) {
  let parsed;
  try {
    parsed = readLink(link);
  } catch (e) {
    env.toast(e.message, 'error');
    return;
  }

  // An Apple Guide brings several places at once, so it goes through the import.
  if (parsed.entries.length > 1) {
    env.showImport?.(parsed.entries, parsed.name);
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
  if (!resolved && !Number.isFinite(e0.lat) && /goo\.gl|maps\.apple\/|g\.co/i.test(e0.url || link)) {
    const sent = e0.url || link;
    env.toast('Resolving the short link …', 'info', 8000);
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
    candidates: Number.isFinite(e0.lat) ? [] : [{ text: e0.name, points: 70, source: 'link' }],
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
    status: 'wishlist',
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
  $('confirm-search').value = '';
  setStatus('wishlist');
  drawTags();
  drawTagSuggestions(cfg.tagSuggestions || []);
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
    await searchCandidates(cfg.candidates, cfg.countries || []);
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
async function searchCandidates(candidates, countries) {
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

    for (const t of scoreMatches(matches, { candidatePoints: k.points, countries })) {
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
      <span class="candidate__name"></span>
      <span class="candidate__address"></span>
      <span class="candidate__kind"></span>`;
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
  $('confirm-address').textContent = place.address || '';
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

function setStatus(value) {
  state.status = value;
  for (const b of document.querySelectorAll('#dlg-confirm [data-status]')) {
    const isActive = b.dataset.status === value;
    b.classList.toggle('is-active', isActive);
    b.setAttribute('aria-checked', String(isActive));
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
    status: state.status,
    tags: state.tags,
    post,
    source: state.source,
  });

  // Remember that these pins are meant to stay separate
  if (keepApartFrom.length) store.change(() => { for (const n of keepApartFrom) markApart(pin, n); });

  $('dlg-confirm').close();
  env.inputDone?.();
  env.redraw();
  env.map?.goToPin(pin.id);
  env.toast(`"${pin.title}" saved.`, 'success');
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
  $('confirm-save').addEventListener('click', () => save(env));

  // Once you touch the title yourself, no match overwrites it any more.
  $('confirm-title').addEventListener('input', () => {
    if (state) state.titleTyped = true;
  });

  for (const b of document.querySelectorAll('#dlg-confirm [data-status]')) {
    b.addEventListener('click', () => setStatus(b.dataset.status));
  }

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
        candidatePoints: 60, countries: state.countries || [],
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
