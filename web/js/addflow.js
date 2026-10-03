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
import { Vorschaukarte } from './map.js';
import {
  shortcode, normalisiereLink, embedLink, istInstagramLink,
  findePost, nahePins, getrenntGewollt, merkeGetrennt, entfernungText,
} from './dedupe.js';
import { ortsKandidaten, bewerteTreffer, tagVorschlaege, sauberterText } from './extract.js';
import { leseLink } from './importers.js';

const $ = (id) => document.getElementById(id);

let vorschau = null;
let zustand = null;   // the operation in progress

/* ================================================================== *
 * Entry point
 * ================================================================== */

/**
 * @param {string} eingabe   Instagram link, maps link or free search text
 * @param {object} umgebung  { toast, karte, neuZeichnen }
 */
export async function starteHinzufuegen(eingabe, umgebung) {
  const text = String(eingabe || '').trim();
  if (!text) return;

  // Fish the link out of shared text: Android often sends
  // "Check this out: https://... " instead of just the URL.
  const linkImText = text.match(/https?:\/\/\S+/);
  const kandidatLink = linkImText ? linkImText[0].replace(/[),.]+$/, '') : text;

  if (istInstagramLink(kandidatLink)) {
    return instagramWeg(kandidatLink, umgebung);
  }

  if (/maps\.apple|guides\.apple|google\.[a-z.]+\/maps|maps\.google\.|maps\.app\.goo\.gl/i.test(kandidatLink)) {
    return kartenLinkWeg(kandidatLink, umgebung);
  }

  // Free text: treat it as a place search
  return oeffneBestaetigung({
    quelle: 'manuell',
    titelVorschlag: text,
    kandidaten: [{ text, punkte: 60, quelle: 'eingabe' }],
    countries: [],
    umgebung,
  });
}

/* ================================================================== *
 * Instagram
 * ================================================================== */

async function instagramWeg(link, umgebung) {
  const kanonisch = normalisiereLink(link);
  const code = shortcode(link);

  // 1) Do we already know this post?
  const vorhanden = findePost(store.db, kanonisch);
  if (vorhanden) {
    umgebung.toast(`You already saved this post: "${vorhanden.pin.title}"`, 'info');
    umgebung.karte?.zuPin(vorhanden.pin.id);
    umgebung.zeigeDetail?.(vorhanden.pin.id);
    return;
  }

  // 2) Fetch the caption
  umgebung.toast('Fetching the post text …', 'info', 8000);
  let ig = { ok: false };
  try {
    const r = await fetch(`/api/ig?url=${encodeURIComponent(kanonisch)}`);
    ig = await r.json();
  } catch (e) {
    ig = { ok: false, reason: 'netzwerk', message: e.message };
  }
  umgebung.toastWeg?.();

  const caption = ig.ok ? ig.caption || '' : '';
  const { candidates, countries } = ortsKandidaten(caption, {
    username: ig.username, location: ig.location,
  });

  return oeffneBestaetigung({
    quelle: 'instagram',
    post: {
      url: kanonisch, shortcode: code,
      caption, username: ig.username || '', thumb: ig.thumb || '',
    },
    igFehler: ig.ok ? null : ig,
    titelVorschlag: candidates[0]?.text || '',
    kandidaten: candidates,
    countries,
    suchVorbelegung: sauberterText(caption),
    tagVorschlaege: tagVorschlaege(caption, store.einstellungen.eigeneStoppTags),
    umgebung,
  });
}

/* ================================================================== *
 * Apple and Google links
 * ================================================================== */

async function kartenLinkWeg(link, umgebung) {
  let gelesen;
  try {
    gelesen = leseLink(link);
  } catch (e) {
    umgebung.toast(e.message, 'fehler');
    return;
  }

  // An Apple Guide brings several places at once, so it goes through the import.
  if (gelesen.eintraege.length > 1) {
    umgebung.zeigeImport?.(gelesen.eintraege, gelesen.name);
    return;
  }

  const e0 = gelesen.eintraege[0];
  if (!e0) {
    umgebung.toast('This link contains no place.', 'fehler');
    return;
  }

  // Short link? Resolve it first.
  if (!Number.isFinite(e0.lat) && /goo\.gl|maps\.apple\/|g\.co/i.test(e0.url || link)) {
    umgebung.toast('Resolving the short link …', 'info', 8000);
    try {
      const r = await fetch(`/api/resolve?url=${encodeURIComponent(e0.url || link)}`);
      const j = await r.json();
      if (j.ok && j.url) {
        umgebung.toastWeg?.();
        return kartenLinkWeg(j.url, umgebung);
      }
    } catch { /* then not */ }
    umgebung.toastWeg?.();
  }

  return oeffneBestaetigung({
    quelle: e0.quelle,
    titelVorschlag: e0.name,
    fertigerOrt: Number.isFinite(e0.lat)
      ? { lat: e0.lat, lon: e0.lon, name: e0.name, address: e0.address, source: e0.quelle }
      : null,
    kandidaten: Number.isFinite(e0.lat) ? [] : [{ text: e0.name, punkte: 70, quelle: 'link' }],
    countries: [],
    notiz: e0.note || '',
    umgebung,
  });
}

/* ================================================================== *
 * The confirmation dialog
 * ================================================================== */

export async function oeffneBestaetigung(cfg) {
  const dlg = $('dlg-bestaetigen');
  vorschau ??= new Vorschaukarte('best-karte');

  zustand = {
    ...cfg,
    gewaehlt: cfg.fertigerOrt || null,
    tags: [],
    status: 'wishlist',
    titelVonHand: false,
  };

  // --- Source block ---
  const quelle = $('best-quelle');
  if (cfg.post && (cfg.post.caption || cfg.post.thumb || cfg.post.username)) {
    quelle.hidden = false;
    const thumb = $('best-thumb');
    if (cfg.post.thumb) { thumb.src = cfg.post.thumb; thumb.hidden = false; thumb.alt = ''; }
    else thumb.hidden = true;
    $('best-user').textContent = cfg.post.username ? `@${cfg.post.username}` : '';
    $('best-caption').textContent = cfg.post.caption || '(no text in the post)';
  } else {
    quelle.hidden = true;
  }

  // --- Error notice plus embed as the fallback ---
  const fehlerBox = $('best-fehler');
  if (cfg.igFehler) {
    fehlerBox.hidden = false;
    fehlerBox.open = true;
    $('best-fehler-text').textContent =
      cfg.igFehler.message || 'Unknown reason.';
    const eb = embedLink(cfg.post?.url);
    $('best-embed').innerHTML = eb
      ? `<iframe src="${eb}" loading="lazy" title="Instagram post"
           referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>`
      : '';
  } else {
    fehlerBox.hidden = true;
    $('best-embed').innerHTML = '';
  }

  // --- Reset fields ---
  $('best-titel').value = cfg.titelVorschlag || '';
  $('best-notiz').value = cfg.notiz || '';
  $('best-suche').value = '';
  setzeStatus('wishlist');
  zeichneTags();
  zeichneTagVorschlaege(cfg.tagVorschlaege || []);
  fuelleTagListe();

  if (cfg.fertigerOrt) {
    waehleOrt(cfg.fertigerOrt);
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
  if (!cfg.fertigerOrt && cfg.kandidaten?.length) {
    await sucheKandidaten(cfg.kandidaten, cfg.countries || []);
  } else if (!cfg.fertigerOrt) {
    // Don't leave the search field empty: the cleaned-up post text is
    // almost always a better starting point than nothing.
    $('best-suche').value = cfg.suchVorbelegung || '';
    $('best-status').textContent = cfg.suchVorbelegung
      ? 'No place could be derived from the text. The post text is ready as a search term: adjust it and search.'
      : 'No place could be derived from the text. Please search above yourself.';
    $('best-suche').focus();
    $('best-suche').select();
  }
}

/** Queries the best candidates one after another and merges the matches. */
async function sucheKandidaten(kandidaten, countries) {
  const liste = $('best-kandidaten');
  const status = $('best-status');
  status.textContent = 'Searching for matching places …';
  liste.innerHTML = '';

  const alle = [];
  const gesehen = new Set();

  // At most three candidates, so the place search is not overrun.
  for (const k of kandidaten.slice(0, 3)) {
    let treffer = [];
    try {
      const url = `/api/geocode?q=${encodeURIComponent(k.text)}&limit=5` +
        (countries.length === 1 ? `&cc=${countries[0]}` : '');
      const j = await (await fetch(url)).json();
      treffer = j.results || [];
    } catch { /* next candidate */ }

    for (const t of bewerteTreffer(treffer, { kandidatPunkte: k.punkte, countries })) {
      const schluessel = `${t.lat.toFixed(4)},${t.lon.toFixed(4)}`;
      if (gesehen.has(schluessel)) continue;
      gesehen.add(schluessel);
      alle.push({ ...t, gesuchtAls: k.text });
    }
  }

  alle.sort((a, b) => b.punkte - a.punkte);
  const top = alle.slice(0, 6);

  if (!top.length) {
    status.textContent =
      'The place search knows none of these names. Please adjust and search again.';
    $('best-suche').value = kandidaten[0]?.text || zustand.suchVorbelegung || '';
    $('best-suche').focus();
    $('best-suche').select();
    return;
  }

  status.textContent = top.length === 1
    ? 'One match — please confirm:'
    : `${top.length} possible places — which one is it?`;
  zeichneKandidaten(top);

  // Show the best one on the preview map already, but don't set it.
  waehleOrt(top[0]);
}

function zeichneKandidaten(treffer) {
  const liste = $('best-kandidaten');
  liste.innerHTML = '';
  for (const t of treffer) {
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
    btn.querySelector('.kandidat__art').textContent = artText(t);
    btn.addEventListener('click', () => {
      for (const b of liste.querySelectorAll('.kandidat')) b.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      waehleOrt(t);
    });
    li.appendChild(btn);
    liste.appendChild(li);
  }
  liste.querySelector('.kandidat')?.setAttribute('aria-pressed', 'true');
}

const ART_TEXT = {
  cafe: 'Café', restaurant: 'Restaurant', bar: 'Bar', pub: 'Pub', fast_food: 'Fast food',
  bakery: 'Bakery', hotel: 'Hotel', museum: 'Museum', attraction: 'Attraction',
  viewpoint: 'Viewpoint', park: 'Park', beach: 'Beach', peak: 'Peak', city: 'City',
  town: 'Town', village: 'Village', suburb: 'District', country: 'Country', state: 'Region',
  house: 'Address', road: 'Street', residential: 'Street',
};
function artText(t) {
  return ART_TEXT[t.kind] || t.kind || t.category || '';
}

function waehleOrt(ort) {
  zustand.gewaehlt = ort;
  $('best-vorschau').hidden = false;
  $('best-name').textContent = ort.name || '';
  $('best-adresse').textContent = ort.address || '';
  $('best-koord').textContent = `${Number(ort.lat).toFixed(5)}, ${Number(ort.lon).toFixed(5)}`;
  $('best-speichern').disabled = false;

  // The search term from the caption is often "Shop, City": good as search text,
  // bad as a pin name. As soon as a match is selected, take its clean name,
  // unless you have already typed something yourself.
  const titelFeld = $('best-titel');
  if (ort.name && !zustand.titelVonHand) titelFeld.value = ort.name;

  vorschau.zeige([{ lat: ort.lat, lon: ort.lon, farbe: '#b8543f', titel: ort.name }]);
}

/* ---------------- Tags in the dialog ---------------- */

function zeichneTags() {
  const ul = $('best-tags-gewaehlt');
  ul.innerHTML = '';
  for (const t of zustand.tags) {
    const li = document.createElement('li');
    li.className = 'chip';
    li.style.borderColor = store.tagFarbe(t);
    const span = document.createElement('span');
    span.textContent = t;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip__x';
    x.setAttribute('aria-label', `Remove tag ${t}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      zustand.tags = zustand.tags.filter((a) => a !== t);
      zeichneTags();
    });
    li.append(span, x);
    ul.appendChild(li);
  }
}

function zeichneTagVorschlaege(vorschlaege) {
  const ul = $('best-tags-vorschlag');
  const hint = $('best-tags-hint');
  ul.innerHTML = '';
  const offen = vorschlaege.map(normTag).filter((t) => t && !zustand.tags.includes(t));
  hint.hidden = offen.length === 0;
  for (const t of offen) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = `#${t}`;
    btn.addEventListener('click', () => {
      if (!zustand.tags.includes(t)) zustand.tags.push(t);
      zeichneTags();
      zeichneTagVorschlaege(vorschlaege);
    });
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function fuelleTagListe() {
  const dl = $('tag-vorschlagsliste');
  dl.innerHTML = '';
  for (const t of store.alleTags()) {
    const o = document.createElement('option');
    o.value = t.name;
    dl.appendChild(o);
  }
}

function setzeStatus(wert) {
  zustand.status = wert;
  for (const b of document.querySelectorAll('#dlg-bestaetigen [data-status]')) {
    const an = b.dataset.status === wert;
    b.classList.toggle('is-active', an);
    b.setAttribute('aria-checked', String(an));
  }
}

/* ================================================================== *
 * Saving, including the proximity check
 * ================================================================== */

async function speichern(umgebung) {
  const ort = zustand.gewaehlt;
  if (!ort) return;

  const titel = $('best-titel').value.trim() || ort.name || 'Untitled';
  const notiz = $('best-notiz').value.trim();
  const post = zustand.post || null;

  // Look for neighbors that have not yet been explicitly kept separate
  const radius = store.einstellungen.radiusM;
  const nachbarn = nahePins(store.db, ort.lat, ort.lon, radius);

  if (nachbarn.length) {
    const { pin: nachbar, distanz } = nachbarn[0];
    const entscheidung = await fragNachbar(nachbar, distanz, ort, titel);

    if (entscheidung === 'abbrechen') return;

    if (entscheidung === 'anhaengen') {
      if (post) {
        store.postAnhaengen(nachbar.id, post);
        // Add the new post's tags to the existing pin
        if (zustand.tags.length) {
          store.pinAendern(nachbar.id, { tags: [...new Set([...(nachbar.tags || []), ...zustand.tags])] });
        }
        umgebung.toast(`Post attached to "${nachbar.title}" — now ${nachbar.posts.length} posts at this pin.`, 'gut');
      } else {
        umgebung.toast(`"${nachbar.title}" already exists here.`, 'info');
      }
      $('dlg-bestaetigen').close();
      umgebung.neuZeichnen();
      umgebung.karte?.zuPin(nachbar.id);
      return;
    }
    // 'neu' falls through and creates a separate pin
    var getrenntVon = nachbarn.map((n) => n.pin);
  }

  const pin = store.neuerPin({
    lat: ort.lat, lon: ort.lon,
    title: titel,
    address: ort.address || '',
    note: notiz,
    status: zustand.status,
    tags: zustand.tags,
    post,
    quelle: zustand.quelle,
  });

  // Remember that these pins are meant to stay separate
  if (typeof getrenntVon !== 'undefined') {
    store.aendern(() => {
      for (const n of getrenntVon) merkeGetrennt(pin, n);
    });
  }

  $('dlg-bestaetigen').close();
  umgebung.neuZeichnen();
  umgebung.karte?.zuPin(pin.id);
  umgebung.toast(`"${pin.title}" saved.`, 'gut');
}

/** Opens the neighbor dialog and returns 'anhaengen' | 'neu' | 'abbrechen'. */
function fragNachbar(nachbar, distanz, ort, titel) {
  return new Promise((fertig) => {
    const dlg = $('dlg-nachbar');
    const karte = new Vorschaukarte('nachbar-karte');

    $('nachbar-text').textContent =
      `"${titel}" is ${entfernungText(distanz)} away from your pin "${nachbar.title}". ` +
      `Do the two belong together?`;
    $('nachbar-anhaengen').textContent = `Attach to "${nachbar.title}"`;

    karte.zeige([
      { lat: nachbar.lat, lon: nachbar.lon, farbe: store.pinFarbe(nachbar), titel: nachbar.title },
      { lat: ort.lat, lon: ort.lon, farbe: '#b8543f', titel },
    ]);

    dlg.addEventListener('close', function beim() {
      dlg.removeEventListener('close', beim);
      karte.aufraeumen();
      fertig(dlg.returnValue || 'abbrechen');
    });
    dlg.showModal();
  });
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

export function verdrahteBestaetigung(umgebung) {
  $('best-speichern').addEventListener('click', () => speichern(umgebung));

  // Once you touch the title yourself, no match overwrites it any more.
  $('best-titel').addEventListener('input', () => {
    if (zustand) zustand.titelVonHand = true;
  });

  for (const b of document.querySelectorAll('#dlg-bestaetigen [data-status]')) {
    b.addEventListener('click', () => setzeStatus(b.dataset.status));
  }

  // Add a tag by hand
  const tagAdd = () => {
    const feld = $('best-tag-feld');
    const t = normTag(feld.value);
    if (t && !zustand.tags.includes(t)) zustand.tags.push(t);
    feld.value = '';
    zeichneTags();
    zeichneTagVorschlaege(zustand.tagVorschlaege || []);
  };
  $('best-tag-add').addEventListener('click', tagAdd);
  $('best-tag-feld').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagAdd(); }
  });

  // Manual place search
  const suchen = async () => {
    const q = $('best-suche').value.trim();
    if (!q) return;
    $('best-status').textContent = 'Searching …';
    try {
      const j = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=8`)).json();
      const treffer = bewerteTreffer(j.results || [], {
        kandidatPunkte: 60, countries: zustand.countries || [],
      });
      if (!treffer.length) {
        $('best-status').textContent = 'Nothing found for that.';
        $('best-kandidaten').innerHTML = '';
        return;
      }
      $('best-status').textContent = `${treffer.length} ${treffer.length === 1 ? 'match' : 'matches'}:`;
      zeichneKandidaten(treffer);
      waehleOrt(treffer[0]);
    } catch (e) {
      $('best-status').textContent = 'The place search is not responding: ' + e.message;
    }
  };
  $('best-suche-go').addEventListener('click', suchen);
  $('best-suche').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); suchen(); }
  });

  // Clean up on close, so no iframe keeps loading in the background
  $('dlg-bestaetigen').addEventListener('close', () => {
    $('best-embed').innerHTML = '';
    vorschau?.aufraeumen();
    vorschau = null;
  });
}
