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
  findPost, nearbyPins, wantedApart, markApart, distanceText,
} from './dedupe.js';
import { placeCandidates, scoreMatches, tagSuggestions, cleanedText } from './extract.js';
import { readLink } from './importers.js';

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
    env.map?.goToPin(existing.pin.id);
    env.showDetail?.(existing.pin.id);
    return;
  }

  // 2) Fetch the caption
  env.toast('Fetching the post text …', 'info', 8000);
  let ig = { ok: false };
  try {
    const r = await fetch(`/api/ig?url=${encodeURIComponent(canonical)}`);
    ig = await r.json();
  } catch (e) {
    ig = { ok: false, reason: 'netzwerk', message: e.message };
  }
  env.hideToast?.();

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

async function addFromMapLink(link, env) {
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
    return;
  }

  const e0 = parsed.entries[0];
  if (!e0) {
    env.toast('This link contains no place.', 'error');
    return;
  }

  // Short link? Resolve it first.
  if (!Number.isFinite(e0.lat) && /goo\.gl|maps\.apple\/|g\.co/i.test(e0.url || link)) {
    env.toast('Resolving the short link …', 'info', 8000);
    try {
      const r = await fetch(`/api/resolve?url=${encodeURIComponent(e0.url || link)}`);
      const j = await r.json();
      if (j.ok && j.url) {
        env.hideToast?.();
        return addFromMapLink(j.url, env);
      }
    } catch { /* then not */ }
    env.hideToast?.();
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
  const dlg = $('dlg-bestaetigen');
  preview ??= new PreviewMap('best-karte');

  state = {
    ...cfg,
    chosen: cfg.readyPlace || null,
    tags: [],
    status: 'wishlist',
    titleTyped: false,
  };

  // --- Source block ---
  const sourceBlock = $('best-quelle');
  if (cfg.post && (cfg.post.caption || cfg.post.thumb || cfg.post.username)) {
    sourceBlock.hidden = false;
    const thumb = $('best-thumb');
    if (cfg.post.thumb) { thumb.src = cfg.post.thumb; thumb.hidden = false; thumb.alt = ''; }
    else thumb.hidden = true;
    $('best-user').textContent = cfg.post.username ? `@${cfg.post.username}` : '';
    $('best-caption').textContent = cfg.post.caption || '(no text in the post)';
  } else {
    sourceBlock.hidden = true;
  }

  // --- Error notice plus embed as the fallback ---
  const errorBox = $('best-fehler');
  if (cfg.igError) {
    errorBox.hidden = false;
    errorBox.open = true;
    $('best-fehler-text').textContent =
      cfg.igError.message || 'Unknown reason.';
    const embed = embedLink(cfg.post?.url);
    $('best-embed').innerHTML = embed
      ? `<iframe src="${embed}" loading="lazy" title="Instagram post"
           referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`
      : '';
  } else {
    errorBox.hidden = true;
    $('best-embed').innerHTML = '';
  }

  // --- Reset fields ---
  $('best-titel').value = cfg.titleSuggestion || '';
  $('best-notiz').value = cfg.note || '';
  $('best-suche').value = '';
  setStatus('wishlist');
  drawTags();
  drawTagSuggestions(cfg.tagSuggestions || []);
  fillTagDatalist();

  if (cfg.readyPlace) {
    choosePlace(cfg.readyPlace);
    $('best-kandidaten').innerHTML = '';
    $('best-status').textContent = 'The place came straight from the link. Please give it a quick check anyway.';
  } else {
    $('best-vorschau').hidden = true;
    $('best-speichern').disabled = true;
    $('best-kandidaten').innerHTML = '';
    $('best-status').textContent = '';
  }

  dlg.showModal();
  dlg.querySelector('.sheet__body').scrollTop = 0;   // always start at the top

  // --- Look up candidates ---
  if (!cfg.readyPlace && cfg.candidates?.length) {
    await searchCandidates(cfg.candidates, cfg.countries || []);
  } else if (!cfg.readyPlace) {
    // Don't leave the search field empty: the cleaned-up post text is
    // almost always a better starting point than nothing.
    $('best-suche').value = cfg.searchPrefill || '';
    $('best-status').textContent = cfg.searchPrefill
      ? 'No place could be derived from the text. The post text is ready as a search term: adjust it and search.'
      : 'No place could be derived from the text. Please search above yourself.';
    $('best-suche').focus();
    $('best-suche').select();
  }
}

/** Queries the best candidates one after another and merges the matches. */
async function searchCandidates(candidates, countries) {
  const list = $('best-kandidaten');
  const status = $('best-status');
  status.textContent = 'Searching for matching places …';
  list.innerHTML = '';

  const all = [];
  const seen = new Set();

  // At most three candidates, so the place search is not overrun.
  for (const k of candidates.slice(0, 3)) {
    let matches = [];
    try {
      const url = `/api/geocode?q=${encodeURIComponent(k.text)}&limit=5` +
        (countries.length === 1 ? `&cc=${countries[0]}` : '');
      const j = await (await fetch(url)).json();
      matches = j.results || [];
    } catch { /* next candidate */ }

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
    status.textContent =
      'The place search knows none of these names. Please adjust and search again.';
    $('best-suche').value = candidates[0]?.text || state.searchPrefill || '';
    $('best-suche').focus();
    $('best-suche').select();
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
  const list = $('best-kandidaten');
  list.innerHTML = '';
  for (const t of matches) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kandidat';
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = `
      <span class="kandidat__name"></span>
      <span class="kandidat__adr"></span>
      <span class="kandidat__art"></span>`;
    btn.querySelector('.kandidat__name').textContent = t.name || '(no name)';
    btn.querySelector('.kandidat__adr').textContent = t.address || '';
    btn.querySelector('.kandidat__art').textContent = kindLabel(t);
    btn.addEventListener('click', () => {
      for (const b of list.querySelectorAll('.kandidat')) b.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      choosePlace(t);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
  list.querySelector('.kandidat')?.setAttribute('aria-pressed', 'true');
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
  $('best-vorschau').hidden = false;
  $('best-name').textContent = place.name || '';
  $('best-adresse').textContent = place.address || '';
  $('best-koord').textContent = `${Number(place.lat).toFixed(5)}, ${Number(place.lon).toFixed(5)}`;
  $('best-speichern').disabled = false;

  // The search term from the caption is often "Shop, City": good as search text,
  // bad as a pin name. As soon as a match is selected, take its clean name,
  // unless you have already typed something yourself.
  const titleField = $('best-titel');
  if (place.name && !state.titleTyped) titleField.value = place.name;

  preview.show([{ lat: place.lat, lon: place.lon, color: '#b8543f', title: place.name }]);
}

/* ---------------- Tags in the dialog ---------------- */

function drawTags() {
  const ul = $('best-tags-gewaehlt');
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
  const ul = $('best-tags-vorschlag');
  const hint = $('best-tags-hint');
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
  const dl = $('tag-vorschlagsliste');
  dl.innerHTML = '';
  for (const t of store.allTags()) {
    const o = document.createElement('option');
    o.value = t.name;
    dl.appendChild(o);
  }
}

function setStatus(value) {
  state.status = value;
  for (const b of document.querySelectorAll('#dlg-bestaetigen [data-status]')) {
    const isActive = b.dataset.status === value;
    b.classList.toggle('is-active', isActive);
    b.setAttribute('aria-checked', String(isActive));
  }
}

/* ================================================================== *
 * Saving, including the proximity check
 * ================================================================== */

async function save(env) {
  const place = state.chosen;
  if (!place) return;

  const title = $('best-titel').value.trim() || place.name || 'Untitled';
  const note = $('best-notiz').value.trim();
  const post = state.post || null;

  // Look for neighbors that have not yet been explicitly kept separate
  const radius = store.settings.radiusM;
  const neighbors = nearbyPins(store.db, place.lat, place.lon, radius);

  if (neighbors.length) {
    const { pin: neighbor, distance } = neighbors[0];
    const decision = await askNearby(neighbor, distance, place, title);

    if (decision === 'abbrechen') return;

    if (decision === 'anhaengen') {
      if (post) {
        store.attachPost(neighbor.id, post);
        // Add the new post's tags to the existing pin
        if (state.tags.length) {
          store.updatePin(neighbor.id, { tags: [...new Set([...(neighbor.tags || []), ...state.tags])] });
        }
        env.toast(`Post attached to "${neighbor.title}" — now ${neighbor.posts.length} posts at this pin.`, 'success');
      } else {
        env.toast(`"${neighbor.title}" already exists here.`, 'info');
      }
      $('dlg-bestaetigen').close();
      env.redraw();
      env.map?.goToPin(neighbor.id);
      return;
    }
    // 'neu' falls through and creates a separate pin
    var keptApartFrom = neighbors.map((n) => n.pin);
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
  if (typeof keptApartFrom !== 'undefined') {
    store.change(() => {
      for (const n of keptApartFrom) markApart(pin, n);
    });
  }

  $('dlg-bestaetigen').close();
  env.redraw();
  env.map?.goToPin(pin.id);
  env.toast(`"${pin.title}" saved.`, 'success');
}

/** Opens the neighbor dialog and returns 'anhaengen' | 'neu' | 'abbrechen'. */
function askNearby(neighbor, distance, place, title) {
  return new Promise((done) => {
    const dlg = $('dlg-nachbar');
    const nearbyMap = new PreviewMap('nachbar-karte');

    $('nachbar-text').textContent =
      `"${title}" is ${distanceText(distance)} away from your pin "${neighbor.title}". ` +
      `Do the two belong together?`;
    $('nachbar-anhaengen').textContent = `Attach to "${neighbor.title}"`;

    nearbyMap.show([
      { lat: neighbor.lat, lon: neighbor.lon, color: store.pinColor(neighbor), title: neighbor.title },
      { lat: place.lat, lon: place.lon, color: '#b8543f', title },
    ]);

    dlg.addEventListener('close', function onClose() {
      dlg.removeEventListener('close', onClose);
      nearbyMap.destroy();
      done(dlg.returnValue || 'abbrechen');
    });
    dlg.showModal();
  });
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

export function wireConfirm(env) {
  $('best-speichern').addEventListener('click', () => save(env));

  // Once you touch the title yourself, no match overwrites it any more.
  $('best-titel').addEventListener('input', () => {
    if (state) state.titleTyped = true;
  });

  for (const b of document.querySelectorAll('#dlg-bestaetigen [data-status]')) {
    b.addEventListener('click', () => setStatus(b.dataset.status));
  }

  // Add a tag by hand
  const tagAdd = () => {
    const field = $('best-tag-feld');
    const t = normTag(field.value);
    if (t && !state.tags.includes(t)) state.tags.push(t);
    field.value = '';
    drawTags();
    drawTagSuggestions(state.tagSuggestions || []);
  };
  $('best-tag-add').addEventListener('click', tagAdd);
  $('best-tag-feld').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagAdd(); }
  });

  // Manual place search
  const runSearch = async () => {
    const q = $('best-suche').value.trim();
    if (!q) return;
    $('best-status').textContent = 'Searching …';
    try {
      const j = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=8`)).json();
      const matches = scoreMatches(j.results || [], {
        candidatePoints: 60, countries: state.countries || [],
      });
      if (!matches.length) {
        $('best-status').textContent = 'Nothing found for that.';
        $('best-kandidaten').innerHTML = '';
        return;
      }
      $('best-status').textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}:`;
      drawCandidates(matches);
      choosePlace(matches[0]);
    } catch (e) {
      $('best-status').textContent = 'The place search is not responding: ' + e.message;
    }
  };
  $('best-suche-go').addEventListener('click', runSearch);
  $('best-suche').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
  });

  // Clean up on close, so no iframe keeps loading in the background
  $('dlg-bestaetigen').addEventListener('close', () => {
    $('best-embed').innerHTML = '';
    preview?.destroy();
    preview = null;
  });
}
