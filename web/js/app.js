/**
 * app.js — wiring. Keeps map, list, filter and dialogs in sync.
 */

import { store, STANDARD_EINSTELLUNGEN } from './store.js';
import { Karte, KACHELN } from './map.js';
import { starteHinzufuegen, verdrahteBestaetigung } from './addflow.js';
import {
  toast, toastWeg, filter, gefilterte,
  zeichneTagbar, zeichneListe, zeigeDetail, zeigeImport,
  exportiereJSON, exportiereHTML,
} from './ui.js';
import { leseDatei, leseLink } from './importers.js';

const $ = (id) => document.getElementById(id);

let karte = null;

/** Everything the submodules need from each other, in one place. */
const umgebung = {
  toast, toastWeg,
  get karte() { return karte; },
  neuZeichnen,
  zeigeDetail: (id) => zeigeDetail(id, umgebung),
  zeigeImport: (e, n) => zeigeImport(e, n, umgebung),
};

/* ================================================================== *
 * Drawing
 * ================================================================== */

function neuZeichnen() {
  const pins = gefilterte();
  karte?.zeichne(pins);
  zeichneListe(pins, (id) => zeigeDetail(id, umgebung));
  zeichneTagbar(neuZeichnen);
  $('karte-leer').hidden = store.db.pins.length > 0;
}

/* ================================================================== *
 * Switching views
 * ================================================================== */

function setzeAnsicht(name) {
  for (const btn of document.querySelectorAll('.segmented__btn[data-view]')) {
    const an = btn.dataset.view === name;
    btn.classList.toggle('is-active', an);
    btn.setAttribute('aria-selected', String(an));
  }
  for (const [view, id] of [['karte', 'ansicht-karte'], ['liste', 'ansicht-liste']]) {
    const el = $(id);
    const an = view === name;
    el.classList.toggle('is-active', an);
    // On large screens both are side by side; then hide nothing.
    el.hidden = an ? false : !window.matchMedia('(min-width: 780px)').matches ? true : false;
  }
  if (name === 'karte') karte?.neuMessen();
}

/* ================================================================== *
 * Start
 * ================================================================== */

async function start() {
  // 1) Load data
  try {
    const { konflikt } = await store.laden();
    if (konflikt) {
      toast('There were still unsaved changes in the browser. They have been applied.', 'info', 6000);
      store.uebernehmen(konflikt);
      await store.sichern();
    }
  } catch (e) {
    toast(e.message, 'fehler', 12000);
  }

  // 2) Map
  karte = new Karte('karte', {
    beiKlickPin: (id) => zeigeDetail(id, umgebung),
  });

  // 3) Wire up the interface
  verdrahteBestaetigung(umgebung);
  verdrahteEingabe();
  verdrahteAnsicht();
  verdrahteListe();
  verdrahteEinstellungen();
  verdrahteGeteiltes();

  neuZeichnen();
  if (store.db.pins.length && !store.einstellungen.letzteAnsicht) {
    karte.passeAn(store.db.pins);
  }

  // 4) Service worker: makes the app installable and usable offline
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not a problem */ });
  }

  // 5) Location for "Nearest first", only when sorting by it
  $('sortierung').addEventListener('change', () => {
    if ($('sortierung').value === 'nah' && !filter.standort && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          filter.standort = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          neuZeichnen();
        },
        () => toast('Without location access I cannot sort by distance.', 'info'),
        { timeout: 8000, maximumAge: 300000 }
      );
    }
  });
}

/* ================================================================== *
 * Input bar
 * ================================================================== */

function verdrahteEingabe() {
  const form = $('eingabe-form');
  const feld = $('eingabe-feld');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const wert = feld.value.trim();
    if (!wert) return;
    $('btn-go').disabled = true;
    try {
      await starteHinzufuegen(wert, umgebung);
      feld.value = '';
    } catch (err) {
      console.error(err);
      toast('Something went wrong: ' + err.message, 'fehler', 6000);
    } finally {
      $('btn-go').disabled = false;
    }
  });

  // Paste from the clipboard: the way to go on the iPhone and the
  // fallback on Android if the share menu does not offer the app.
  $('btn-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) { toast('The clipboard is empty.', 'info'); return; }
      feld.value = text.trim();
      form.requestSubmit();
    } catch {
      toast('The browser does not allow access to the clipboard. Please paste by hand.', 'info', 5000);
      feld.focus();
    }
  });

  // When returning to the app: is there an Instagram link in the clipboard?
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.clipboard?.readText) return;
    if (document.querySelector('dialog[open]')) return;
    if (feld.value.trim()) return;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (/instagram\.com\/(p|reel|reels|tv)\//i.test(text)) {
        const schon = store.db.pins.some((p) =>
          (p.posts || []).some((x) => x.url && text.includes(x.shortcode)));
        if (!schon) {
          feld.value = text;
          toast('Instagram link inserted from the clipboard.', 'info', 4000);
        }
      }
    } catch { /* permission denied, no problem */ }
  });
}

/* ================================================================== *
 * View and list
 * ================================================================== */

function verdrahteAnsicht() {
  for (const btn of document.querySelectorAll('.segmented__btn[data-view]')) {
    btn.addEventListener('click', () => setzeAnsicht(btn.dataset.view));
  }
  // Fix visibility when the width changes
  window.matchMedia('(min-width: 780px)').addEventListener('change', () => {
    const aktiv = document.querySelector('.segmented__btn[data-view].is-active');
    setzeAnsicht(aktiv?.dataset.view || 'karte');
  });
  setzeAnsicht('karte');
}

function verdrahteListe() {
  let tippTimer = null;
  $('suche').addEventListener('input', (e) => {
    clearTimeout(tippTimer);
    tippTimer = setTimeout(() => {
      filter.suche = e.target.value;
      neuZeichnen();
    }, 150);
  });
  $('sortierung').addEventListener('change', (e) => {
    filter.sortierung = e.target.value;
    neuZeichnen();
  });
}

/* ================================================================== *
 * Settings
 * ================================================================== */

function verdrahteEinstellungen() {
  const dlg = $('dlg-einstellungen');

  $('btn-einstellungen').addEventListener('click', () => {
    $('einst-radius').value = store.einstellungen.radiusM;
    $('einst-radius-out').value = `${store.einstellungen.radiusM} m`;
    $('einst-kacheln').value = store.einstellungen.kacheln;
    $('einst-import-status').textContent = '';
    dlg.showModal();
  });

  $('einst-radius').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('einst-radius-out').value = `${v} m`;
    store.setzeEinstellung('radiusM', v);
  });

  $('einst-kacheln').addEventListener('change', (e) => {
    const v = KACHELN[e.target.value] ? e.target.value : 'osm';
    store.setzeEinstellung('kacheln', v);
    karte?.setzeKacheln(v);
  });

  // --- Import from files ---
  $('einst-importdatei').addEventListener('change', async (e) => {
    const dateien = [...e.target.files];
    e.target.value = '';
    if (!dateien.length) return;

    const alle = [];
    const namen = [];
    for (const f of dateien) {
      try {
        const { eintraege, sicherung, name } = await leseDatei(f);
        if (sicherung) {
          store.uebernehmen(sicherung);
          await store.sichern();
          neuZeichnen();
          toast(`Backup restored: ${store.db.pins.length} places.`, 'gut');
          dlg.close();
          return;
        }
        alle.push(...eintraege);
        namen.push(name);
      } catch (err) {
        $('einst-import-status').textContent = `${f.name}: ${err.message}`;
      }
    }
    if (!alle.length) {
      $('einst-import-status').textContent = 'The files contained no places.';
      return;
    }
    dlg.close();
    zeigeImport(alle, namen.join(', '), umgebung);
  });

  // --- Import from a link ---
  $('einst-importlink-go').addEventListener('click', () => {
    const link = $('einst-importlink').value.trim();
    if (!link) return;
    try {
      const { name, eintraege } = leseLink(link);
      if (!eintraege.length) {
        $('einst-import-status').textContent = 'This link contains no place.';
        return;
      }
      $('einst-importlink').value = '';
      dlg.close();
      zeigeImport(eintraege, name, umgebung);
    } catch (err) {
      $('einst-import-status').textContent = err.message;
    }
  });

  // --- Backup ---
  $('einst-export').addEventListener('click', exportiereJSON);
  $('einst-export-html').addEventListener('click', exportiereHTML);

  $('einst-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!Array.isArray(j.pins)) throw new Error('This is not a backup of this app.');
      store.uebernehmen(j);
      await store.sichern();
      neuZeichnen();
      karte?.passeAn(store.db.pins);
      toast(`Backup restored: ${store.db.pins.length} places.`, 'gut');
      dlg.close();
    } catch (err) {
      toast('Could not read the backup: ' + err.message, 'fehler', 6000);
    }
  });

  // --- Keys ---
  $('einst-key-save').addEventListener('click', async () => {
    const wert = $('einst-key-liq').value.trim();
    try {
      await fetch('/api/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationiq: wert }),
      });
      $('einst-key-liq').value = '';
      toast(wert ? 'Key saved.' : 'Key removed.', 'gut');
    } catch (e) {
      toast('Saving failed: ' + e.message, 'fehler');
    }
  });
}

/* ================================================================== *
 * Shared content
 * ================================================================== */

function verdrahteGeteiltes() {
  const params = new URLSearchParams(location.search);
  const geteilt = params.get('shared') || params.get('url') || params.get('text');
  if (!geteilt) return;

  // Clean up the address bar so a reload does not create anything twice
  history.replaceState(null, '', location.pathname);
  $('eingabe-feld').value = geteilt.trim();
  // Wait briefly so the map is ready before a dialog opens
  setTimeout(() => $('eingabe-form').requestSubmit(), 350);
}

/* ================================================================== *
 * Go
 * ================================================================== */

start().catch((e) => {
  console.error(e);
  toast('Startup failed: ' + e.message, 'fehler', 0);
});

// For the self-test page and for experimenting in the console
window.Ortsammlung = { store, get karte() { return karte; }, neuZeichnen, filter, STANDARD_EINSTELLUNGEN };
