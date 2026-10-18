/**
 * app.js — wiring. Keeps map, list, filter and dialogs in sync.
 */

import { store, DEFAULT_SETTINGS, pruneTagFilter } from './store.js';
import { MainMap, TILES } from './map.js';
import { startAdd, isShortcutPaste } from './router.js';
import { addFromSettings, batchRunning, cancelBatch, STILL_READING } from './batch.js';
import { wireConfirm } from './confirm.js';
import { guideImportEntries } from './mapflow.js';
import {
  toast, hideToast, filter, filteredPins,
  drawTagBar, drawList, showDetail, showImport,
  exportBackup, showRestore, backupAgeLabel, linkShortcutInstall, showUnsupported, keepsEnter,
} from './ui.js';
import { readFile, skippedPlacesNotice } from './importers.js';
import { isInstagramLink, shortcode } from './dedupe.js';
import { findLinks } from './sources.js';
import { showsMoveBanner, newAddressUrl } from './address.js';
import { playPinwheel } from './pinwheel.js';
import { readBackupText, needsBackupReminder } from './backup.js';
import { APP_VERSION, compareVersions } from './version.js';
import { checkForUpdate, installUpdate } from './update.js';
import { onServerVersion } from './api.js';
import { loadPendingGuide, clearPendingGuide } from './appleplace.js';
import { linkGuideHelper } from './guidehelper.js';

const $ = (id) => document.getElementById(id);

let map = null;

/** Everything the submodules need from each other, in one place. */
const env = {
  toast, hideToast,
  get map() { return map; },
  redraw,
  showDetail: (id) => showDetail(id, env),
  showImport: (e, n, guide, notes) => showImport(e, n, env, guide, notes),
  showUnsupported,
  pinwheel: playPinwheel,
};

/* ================================================================== *
 * Drawing
 * ================================================================== */

function redraw() {
  pruneTagFilter(filter.tags, store.allTags().map((t) => t.name));
  const pins = filteredPins();
  map?.draw(pins);
  drawList(pins, (id) => showDetail(id, env));
  drawTagBar(redraw);
  $('map-empty').hidden = store.db.pins.length > 0;
}

/* ================================================================== *
 * Switching views
 * ================================================================== */

function setView(name) {
  for (const btn of document.querySelectorAll('.segmented__btn[data-view]')) {
    const isActive = btn.dataset.view === name;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  }
  for (const [view, id] of [['map', 'view-map'], ['list', 'view-list']]) {
    const el = $(id);
    const isActive = view === name;
    el.classList.toggle('is-active', isActive);
    // On large screens both are side by side; then hide nothing.
    el.hidden = isActive ? false : !window.matchMedia('(min-width: 780px)').matches ? true : false;
  }
  if (name === 'map') map?.remeasure();
}

/* ================================================================== *
 * Start
 * ================================================================== */

async function start() {
  // 1) Data
  await store.load();
  store.onSaveError = () => toast("Couldn't save. Please save a backup.", 'error', 8000);
  if (store.lastError) toast("Couldn't open phone storage. Pins won't be saved. Please save a backup.", 'error', 0);

  // 2) Map
  map = new MainMap('map', {
    onPinClick: (id) => showDetail(id, env),
  });

  // 3) Wire up the interface
  wireConfirm(env);
  wireInput();
  wireViews();
  wireList();
  wireSettings();
  wireShared();
  guardDialogEnter();
  linkShortcutInstall(document);
  linkGuideHelper(document, toast);

  redraw();
  if (store.db.pins.length && !store.settings.lastView) {
    map.fitTo(store.db.pins);
  }

  // 4) Backup reminder
  if (needsBackupReminder(store.settings.lastBackupAt, store.db.pins.length)) {
    $('backup-reminder-text').textContent =
      `${backupAgeLabel()}. Save one so your pins survive a lost phone.`;
    $('backup-reminder').hidden = false;
  }
  $('backup-reminder-save').addEventListener('click', async () => {
    if (await exportBackup()) $('backup-reminder').hidden = true;
  });
  $('backup-reminder-later').addEventListener('click', () => { $('backup-reminder').hidden = true; });

  // 4b) An Apple Guide import left for the Shortcuts app and the page was reloaded
  wireGuideReminder();

  // 4c) The old address: oPin moved, and the pins stay here until a backup takes them along.
  if (showsMoveBanner(location.hostname)) {
    $('move-open').href = newAddressUrl(location.href);
    $('move-reminder').hidden = false;
  }
  $('move-save').addEventListener('click', () => exportBackup());

  onServerVersion((v) => {
    if (compareVersions(v, APP_VERSION) > 0) $('btn-settings').classList.add('has-update');
  });

  // 5) Service worker: makes the app installable and usable offline
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* not a problem */ });
  }

  // 6) Location for "Nearest first", only when sorting by it
  $('sort').addEventListener('change', () => {
    if ($('sort').value === 'nearest' && !filter.location && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          filter.location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          redraw();
        },
        () => toast('Without location access I cannot sort by distance.', 'info'),
        { timeout: 8000, maximumAge: 300000 }
      );
    }
  });

  // Tells the startup guard in index.html that the app is running.
  window.__instaPinmapStarted = true;
}

/* ================================================================== *
 * Input bar
 * ================================================================== */

function wireInput() {
  const form = $('input-form');
  const field = $('input-field');
  let submitted = '';
  env.inputDone = () => { if (field.value.trim() === submitted) field.value = ''; };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = field.value.trim();
    if (!value || $('btn-go').disabled) return;
    $('btn-go').disabled = true;
    try {
      // The field is cleared by env.inputDone once something was saved; closing the dialog keeps the link.
      submitted = value;
      await startAdd(value, env);
    } catch (err) {
      console.error(err);
      toast('Something went wrong: ' + err.message, 'error', 6000);
    } finally {
      $('btn-go').disabled = false;
    }
  });

  // The Shortcut's output (a guide page of 290 KB, place pages, "@@" lines, a guide
  // link with results) goes straight to the add flow: the field would drop its line breaks.
  const addDirectly = async (text) => {
    $('btn-go').disabled = true;
    submitted = text.trim();
    try {
      await startAdd(text, env);
    } catch (err) {
      console.error(err);
      toast('Something went wrong: ' + err.message, 'error', 6000);
    } finally {
      $('btn-go').disabled = false;
    }
  };
  field.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if ($('btn-go').disabled || !isShortcutPaste(text)) return;
    e.preventDefault();
    addDirectly(text);
  });

  // Paste from the clipboard: the way to go on the iPhone and the
  // fallback on Android if the share menu does not offer the app.
  $('btn-paste').addEventListener('click', async () => {
    if ($('btn-go').disabled) return; // an add is still running
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast('Your browser blocked the clipboard. Tap the field, then tap Paste.', 'info', 6000);
      field.focus();
      return;
    }
    if (!text) { toast('The clipboard is empty.', 'info'); return; }
    if ($('btn-go').disabled) return;
    if (isShortcutPaste(text)) {
      await addDirectly(text);
      return;
    }
    field.value = text.trim();
    form.requestSubmit();
  });

  // When returning to the app: is there an Instagram link in the clipboard?
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (!navigator.clipboard?.readText) return;
    if (document.querySelector('dialog[open]')) return;
    if (field.value.trim()) return;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const link = findLinks(text)[0] || text;
      if (isInstagramLink(link) && shortcode(link)) {
        const alreadySaved = store.db.pins.some((p) =>
          (p.posts || []).some((x) => x.url && text.includes(x.shortcode)));
        if (!alreadySaved) {
          field.value = text;
          toast('Link inserted from the clipboard.', 'info', 4000);
        }
      }
    } catch { /* permission denied, no problem */ }
  });
}

/* ================================================================== *
 * View and list
 * ================================================================== */

function wireViews() {
  for (const btn of document.querySelectorAll('.segmented__btn[data-view]')) {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  }
  // Fix visibility when the width changes
  window.matchMedia('(min-width: 780px)').addEventListener('change', () => {
    const active = document.querySelector('.segmented__btn[data-view].is-active');
    setView(active?.dataset.view || 'map');
  });
  setView('map');
}

function wireList() {
  let typingTimer = null;
  $('search').addEventListener('input', (e) => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      filter.search = e.target.value;
      redraw();
    }, 150);
  });
  $('sort').addEventListener('change', (e) => {
    filter.sort = e.target.value;
    redraw();
  });
}

/* ================================================================== *
 * Settings
 * ================================================================== */

function wireSettings() {
  const dlg = $('dlg-settings');

  $('settings-version').textContent = APP_VERSION;
  let pendingUpdate = null;
  $('settings-update-check').addEventListener('click', async () => {
    $('settings-update-status').textContent = 'Checking …';
    $('settings-update-install').hidden = true;
    try {
      const u = await checkForUpdate();
      pendingUpdate = u.available ? u.info : null;
      $('settings-update-status').textContent = u.available
        ? `Version ${u.latest} is available.`
        : 'You have the latest version.';
      $('settings-update-install').hidden = !u.available;
    } catch (e) {
      $('settings-update-status').textContent = `Couldn't check: ${e.message}`;
    }
  });
  $('settings-update-install').addEventListener('click', async () => {
    if (!pendingUpdate) return;
    $('settings-update-status').textContent = 'Installing …';
    try {
      await installUpdate(pendingUpdate);
    } catch (e) {
      $('settings-update-status').textContent = `Install failed, nothing changed: ${e.message}`;
    }
  });

  const openSettings = () => {
    $('settings-radius').value = store.settings.radiusM;
    $('settings-radius-out').value = `${store.settings.radiusM} m`;
    $('settings-tiles').value = store.settings.tiles;
    $('settings-import-status').textContent = '';
    $('settings-backup-age').textContent = backupAgeLabel();
    dlg.showModal();
  };
  $('btn-settings').addEventListener('click', openSettings);

  $('settings-radius').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('settings-radius-out').value = `${v} m`;
    store.setSetting('radiusM', v);
  });

  $('settings-tiles').addEventListener('change', (e) => {
    const v = TILES[e.target.value] ? e.target.value : 'osm';
    store.setSetting('tiles', v);
    map?.setTiles(v);
  });

  // --- Import from files ---
  $('settings-import-file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;

    const all = [];
    const names = [];
    let skipped = 0; // places with neither coordinates nor a name
    for (const f of files) {
      try {
        const { entries, backup, name, skipped: dropped = 0 } = await readFile(f);
        if (backup) { dlg.close(); showRestore(backup, env); return; }
        all.push(...entries);
        names.push(name);
        skipped += dropped;
      } catch (err) {
        $('settings-import-status').textContent = `${f.name}: ${err.message}`;
      }
    }
    if (!all.length) {
      $('settings-import-status').textContent = 'The files contained no places.' + (skipped ? ` ${skippedPlacesNotice(skipped)}` : '');
      return;
    }
    dlg.close();
    showImport(all, names.join(', '), env, null, { skipped });
  });

  // --- Import from pasted links, posts, coordinates or Shortcut results: one import list ---
  // One batch at a time: Read waits while one is read; closing Settings stops it.
  const importPasted = async () => {
    if (batchRunning()) return;
    $('settings-import-link-go').disabled = true;
    try {
      await addFromSettings($('settings-import-link'), env, () => dlg.close());
    } catch (err) {
      console.error(err);
      toast('Something went wrong: ' + err.message, 'error', 6000);
    } finally {
      $('settings-import-link-go').disabled = false;
    }
  };
  $('settings-import-link-go').addEventListener('click', importPasted);
  dlg.addEventListener('close', cancelBatch);
  env.importOpen = () => $('dlg-import').open;
  // The input bar's paste of two or more items: here, in the box, and read at once.
  env.importPaste = (text) => {
    if (batchRunning()) {
      toast(STILL_READING, 'info', 6000);
      return undefined;
    }
    openSettings();
    $('settings-import-link').value = text;
    $('settings-import-link').scrollIntoView({ block: 'center' });
    return importPasted();
  };

  // --- Backup ---
  $('settings-export-html').addEventListener('click', async () => {
    if (await exportBackup()) {
      $('settings-backup-age').textContent = backupAgeLabel();
      $('backup-reminder').hidden = true;
    }
  });

  $('settings-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const backup = readBackupText(await f.text());
      dlg.close();
      showRestore(backup, env);
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  });
}

/* ================================================================== *
 * Apple Guide import waiting for the Shortcut
 * ================================================================== */

/** Offers to reopen a guide import (younger than 24 h) that the page lost on the way to the Shortcuts app. */
function wireGuideReminder() {
  const pending = loadPendingGuide();
  if (pending && !document.querySelector('dialog[open]')) {
    $('guide-reminder-text').textContent = pending.title
      ? `Continue the Apple Guide import: ${pending.title}`
      : 'Continue the Apple Guide import';
    $('guide-reminder').hidden = false;
  }
  $('guide-reminder-continue').addEventListener('click', () => {
    $('guide-reminder').hidden = true;
    const guide = loadPendingGuide();
    if (!guide) { toast('This import is older than a day. Paste the guide link again.', 'info', 6000); return; }
    showImport(guideImportEntries(guide), guide.title || 'Apple Guide', env, guide);
  });
  $('guide-reminder-discard').addEventListener('click', () => {
    clearPendingGuide();
    $('guide-reminder').hidden = true;
  });
}

/* ================================================================== *
 * Shared content
 * ================================================================== */

/** Enter in a field of a dialog form (text, colour swatch, checkbox) would submit it and close the dialog. */
function guardDialogEnter() {
  for (const form of document.querySelectorAll('dialog form')) {
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && keepsEnter(e.target)) e.preventDefault();
    });
  }
}

function wireShared() {
  const params = new URLSearchParams(location.search);
  const shared = params.get('url') || params.get('text') || params.get('title') || params.get('shared');
  const focus = params.get('focus') === 'input';
  if (shared || focus) history.replaceState(null, '', location.pathname);
  if (focus) $('input-field').focus();
  if (!shared) return;
  $('input-field').value = [params.get('url'), params.get('text')].filter(Boolean).join(' ').trim() || shared.trim();
  // Wait a moment so the map stands before a dialog opens
  setTimeout(() => $('input-form').requestSubmit(), 350);
}

/* ================================================================== *
 * Go
 * ================================================================== */

start().catch((e) => {
  console.error(e);
  toast('Startup failed: ' + e.message, 'error', 0);
  window.__instaPinmapStartFailed?.(); // the startup guard's "Reinstall app files" banner
});

// For the self-test page and for experimenting in the console
window.InstaPinmap = { store, get map() { return map; }, redraw, filter, DEFAULT_SETTINGS };
