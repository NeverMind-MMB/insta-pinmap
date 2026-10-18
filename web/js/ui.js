/**
 * ui.js — list view, tag filter, pin details, settings, import, notifications.
 */

import { store, normTag, PIN_COLORS, pinColorValue } from './store.js';
import { embedLink, distanceM, distanceText, shortcode } from './dedupe.js';
import { searchPlaces } from './geocode.js';
import { resolveShortLink } from './api.js';
import { googleCoordinates, googlePlaceName, isAppleIdLink, isGoogleShortLink, skippedPlacesNotice } from './importers.js';
import { needsMapAppLookup, lookUpMapAppEntry } from './maplinks.js';
import {
  SHORTCUT_RUN_URL, SHORTCUT_INSTALL_URL, applyPasteToGuide, appleIdOf,
  savePendingGuide, clearPendingGuide, shortcutInput, foundAppleIds, missingAppleIds,
  lookupState, lookupNotice, lookupButton, rememberRequested, copiedNotice,
} from './appleplace.js';
import { formatDay } from './extract.js';
import { SUPPORTED_SOURCES, issuesSearchUrl, siteOf, sourceColor, UNKNOWN_SOURCE_COLOR, pinLook, linkSourceName } from './sources.js';
import { postLinkText, postSiteName } from './postlinks.js';

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
      ? 'Nothing saved yet. Paste a link below.'
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

  // --- Colour: Auto (the source's) or one of the palette ---
  const colorField = document.createElement('div');
  colorField.className = 'field';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'field__label';
  colorLabel.textContent = 'Colour';
  const colorChoice = colorPicker('detail-color', { auto: sourceColor(pin.source), value: pinColorValue(pin.color) });
  colorField.append(colorLabel, colorChoice);
  body.appendChild(colorField);

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
      // YouTube/Facebook by postlinks.js; Instagram and TikTok by their username or the source's name.
      a.textContent = postSiteName(post.url)
        ? postLinkText(post.url, post.username)
        : (post.username ? `@${post.username}` : `Open on ${linkSourceName(post.url) || 'Instagram'}`);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--small btn--danger';
      del.textContent = 'Remove post';
      del.addEventListener('click', () => {
        // The dialog is drawn again below: keep title, when, note, tag and colour edits first.
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
    return {
      title: $('detail-title').value.trim() || pin.title,
      when: $('detail-when').value.trim().slice(0, 100),
      note: $('detail-note').value.trim(),
      tags,
      color: pickedColor(colorChoice),
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
    tags,
    color: pickedColor(colorChoice),
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

/** Source names the callers of showImport use when there is no real one: no tag from them. */
const STAND_IN_NAMES = new Set(['', 'apple guide', 'places found', 'apple maps places']);
/** Names importers.js gives a place without one (a Google short link, a list row without a title). */
const STAND_IN_PLACE_NAMES = new Set(['Google place', 'Untitled']);
const IMPORT_FILE_EXTENSION = /\.(csv|tsv|json|geojson|kml|kmz|gpx|zip)(?=,|$)/gi;

/**
 * The tag an import starts with: the guide or list name (a file name without
 * its extension), normalized; '' for a stand-in name and for several files
 * (app.js joins their names with ", "), whose lists each keep their own tag.
 */
export function importTag(sourceName) {
  const s = String(sourceName ?? '');
  if ((s.match(IMPORT_FILE_EXTENSION) || []).length > 1) return '';
  const name = s.replace(IMPORT_FILE_EXTENSION, '').trim();
  return STAND_IN_NAMES.has(name.toLowerCase()) ? '' : cleanTag(name);
}

/** normTag without the stray hyphens emoji or "&" leave: runs collapsed, none at the ends. */
function cleanTag(text) {
  return normTag(text).replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * @param {Array} entries  import rows; `checked: false` starts a row unchecked
 * @param {{title, link, entries, appleIds} | null} guide  an Apple Guide with Apple Maps
 *   places still to look up: shows the Shortcut notice and keeps the guide for 24 h
 * @param {number} skipped  places the files named with neither coordinates nor a name (left out)
 */
export function showImport(entries, sourceName, env, guide = null, skipped = 0) {
  const dlg = $('dlg-import');
  const list = $('import-list');
  $('dlg-import-title').textContent = sourceName ? `Import: ${sourceName}` : 'Places found';
  $('import-tag').value = importTag(sourceName);
  // One colour for the new pins; Auto shows the rows' source colour when they share one.
  const rowColors = new Set(entries.map((e) => sourceColor(e.source)));
  const colorChoice = colorPicker('import-color-choice', {
    label: 'Colour for these places', auto: rowColors.size === 1 ? [...rowColors][0] : UNKNOWN_SOURCE_COLOR,
  });
  $('import-color').replaceChildren(colorChoice);

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
      (notes.length ? ` — ${notes.join('; ')}.` : '.') +
      (skipped ? ` ${skippedPlacesNotice(skipped)}` : '');
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
  // What the rows already have (a reopened pending guide, a paste in the input bar).
  if (guide) guide.found = foundAppleIds(guide.appleIds, entries);
  wireAppleLookup(guide, entries, (results) => {
    entries.forEach((e, i) => {
      if (i >= checked.length) checked.push(e.checked !== false); // a place only the guide page had
      else if (results.has(appleIdOf(e.url))) checked[i] = true;
    });
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
    const tag = $('import-tag').value;
    const color = pickedColor(colorChoice);
    dlg.close();
    await applyImport(selected, sourceName, env, tag, color);
  };

  dlg.showModal();
}

/**
 * True for a field where Enter must not submit its dialog's form (whose first
 * button is the ✕, so Enter would cancel): every input, colour swatches and
 * checkboxes included, but not a file picker or a button.
 */
export function keepsEnter(target) {
  return target?.tagName === 'INPUT' && !['file', 'button', 'submit', 'reset', 'image'].includes(target.type);
}

/**
 * A pin colour choice as native radios (arrow keys move between them, each
 * named for screen readers): "Auto" first, drawn in the source's colour
 * (`auto`), then the palette. `value`: the pin's colour, '' for Auto.
 * Read it with pickedColor.
 */
export function colorPicker(name, { label = 'Colour', auto = UNKNOWN_SOURCE_COLOR, value = '' } = {}) {
  const box = document.createElement('div');
  box.className = 'swatches';
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-label', label);
  box.dataset.value = value;
  for (const option of [{ name: 'Auto (source colour)', color: '' }, ...PIN_COLORS]) {
    const swatch = document.createElement('label');
    swatch.className = 'swatch';
    swatch.title = option.name;
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.color;
    input.checked = option.color === value;
    const dot = document.createElement('span');
    dot.className = option.color ? 'swatch__dot' : 'swatch__dot swatch__dot--auto';
    dot.style.background = option.color || auto;
    if (!option.color) dot.textContent = 'A';
    const text = document.createElement('span');
    text.className = 'visually-hidden';
    text.textContent = option.name;
    swatch.append(input, dot, text);
    box.appendChild(swatch);
  }
  return box;
}

/** The colour picked in a colorPicker: '' for Auto; a colour outside the palette stays until another is picked. */
export function pickedColor(box) {
  const checked = box.querySelector('input:checked');
  return checked ? checked.value : box.dataset.value || '';
}

/**
 * The dialog for a link to a site this version doesn't read: which site (or
 * `what`, a kind of link such as "Google Maps lists"), a GitHub issue search
 * for it, and (collapsed) every supported link and file.
 */
export function showUnsupported(link, what = '') {
  const site = siteOf(link);
  $('unsupported-text').textContent =
    `${what || `${site} links`} don't work in this version of oPin. If nobody has asked for it yet, open an issue on GitHub.`;
  $('unsupported-issues').href = issuesSearchUrl(what || site);
  $('unsupported-list').replaceChildren(...SUPPORTED_SOURCES.map((group) => {
    const p = document.createElement('p');
    const title = document.createElement('strong');
    title.textContent = `${group.title}: `;
    p.append(title, group.items.join(' · ') + (group.note ? ` — ${group.note}` : ''));
    return p;
  }));
  $('unsupported-sources').open = false;
  $('dlg-unsupported').showModal();
}

/** Points the "Shortcut help" install links (import dialog, Settings) at the shared Shortcut. */
export function linkShortcutInstall(root) {
  for (const a of root.querySelectorAll('a[data-shortcut-install]')) a.href = SHORTCUT_INSTALL_URL;
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
 * The notice above the import list for a guide's Apple Maps places: hands one
 * place link per Apple ID to the iPhone Shortcut and takes its results back
 * (the place pages; a guide page or "@@" lines of older Shortcuts work too)
 * by paste. After a paste, the button copies the places still missing; those
 * it already copied once count as not found. Clipboard access happens right in
 * the tap handlers (iOS allows it only there); where it is refused, a text box
 * takes its place.
 */
function wireAppleLookup(guide, entries, onResults) {
  const box = $('import-apple');
  box.hidden = !guide;
  $('import-apple-copy').hidden = true;
  $('import-apple-manual').hidden = true;
  $('import-apple-open-row').hidden = true;
  $('import-apple-shortcut').hidden = false;
  $('import-apple-shortcut').textContent = 'Look up with iPhone Shortcut';
  // A real link as a second way in, should iOS block opening Shortcuts from script.
  $('import-apple-open').href = SHORTCUT_RUN_URL;
  $('import-apple-results').value = '';
  if (!guide) return;

  const total = guide.appleIds.length;
  // After a paste (also when the dialog reopens with places found) the notice
  // says what is missing and the button tries just those again.
  let pasted = guide.found.size > 0;
  const missing = () => missingAppleIds(guide.appleIds, entries);

  const drawNotice = () => {
    const state = lookupState(guide, entries);
    $('import-apple-text').textContent = pasted
      ? lookupNotice({ total, notFound: state.notFound.length, needed: state.needed.length })
      : `${total} ${total === 1 ? 'place is an Apple Maps place' : 'places are Apple Maps places'}. ` +
        "Apple doesn't share them with this app's helper. Look them up from your phone or a computer:";
    $('import-apple-shortcut').textContent = pasted ? lookupButton(state) : 'Look up with iPhone Shortcut';
    $('import-apple-shortcut').hidden = pasted && !state.missing.length;
    $('import-apple-time').hidden = $('import-apple-shortcut').hidden;
  };
  drawNotice();

  $('import-apple-shortcut').onclick = async () => {
    // Before any paste every place is missing: one link per Apple ID of the guide.
    const ids = missing();
    const input = shortcutInput(ids);
    // Kept with the guide: a place copied once and still missing after the answer is "not found".
    rememberRequested(guide, ids);
    savePendingGuide(guide);
    try {
      await navigator.clipboard.writeText(input);
    } catch {
      $('import-apple-list').value = input;
      $('import-apple-copy').hidden = false;
      $('import-apple-list').focus();
      $('import-apple-list').select();
      return;
    }
    $('import-apple-copied').textContent = copiedNotice(ids.length);
    $('import-apple-open-row').hidden = false;
    openExternal(SHORTCUT_RUN_URL);
  };
  $('import-apple-run').onclick = () => openExternal(SHORTCUT_RUN_URL);

  const useResults = (text) => {
    // A guide page names its first 20 places: those the list doesn't have yet are added.
    const { results, found, added } = applyPasteToGuide(entries, guide.appleIds, text);
    if (found || added) {
      pasted = true;
      guide.found = foundAppleIds(guide.appleIds, entries);
      savePendingGuide(guide);
    }
    onResults(results);
    drawNotice();
    const left = missing().length;
    toast(`Found ${total - left} of ${total} ${total === 1 ? 'place' : 'places'}` +
      (added ? ` and added ${added} more.` : '.'), found || added ? 'success' : 'info', 5000);
    return found + added;
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

/**
 * Imports the rows. Each new pin gets the tag from the dialog's tag field
 * (`tag`, normalized here); a pin already at a row's spot gets it added.
 * `color`: the colour picked for the new pins, '' (Auto) for each its source's.
 */
export async function applyImport(entries, sourceName, env, tag = '', color = '') {
  let created = 0;
  const createdSources = [];
  let skipped = 0;
  const failed = [];
  const radius = store.settings.radiusM;
  const fieldTag = cleanTag(tag);
  // A Google list row carries its list's name. For one list the field started
  // with that name and decides; rows of other lists (several files) keep theirs.
  const startTag = importTag(sourceName);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    toast(`Importing ${i + 1} of ${entries.length} …`, 'info', 0);

    let lat = e.lat;
    let lon = e.lon;

    // Another map app's link that needs a request first (an OpenStreetMap object, a Mapy short
    // link): no place search for its stand-in name when nothing is found.
    if (!Number.isFinite(lat) && needsMapAppLookup(e)) {
      const done = await lookUpMapAppEntry(e, { resolve: resolveShortLink });
      if (!done.ok) {
        failed.push(e.name);
        continue;
      }
      Object.assign(e, done.entry);
      ({ lat, lon } = done.entry);
    }

    // Resolve short link
    if (!Number.isFinite(lat) && e.url && isGoogleShortLink(e.url)) {
      const j = await resolveShortLink(e.url);
      if (j.ok && j.url) {
        const k = googleCoordinates(j.url);
        if (k) { lat = k.lat; lon = k.lon; }
        // A short link carries no name; the resolved one often does.
        if (STAND_IN_PLACE_NAMES.has(e.name)) e.name = googlePlaceName(j.url) || e.name;
      }
    }

    // Search by name — not for Apple Maps places the guide names only by ID
    // ("Apple Maps place" would find something random), nor for a stand-in name.
    if (!Number.isFinite(lat) && !isAppleIdLink(e.url) && !STAND_IN_PLACE_NAMES.has(e.name)) {
      const q = [e.name, e.address].filter(Boolean).join(', ');
      const j = await searchPlaces(q, { limit: 1 });
      const t = (j.results || [])[0];
      if (t) { lat = t.lat; lon = t.lon; if (!e.address) e.address = t.address; }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      failed.push(e.name);
      continue;
    }

    const tags = fieldTag ? [fieldTag] : [];
    const listTag = importTag(e.tagSuggestion);
    if (listTag && listTag !== startTag) tags.push(listTag);

    // Is there already something at this spot? During a batch import, don't ask;
    // silently skip very close duplicates instead, but add the tags to them.
    const nearby = store.db.pins.find(
      (p) => distanceM(lat, lon, p.lat, p.lon) < Math.min(radius, 60)
    );
    if (nearby) {
      const united = [...new Set([...(nearby.tags || []), ...tags])];
      if (united.length > (nearby.tags || []).length) store.updatePin(nearby.id, { tags: united });
      skipped++;
      continue;
    }

    store.addPin({
      lat, lon,
      title: e.name,
      address: e.address || '',
      note: e.note || '',
      tags,
      source: e.source || 'import',
      color,
    });
    created++;
    createdSources.push(e.source || 'import');
  }

  const saved = await store.save();
  env.redraw();
  hideToast();
  if (!saved.ok) return;

  const parts = [`${created} ${created === 1 ? 'place' : 'places'} imported`];
  if (skipped) parts.push(`${skipped} skipped as duplicates`);
  if (failed.length) parts.push(`${failed.length} left without coordinates`);
  toast(parts.join(', ') + '.', failed.length ? 'error' : 'success', 6000);

  if (created) {
    // Show the new pins: a search text or tag chip left over would hide them.
    filter.search = '';
    filter.tags.clear();
    $('search').value = '';
    env.redraw?.();
    env.map?.fitTo(store.db.pins);
    env.pinwheel?.(importLook(createdSources, sourceName));
  }
}

/**
 * What the add-pin animation shows after an import: the source's logo when
 * every new pin comes from one source with a logo, else the file or list name
 * ("3 files" for several files) or how many places came in.
 */
export function importLook(pinSources, sourceName) {
  const logos = new Set(pinSources.map((source) => pinLook(source).logo));
  const [logo] = logos;
  if (logos.size === 1 && logo) return { logo, caption: '' };
  const files = (String(sourceName ?? '').match(IMPORT_FILE_EXTENSION) || []).length;
  if (files > 1) return { logo: '', caption: `${files} files` };
  return { logo: '', caption: sourceName || `${pinSources.length} places` };
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

import { buildBackupHtml, backupAgeText, backupFileName } from './backup.js';

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
    file = new File([html], backupFileName(), { type: 'text/html' });
  } catch (e) {
    toast("Couldn't build the backup: " + e.message, 'error');
    return false;
  }

  let canShare = false;
  try { canShare = Boolean(navigator.canShare?.({ files: [file] })); } catch { /* no file sharing */ }
  if (canShare) {
    hideToast();
    try {
      await navigator.share({ files: [file], title: 'oPin backup' });
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
