/**
 * ui.js — list view, tag filter, pin details, settings, import, notifications.
 */

import { store, normTag } from './store.js';
import { embedLink, distanceM, distanceText, shortcode } from './dedupe.js';
import { searchPlaces } from './geocode.js';
import { resolveShortLink } from './api.js';
import { googleCoordinates, isAppleIdLink } from './importers.js';
import {
  shortcutInput, SHORTCUT_RUN_URL, parseShortcutPaste, applyShortcutResults, appleIdOf,
  savePendingGuide, clearPendingGuide,
} from './appleplace.js';
import { formatDay } from './extract.js';

const $ = (id) => document.getElementById(id);

/* ================================================================== *
 * Notifications
 * ================================================================== */

let toastTimer = null;

/**
 * The toast is a popover, so it lives in the top layer like modal dialogs.
 * Showing it again after each message puts it above a dialog opened earlier.
 * Without popover support it moves into the open dialog instead.
 */
function placeToast(el) {
  if (typeof el.showPopover === 'function') {
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    } catch { /* stays a normal element */ }
    return;
  }
  const open = [...document.querySelectorAll('dialog[open]')].pop();
  const home = open || document.body;
  if (el.parentElement !== home) home.appendChild(el);
}

export function toast(text, kind = 'info', durationMs = 3200) {
  const el = $('toast');
  el.textContent = text;
  el.dataset.kind = kind;
  placeToast(el);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  if (durationMs > 0) toastTimer = setTimeout(() => el.classList.remove('is-on'), durationMs);
}

export function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.remove('is-on');
}

/* ================================================================== *
 * Filter state
 * ================================================================== */

export const filter = {
  tags: new Set(),
  search: '',
  sort: 'newest',
  location: null,     // { lat, lon } if known
};

export function filteredPins() {
  const q = filter.search.trim().toLowerCase();
  let pins = store.db.pins;

  if (filter.tags.size) {
    pins = pins.filter((p) => (p.tags || []).some((t) => filter.tags.has(t)));
  }

  if (q) {
    pins = pins.filter((p) => {
      const haystack = [
        p.title, p.address, p.note, p.when,
        ...(p.tags || []),
        ...(p.posts || []).map((x) => `${x.caption} ${x.username}`),
      ].join(' ').toLowerCase();
      return q.split(/\s+/).every((word) => haystack.includes(word));
    });
  }

  const s = [...pins];
  switch (filter.sort) {
    case 'oldest': s.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); break;
    case 'title':  s.sort((a, b) => a.title.localeCompare(b.title, 'de')); break;
    case 'nearest':
      if (filter.location) {
        const { lat, lon } = filter.location;
        s.sort((a, b) => distanceM(lat, lon, a.lat, a.lon) - distanceM(lat, lon, b.lat, b.lon));
      }
      break;
    default:       s.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  return s;
}

/* ================================================================== *
 * Tag filter bar
 * ================================================================== */

export function drawTagBar(onChange) {
  const bar = $('tagbar');
  const list = $('tagbar-list');
  const tags = store.allTags();

  bar.hidden = tags.length === 0;
  list.innerHTML = '';

  if (!tags.length) return;

  // "All" to reset
  const allLi = document.createElement('li');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'tagchip';
  allBtn.setAttribute('aria-pressed', String(filter.tags.size === 0));
  allBtn.innerHTML = `<span>All</span> <span class="tagchip__count">${store.db.pins.length}</span>`;
  allBtn.addEventListener('click', () => { filter.tags.clear(); onChange(); });
  allLi.appendChild(allBtn);
  list.appendChild(allLi);

  for (const t of tags) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tagchip';
    btn.setAttribute('aria-pressed', String(filter.tags.has(t.name)));
    const dot = document.createElement('span');
    dot.className = 'tagchip__dot';
    dot.style.background = t.color;
    const name = document.createElement('span');
    name.textContent = t.name;
    const count = document.createElement('span');
    count.className = 'tagchip__count';
    count.textContent = String(t.count);
    btn.append(dot, name, count);
    btn.addEventListener('click', () => {
      if (filter.tags.has(t.name)) filter.tags.delete(t.name);
      else filter.tags.add(t.name);
      onChange();
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

/* ================================================================== *
 * List view
 * ================================================================== */

export function drawList(pins, onClick) {
  const ol = $('list');
  const counter = $('list-count');
  ol.innerHTML = '';

  const total = store.db.pins.length;
  counter.textContent = total === 0
    ? ''
    : pins.length === total
      ? `${total} ${total === 1 ? 'place' : 'places'}`
      : `${pins.length} of ${total} places`;

  if (!pins.length) {
    const li = document.createElement('li');
    li.className = 'list__empty';
    li.textContent = total === 0
      ? 'Nothing saved yet. Paste an Instagram link below.'
      : 'No place matches this filter.';
    ol.appendChild(li);
    return;
  }

  for (const pin of pins) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'entry';

    const dot = document.createElement('span');
    dot.className = 'entry__dot';
    dot.style.background = store.pinColor(pin);

    const title = document.createElement('p');
    title.className = 'entry__title';
    title.textContent = pin.title;

    const meta = document.createElement('p');
    meta.className = 'entry__meta';
    const count = (pin.posts || []).length;
    meta.textContent = [
      pin.address || `${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}`,
      count > 1 ? `${count} posts` : null,
      pin.when ? `📅 ${pin.when}` : null,
    ].filter(Boolean).join(' · ');

    const right = document.createElement('span');
    right.className = 'entry__right';
    const st = document.createElement('span');
    st.className = 'entry__status';
    st.dataset.status = pin.status;
    st.textContent = pin.status === 'visited' ? 'been there' : 'want to go';
    right.appendChild(st);
    if (filter.sort === 'nearest' && filter.location) {
      const d = document.createElement('span');
      d.textContent = distanceText(distanceM(filter.location.lat, filter.location.lon, pin.lat, pin.lon));
      right.appendChild(d);
    }

    btn.append(dot, title, meta, right);

    if ((pin.tags || []).length) {
      const tagUl = document.createElement('ul');
      tagUl.className = 'entry__tags';
      for (const t of pin.tags) {
        const tli = document.createElement('li');
        tli.className = 'entry__tag';
        tli.textContent = t;
        tagUl.appendChild(tli);
      }
      btn.appendChild(tagUl);
    }

    btn.addEventListener('click', () => onClick(pin.id));
    li.appendChild(btn);
    ol.appendChild(li);
  }
}

/* ================================================================== *
 * Pin details
 * ================================================================== */

let detailPinId = null;

export function showDetail(pinId, env) {
  const pin = store.pin(pinId);
  if (!pin) return;
  detailPinId = pinId;

  const dlg = $('dlg-detail');
  const body = $('detail-body');
  $('dlg-detail-title').textContent = pin.title;
  body.innerHTML = '';

  // --- Title ---
  body.appendChild(field('Title', () => {
    const i = document.createElement('input');
    i.type = 'text';
    i.id = 'detail-title';
    i.value = pin.title;
    return i;
  }));

  // --- When ---
  body.appendChild(field('When', () => {
    const i = document.createElement('input');
    i.type = 'text';
    i.id = 'detail-when';
    i.maxLength = 100;
    i.autocomplete = 'off';
    i.placeholder = 'e.g. 14–16 Sep 2026';
    i.value = pin.when || '';
    return i;
  }));

  // --- Address and coordinates ---
  const addr = document.createElement('div');
  addr.className = 'field';
  const a1 = document.createElement('p');
  a1.className = 'detail__address';
  a1.textContent = pin.address || '(no address stored)';
  const a2 = document.createElement('p');
  a2.className = 'detail__coords';
  a2.textContent = `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`;
  const row = document.createElement('div');
  row.className = 'buttonrow';
  row.append(
    linkButton('Open in OpenStreetMap', `https://www.openstreetmap.org/?mlat=${pin.lat}&mlon=${pin.lon}#map=17/${pin.lat}/${pin.lon}`),
    linkButton('Directions (Google)', `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lon}`),
  );
  addr.append(a1, a2, row);
  body.appendChild(addr);

  // --- Status ---
  const statusField = document.createElement('div');
  statusField.className = 'field';
  const statusLabel = document.createElement('span');
  statusLabel.className = 'field__label';
  statusLabel.textContent = 'Status';
  const statusGroup = document.createElement('div');
  statusGroup.className = 'segmented segmented--full';
  statusGroup.setAttribute('role', 'radiogroup');
  statusGroup.setAttribute('aria-label', 'Status');
  for (const [value, text] of [['wishlist', 'Want to go'], ['visited', 'Been there']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.className = 'segmented__btn' + (pin.status === value ? ' is-active' : '');
    b.setAttribute('aria-checked', String(pin.status === value));
    b.dataset.status = value;
    b.textContent = text;
    b.addEventListener('click', () => {
      for (const x of statusGroup.children) {
        const isActive = x === b;
        x.classList.toggle('is-active', isActive);
        x.setAttribute('aria-checked', String(isActive));
      }
    });
    statusGroup.appendChild(b);
  }
  statusField.append(statusLabel, statusGroup);
  body.appendChild(statusField);

  // --- Note ---
  body.appendChild(field('Note', () => {
    const t = document.createElement('textarea');
    t.id = 'detail-note';
    t.rows = 3;
    t.value = pin.note || '';
    return t;
  }));

  // --- Tags ---
  const tagField = document.createElement('div');
  tagField.className = 'field';
  const tagLabel = document.createElement('span');
  tagLabel.className = 'field__label';
  tagLabel.textContent = 'Tags';
  const tagUl = document.createElement('ul');
  tagUl.className = 'chips';
  let tags = [...(pin.tags || [])];

  const drawChips = () => {
    tagUl.innerHTML = '';
    for (const t of tags) {
      const li = document.createElement('li');
      li.className = 'chip';
      li.style.borderColor = store.tagColor(t);
      const s = document.createElement('span');
      s.textContent = t;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip__x';
      x.setAttribute('aria-label', `Remove tag ${t}`);
      x.textContent = '×';
      x.addEventListener('click', () => { tags = tags.filter((a) => a !== t); drawChips(); });
      li.append(s, x);
      tagUl.appendChild(li);
    }
  };
  drawChips();

  const tagEntry = document.createElement('div');
  tagEntry.className = 'taginput';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = 'Add tag …';
  tagInput.setAttribute('list', 'tag-datalist');
  const tagBtn = document.createElement('button');
  tagBtn.type = 'button';
  tagBtn.className = 'btn btn--small';
  tagBtn.textContent = '+';
  const tagAdd = () => {
    const t = normTag(tagInput.value);
    if (t && !tags.includes(t)) tags.push(t);
    tagInput.value = '';
    drawChips();
  };
  tagBtn.addEventListener('click', tagAdd);
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagAdd(); }
  });
  tagEntry.append(tagInput, tagBtn);
  tagField.append(tagLabel, tagUl, tagEntry);
  body.appendChild(tagField);

  // --- Posts ---
  if ((pin.posts || []).length) {
    const h = document.createElement('p');
    h.className = 'field__label';
    h.textContent = pin.posts.length === 1 ? '1 post at this place' : `${pin.posts.length} posts at this place`;
    body.appendChild(h);

    const ul = document.createElement('ul');
    ul.className = 'detail__posts';
    for (const post of pin.posts) {
      const li = document.createElement('li');
      li.className = 'detail__post';

      const embed = embedLink(post.url);
      if (embed) {
        const f = document.createElement('iframe');
        f.src = embed;
        f.loading = 'lazy';
        f.title = `Instagram post by ${post.username || 'unknown'}`;
        f.referrerPolicy = 'no-referrer';
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        li.appendChild(f);
      }

      const foot = document.createElement('div');
      foot.className = 'detail__postfoot';
      const a = document.createElement('a');
      a.href = post.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = post.username ? `@${post.username}` : 'Open on Instagram';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--small btn--danger';
      del.textContent = 'Remove post';
      del.addEventListener('click', () => {
        // The dialog is drawn again below: keep title, when, note, status and tag edits first.
        if (snapshot() !== initial) store.updatePin(pin.id, formValues());
        store.removePost(pin.id, post.url);
        env.redraw();
        showDetail(pin.id, env);
      });
      foot.append(a);
      const posted = formatDay(post.postedAt);
      if (posted) {
        const date = document.createElement('span');
        date.className = 'detail__coords';
        date.textContent = `Posted ${posted}`;
        foot.append(date);
      }
      foot.append(del);
      li.appendChild(foot);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  // --- Footer buttons ---
  function formValues() {
    const active = statusGroup.querySelector('[aria-checked="true"]');
    return {
      title: $('detail-title').value.trim() || pin.title,
      when: $('detail-when').value.trim().slice(0, 100),
      note: $('detail-note').value.trim(),
      status: active?.dataset.status || pin.status,
      tags,
    };
  }

  $('detail-save').onclick = () => {
    store.updatePin(pin.id, formValues());
    dlg.close();
    env.redraw();
    toast('Saved.', 'success');
  };

  $('detail-delete').onclick = () => {
    // No window.confirm: it blocks and looks bad on a phone.
    const btn = $('detail-delete');
    if (btn.dataset.confirm === 'yes') {
      store.deletePin(pin.id);
      dlg.close();
      env.redraw();
      toast(`"${pin.title}" deleted.`, 'info');
      return;
    }
    btn.dataset.confirm = 'yes';
    btn.textContent = 'Really delete?';
    setTimeout(() => {
      btn.dataset.confirm = '';
      btn.textContent = 'Delete';
    }, 4000);
  };

  const snapshot = () => JSON.stringify({
    title: $('detail-title').value.trim(),
    when: $('detail-when').value.trim(),
    note: $('detail-note').value.trim(),
    status: statusGroup.querySelector('[aria-checked="true"]')?.dataset.status,
    tags,
  });
  const initial = snapshot();
  const warnUnsaved = () => { $('detail-unsaved').hidden = false; };
  $('detail-unsaved').hidden = true;
  $('detail-close').onclick = () => (snapshot() === initial ? dlg.close('close') : warnUnsaved());
  dlg.oncancel = (e) => { if (snapshot() !== initial) { e.preventDefault(); warnUnsaved(); } };
  $('detail-unsaved-save').onclick = () => $('detail-save').click();
  $('detail-unsaved-discard').onclick = () => { $('detail-unsaved').hidden = true; dlg.close('close'); };

  dlg.showModal();
}

function field(label, makeElement) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const s = document.createElement('span');
  s.className = 'field__label';
  s.textContent = label;
  wrap.append(s, makeElement());
  return wrap;
}

function linkButton(text, href) {
  const a = document.createElement('a');
  a.className = 'btn btn--small';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

/* ================================================================== *
 * Import dialog
 * ================================================================== */

/**
 * @param {Array} entries  import rows; `checked: false` starts a row unchecked
 * @param {{title, entries, appleIds} | null} guide  an Apple Guide with Apple Maps
 *   places still to look up: shows the Shortcut notice and keeps the guide for 24 h
 */
export function showImport(entries, sourceName, env, guide = null) {
  const dlg = $('dlg-import');
  const list = $('import-list');
  $('dlg-import-title').textContent = sourceName ? `Import: ${sourceName}` : 'Places found';

  const checked = entries.map((e) => e.checked !== false);
  const noCoords = (e) => !Number.isFinite(e.lat) || !Number.isFinite(e.lon);

  const drawInfo = () => {
    const open = entries.filter((e) => noCoords(e) && isAppleIdLink(e.url)).length;
    const toLookUp = entries.filter(noCoords).length - open;
    const notes = [];
    if (toLookUp) notes.push(`${toLookUp} of them have no coordinates; these will be looked up on import`);
    if (open) notes.push(`${open} Apple Maps ${open === 1 ? 'place still needs a lookup and is' : 'places still need a lookup and are'} unchecked`);
    $('import-info').textContent =
      `${entries.length} ${entries.length === 1 ? 'place' : 'places'} found` +
      (notes.length ? ` — ${notes.join('; ')}.` : '.');
  };

  const updateApply = () => {
    $('import-apply').disabled = !checked.some(Boolean);
  };

  const drawRows = () => {
    list.innerHTML = '';
    entries.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'importrow';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked[i];
      cb.id = `imp-${i}`;
      cb.dataset.index = String(i);

      const lab = document.createElement('label');
      lab.className = 'importrow__name';
      lab.htmlFor = cb.id;
      lab.textContent = e.name;

      const addr = document.createElement('span');
      addr.className = 'importrow__address';
      addr.textContent = e.address ||
        (Number.isFinite(e.lat) ? `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}` : '');

      li.append(cb, lab, addr);

      if (e.warning) {
        const w = document.createElement('span');
        w.className = 'importrow__warning';
        w.textContent = e.warning;
        li.appendChild(w);
      }
      list.appendChild(li);
    });
    updateApply();
  };

  const setAllChecked = (value) => {
    checked.fill(value);
    for (const cb of list.querySelectorAll('input[type=checkbox]')) cb.checked = value;
    updateApply();
  };
  list.onchange = (ev) => {
    const i = Number(ev.target?.dataset?.index);
    if (Number.isInteger(i)) checked[i] = ev.target.checked;
    updateApply();
  };
  $('import-all').onclick = () => setAllChecked(true);
  $('import-none').onclick = () => setAllChecked(false);

  drawInfo();
  drawRows();
  wireAppleLookup(guide, entries, (results) => {
    entries.forEach((e, i) => { if (results.has(appleIdOf(e.url))) checked[i] = true; });
    drawInfo();
    drawRows();
  });

  // The guide waits in storage until this dialog is done with it, so a trip to
  // the Shortcuts app survives iOS unloading the page.
  if (guide) savePendingGuide(guide);
  dlg.onclose = () => {
    dlg.onclose = null;
    if (guide) {
      clearPendingGuide();
      $('guide-reminder').hidden = true;
    }
  };

  $('import-apply').onclick = async () => {
    const selected = entries.filter((_, i) => checked[i]);
    dlg.close();
    await applyImport(selected, sourceName, env);
  };

  dlg.showModal();
}

/** Opens an app link such as shortcuts://… the way a tapped link would. */
function openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The notice above the import list for a guide's Apple Maps places: hands the
 * places to the iPhone Shortcut and takes its results back. Clipboard access
 * happens right in the tap handlers (iOS allows it only there); where it is
 * refused, a text box takes its place.
 */
function wireAppleLookup(guide, entries, onResults) {
  const box = $('import-apple');
  box.hidden = !guide;
  $('import-apple-copy').hidden = true;
  $('import-apple-manual').hidden = true;
  $('import-apple-open-row').hidden = true;
  // A real link as a second way in, should iOS block opening Shortcuts from script.
  $('import-apple-open').href = SHORTCUT_RUN_URL;
  $('import-apple-results').value = '';
  if (!guide) return;

  const total = guide.appleIds.length;
  $('import-apple-text').textContent =
    `${total} ${total === 1 ? 'place is an Apple Maps place' : 'places are Apple Maps places'}. ` +
    "Apple doesn't share them with this app's helper. Look them up from your phone or a computer:";
  const input = shortcutInput(guide.appleIds);

  $('import-apple-shortcut').onclick = async () => {
    try {
      await navigator.clipboard.writeText(input);
    } catch {
      $('import-apple-list').value = input;
      $('import-apple-copy').hidden = false;
      $('import-apple-list').focus();
      $('import-apple-list').select();
      return;
    }
    $('import-apple-open-row').hidden = false;
    openExternal(SHORTCUT_RUN_URL);
  };
  $('import-apple-run').onclick = () => openExternal(SHORTCUT_RUN_URL);

  const useResults = (text) => {
    const results = parseShortcutPaste(text, guide.appleIds);
    const found = applyShortcutResults(entries, results);
    onResults(results);
    toast(`Found ${found} of ${total} ${total === 1 ? 'place' : 'places'}.`, found ? 'success' : 'info', 5000);
    return found;
  };
  $('import-apple-paste').onclick = async () => {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      $('import-apple-manual').hidden = false;
      $('import-apple-results').focus();
      return;
    }
    // Nothing usable in the clipboard: offer the text box as well.
    if (!useResults(text)) $('import-apple-manual').hidden = false;
  };
  $('import-apple-use').onclick = () => {
    if (useResults($('import-apple-results').value)) $('import-apple-manual').hidden = true;
  };
}

async function applyImport(entries, sourceName, env) {
  let created = 0;
  let skipped = 0;
  const failed = [];
  const radius = store.settings.radiusM;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    toast(`Importing ${i + 1} of ${entries.length} …`, 'info', 0);

    let lat = e.lat;
    let lon = e.lon;

    // Resolve short link
    if (!Number.isFinite(lat) && e.url && /goo\.gl|maps\.apple\/|g\.co/i.test(e.url)) {
      const j = await resolveShortLink(e.url);
      if (j.ok && j.url) {
        const k = googleCoordinates(j.url);
        if (k) { lat = k.lat; lon = k.lon; }
      }
    }

    // Search by name — not for Apple Maps places the guide names only by ID
    // ("Apple Maps place" would find something random).
    if (!Number.isFinite(lat) && !isAppleIdLink(e.url)) {
      const q = [e.name, e.address].filter(Boolean).join(', ');
      const j = await searchPlaces(q, { limit: 1 });
      const t = (j.results || [])[0];
      if (t) { lat = t.lat; lon = t.lon; if (!e.address) e.address = t.address; }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      failed.push(e.name);
      continue;
    }

    // Is there already something at this spot? During a batch import, don't ask;
    // silently skip very close duplicates instead.
    const nearby = store.db.pins.find(
      (p) => distanceM(lat, lon, p.lat, p.lon) < Math.min(radius, 60)
    );
    if (nearby) { skipped++; continue; }

    const tags = [];
    if (e.tagSuggestion) { const t = normTag(e.tagSuggestion); if (t) tags.push(t); }

    store.addPin({
      lat, lon,
      title: e.name,
      address: e.address || '',
      note: e.note || '',
      tags,
      source: e.source || 'import',
    });
    created++;
  }

  const saved = await store.save();
  env.redraw();
  hideToast();
  if (!saved.ok) return;

  const parts = [`${created} ${created === 1 ? 'place' : 'places'} imported`];
  if (skipped) parts.push(`${skipped} skipped as duplicates`);
  if (failed.length) parts.push(`${failed.length} left without coordinates`);
  toast(parts.join(', ') + '.', failed.length ? 'error' : 'success', 6000);

  if (created) env.map?.fitTo(store.db.pins);
}

/* ================================================================== *
 * Backup
 * ================================================================== */

/** Offers the file as a download (computers, Firefox). The link must outlive the user's tap on "Download". */
function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

import { buildBackupHtml, backupAgeText } from './backup.js';

async function fetchText(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} could not be loaded`);
  return r.text();
}

/**
 * Builds the backup file and hands it over: via the share sheet where the
 * browser can share files (phones), otherwise as a download.
 * Returns true when the backup was handed over, false otherwise.
 */
export async function exportBackup() {
  toast('Building the backup …', 'info', 0);
  let file;
  try {
    const [leafletJs, leafletCss] = await Promise.all([
      fetchText('/vendor/leaflet/leaflet.js'),
      fetchText('/vendor/leaflet/leaflet.css'),
    ]);
    const html = buildBackupHtml(store.db, { leafletJs, leafletCss, colorOf: (p) => store.pinColor(p) });
    const date = new Date().toISOString().slice(0, 10);
    file = new File([html], `insta-pinmap-${date}.html`, { type: 'text/html' });
  } catch (e) {
    toast("Couldn't build the backup: " + e.message, 'error');
    return false;
  }

  let canShare = false;
  try { canShare = Boolean(navigator.canShare?.({ files: [file] })); } catch { /* no file sharing */ }
  if (canShare) {
    hideToast();
    try {
      await navigator.share({ files: [file], title: 'Insta Pinmap backup' });
      store.setSetting('lastBackupAt', new Date().toISOString());
      toast('Backup saved.', 'success', 6000);
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') {
        toast('Backup not saved.', 'info', 4000);
        return false;
      }
      // Share sheet refused (e.g. NotAllowedError): offer the download instead.
    }
  }

  download(file);
  store.setSetting('lastBackupAt', new Date().toISOString());
  toast('Backup file created. Keep it somewhere safe (Files, iCloud Drive, Google Drive).', 'success', 6000);
  return true;
}

/** Asks how to load a backup: merge (default) or replace everything (tap twice). */
export function showRestore(backupDb, env) {
  const dlg = $('dlg-restore');
  const count = (backupDb.pins || []).length;
  $('restore-text').textContent =
    `This backup has ${count} ${count === 1 ? 'place' : 'places'}. You have ${store.db.pins.length} now.`;
  const replaceBtn = $('restore-replace');
  replaceBtn.textContent = 'Replace everything';
  replaceBtn.dataset.confirm = '';
  replaceBtn.onclick = () => {
    if (replaceBtn.dataset.confirm === 'yes') { dlg.close('replace'); return; }
    replaceBtn.dataset.confirm = 'yes';
    replaceBtn.textContent = `Tap again: delete my ${store.db.pins.length} pins and load the backup`;
  };
  dlg.onclose = async () => {
    dlg.onclose = null;
    let message;
    if (dlg.returnValue === 'merge') {
      const r = store.mergeIn(backupDb);
      message = `Added ${r.added}, updated ${r.updated}, skipped ${r.skipped}.`;
    } else if (dlg.returnValue === 'replace') {
      store.replaceAll(backupDb);
      message = `Backup loaded: ${store.db.pins.length} places.`;
    } else {
      return;
    }
    const saved = await store.save();
    env.redraw();
    env.map?.fitTo(store.db.pins);
    if (saved.ok) toast(message, 'success', 6000);
  };
  dlg.returnValue = '';
  dlg.showModal();
}

export function backupAgeLabel() {
  return `Last backup: ${backupAgeText(store.settings.lastBackupAt)}`;
}
