/**
 * store.js — pins and settings, kept in IndexedDB on this device.
 *
 * The whole collection is one object ("db") stored under one key and written
 * shortly after each change. Deleted pins are remembered in db.deleted, so
 * that loading an older backup (and later sync) cannot bring them back.
 */

import { buildIndex, newId, shortcode } from './dedupe.js';
import { idbGet, idbSet } from './idb.js';
import { sourceColor } from './sources.js';

const DB_KEY = 'db';
const SETTINGS_KEY = 'settings';
const LEGACY_SETTINGS_KEY = 'insta-pinmap.settings';

export const DEFAULT_SETTINGS = {
  radiusM: 150,
  tiles: 'osm',
  customStopTags: [],
  lastView: null,        // { lat, lon, zoom }
  lastBackupAt: null,    // ISO string of the last "Save backup"
};

/** Colors for tags, strong enough to tell apart on the map. */
const COLORS = [
  '#b8543f', '#2f7d5d', '#3a6ea5', '#a3762b', '#7a4b8f',
  '#c0603f', '#2f7d7a', '#8f4b6b', '#4f7a2b', '#5a5f8f',
];

/** The pin colours to choose from (pin colour picker): eight of the colours above, with names. */
export const PIN_COLORS = [
  { name: 'Rust', color: '#b8543f' }, { name: 'Amber', color: '#a3762b' }, { name: 'Olive', color: '#4f7a2b' },
  { name: 'Green', color: '#2f7d5d' }, { name: 'Teal', color: '#2f7d7a' }, { name: 'Blue', color: '#3a6ea5' },
  { name: 'Purple', color: '#7a4b8f' }, { name: 'Plum', color: '#8f4b6b' },
];

/** A pin colour as stored: "#rrggbb" in lowercase; '' for anything else. */
export function pinColorValue(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '';
}

export const store = {
  db: normalizeDb({}),
  settings: { ...DEFAULT_SETTINGS },
  lastError: null,
  persistent: false,
  onSaveError: () => {},
  _listeners: new Set(),
  _saveTimer: null,
  _loadFailed: false,

  /* ---------------- Loading ---------------- */

  async load() {
    this.lastError = null;
    this._loadFailed = false;
    try {
      const settings = (await idbGet(SETTINGS_KEY)) ?? readLegacySettings();
      this.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      this.db = normalizeDb((await idbGet(DB_KEY)) || {});
    } catch (e) {
      this.lastError = `Phone storage is not available: ${e.message}`;
      this._loadFailed = true;
      this.settings = { ...DEFAULT_SETTINGS, ...(readLegacySettings() || {}) };
      this.db = normalizeDb({});
    }
    // Asking can wait on a permission prompt (Firefox), so never block start-up on it.
    try {
      Promise.resolve(globalThis.navigator?.storage?.persist?.())
        .then((ok) => { this.persistent = ok === true; }, () => {});
    } catch { /* not supported */ }
  },

  /* ---------------- Saving ---------------- */

  /** Applies a change, redraws listeners and saves shortly after. */
  change(fn) {
    const result = fn(this.db);
    this.db.changedAt = Date.now();
    buildIndex(this.db);
    this._notify();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 300);
    return result;
  },

  /** True while a change waits for its delayed save. */
  hasPendingSave() { return this._saveTimer != null; },

  async save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (this._loadFailed) {
      // The stored collection could not be read; writing now could overwrite it with an empty one.
      const message = this.lastError || 'Phone storage is not available.';
      this.onSaveError(message);
      return { ok: false, message };
    }
    try {
      await idbSet(DB_KEY, this.db);
      return { ok: true };
    } catch (e) {
      this.lastError = e.message;
      this.onSaveError(e.message);
      return { ok: false, message: e.message };
    }
  },

  /* ---------------- Settings ---------------- */

  setSetting(name, value) {
    this.settings[name] = value;
    idbSet(SETTINGS_KEY, this.settings).catch(() => { /* settings are not critical */ });
    this._notify();
  },

  /* ---------------- Listeners ---------------- */

  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _notify() { for (const fn of this._listeners) { try { fn(this.db); } catch (e) { console.error(e); } } },

  /* ---------------- Pins ---------------- */

  pin(id) { return this.db.pins.find((p) => p.id === id) || null; },

  addPin({ lat, lon, title, address = '', note = '', when = '', tags = [], post = null, source = 'manual', color = '' }) {
    const now = new Date().toISOString();
    const pin = {
      id: newId('p'),
      lat: round7(lat), lon: round7(lon),
      title: String(title || 'Untitled').trim(),
      address, note, when: cleanWhen(when),
      tags: [...new Set(tags.map(normTag).filter(Boolean))],
      source,
      createdAt: now, updatedAt: now,
      posts: [],
      keptApartFrom: [],
    };
    if (pinColorValue(color)) pin.color = pinColorValue(color);
    if (post) pin.posts.push(makePost(post));
    this.change((db) => {
      db.pins.push(pin);
      rememberTags(db, pin.tags);
    });
    return pin;
  },

  attachPost(pinId, post) {
    return this.change((db) => {
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin) return null;
      const code = shortcode(post.url);
      if (code && (pin.posts || []).some((x) => shortcode(x.url) === code)) return pin;
      pin.posts = [...(pin.posts || []), makePost(post)];
      pin.updatedAt = new Date().toISOString();
      return pin;
    });
  },

  updatePin(id, fields) {
    return this.change((db) => {
      const pin = db.pins.find((p) => p.id === id);
      if (!pin) return null;
      Object.assign(pin, fields);
      if ('when' in fields) pin.when = cleanWhen(fields.when);
      if (fields.tags) {
        pin.tags = [...new Set(fields.tags.map(normTag).filter(Boolean))];
        rememberTags(db, pin.tags);
      }
      if (fields.lat != null) pin.lat = round7(fields.lat);
      if (fields.lon != null) pin.lon = round7(fields.lon);
      // A colour, or '' (Auto) for the source's colour.
      if ('color' in fields) {
        if (pinColorValue(fields.color)) pin.color = pinColorValue(fields.color);
        else delete pin.color;
      }
      pin.updatedAt = new Date().toISOString();
      return pin;
    });
  },

  removePost(pinId, url) {
    const code = shortcode(url);
    this.change((db) => {
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin) return;
      pin.posts = (pin.posts || []).filter((x) => shortcode(x.url) !== code);
      pin.updatedAt = new Date().toISOString();
    });
  },

  deletePin(id) {
    this.change((db) => {
      db.pins = db.pins.filter((p) => p.id !== id);
      for (const p of db.pins) p.keptApartFrom = p.keptApartFrom.filter((x) => x !== id);
      db.deleted = db.deleted.filter((d) => d.id !== id);
      db.deleted.push({ id, deletedAt: new Date().toISOString() });
    });
  },

  /* ---------------- Tags ---------------- */

  allTags() {
    const counts = new Map();
    for (const pin of this.db.pins) {
      for (const t of pin.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count, color: this.tagColor(name) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
  },

  tagColor(name) {
    const entry = (this.db.tags || []).find((t) => t.name === name);
    if (entry?.color) return entry.color;
    // Stable color derived from the name, so it never changes
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  },

  /** Colour of a pin: its own (pin.color), else its source's (sources.js). Tags don't colour pins. */
  pinColor(pin) {
    return pinColorValue(pin?.color) || sourceColor(pin?.source);
  },

  /* ---------------- Backup ---------------- */

  asJson() {
    return JSON.stringify({ ...this.db, exportedAt: new Date().toISOString() }, null, 2);
  },

  /** "Add to my pins": merge rule from the spec, section 4.1. */
  mergeIn(incoming) {
    const result = mergeDb(this.db, incoming);
    this.change((db) => Object.assign(db, result.db));
    return { added: result.added, updated: result.updated, skipped: result.skipped };
  },

  /** "Replace everything". */
  replaceAll(incoming) {
    const next = normalizeDb(incoming);
    this.change((db) => {
      db.pins = next.pins;
      db.tags = next.tags;
      db.deleted = next.deleted;
      db.version = next.version || 1;
    });
  },
};

/* ------------------------------------------------------------------ *
 * Merge
 * ------------------------------------------------------------------ */

const time = (s) => Date.parse(s) || 0;

/**
 * Merges another collection into ours. Pure: returns a new db.
 *  - incoming pin on our deleted list, deleted at or after its last change → skipped
 *  - incoming pin changed after that deletion → restored, deletion entry dropped
 *  - pin on both sides → newer updatedAt wins
 *  - new pin whose post is already saved on one of our pins → skipped
 * Incoming deletions remove our pins unless we changed them afterwards.
 */
export function mergeDb(local, incoming) {
  const a = normalizeDb(structuredClone(local));
  const b = normalizeDb(incoming);
  const stats = { added: 0, updated: 0, skipped: 0 };

  const deleted = new Map(a.deleted.map((d) => [d.id, d.deletedAt]));
  for (const d of b.deleted) {
    if (!deleted.has(d.id) || time(d.deletedAt) > time(deleted.get(d.id))) deleted.set(d.id, d.deletedAt);
  }

  const pins = new Map(a.pins.map((p) => [p.id, p]));
  for (const [id, at] of [...deleted]) {
    const mine = pins.get(id);
    if (!mine) continue;
    if (time(at) >= time(mine.updatedAt)) pins.delete(id);
    else deleted.delete(id);
  }

  const savedCodes = () => new Set([...pins.values()].flatMap((p) => p.posts.map((x) => x.shortcode)).filter(Boolean));

  for (const pin of b.pins) {
    if (deleted.has(pin.id)) {
      if (time(deleted.get(pin.id)) >= time(pin.updatedAt)) { stats.skipped++; continue; }
      deleted.delete(pin.id);
    }
    const mine = pins.get(pin.id);
    if (mine) {
      if (time(pin.updatedAt) > time(mine.updatedAt)) { pins.set(pin.id, pin); stats.updated++; }
      else stats.skipped++;
      continue;
    }
    const codes = savedCodes();
    if (pin.posts.some((x) => x.shortcode && codes.has(x.shortcode))) { stats.skipped++; continue; }
    pins.set(pin.id, pin);
    stats.added++;
  }

  const tags = [...a.tags];
  for (const t of b.tags) if (!tags.some((x) => x.name === t.name)) tags.push(t);

  const db = buildIndex({
    ...a,
    pins: [...pins.values()],
    tags,
    deleted: [...deleted].map(([id, deletedAt]) => ({ id, deletedAt })),
    changedAt: Date.now(),
  });
  return { db, ...stats };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function round7(n) { return Math.round(Number(n) * 1e7) / 1e7; }

export function normTag(s) {
  return String(s || '')
    .trim().toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 40);
}

function makePost(p) {
  return {
    url: p.url,
    shortcode: shortcode(p.url) || '',
    caption: String(p.caption || '').slice(0, 4000),
    username: p.username || '',
    thumb: p.thumb || '',
    postedAt: cleanDay(p.postedAt),
    addedAt: new Date().toISOString(),
  };
}

/** What the user wrote under "When": a trimmed string of at most 100 characters. */
function cleanWhen(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

/** A post date is kept only as 'YYYY-MM-DD'. */
function cleanDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function rememberTags(db, tags) {
  db.tags = db.tags || [];
  for (const name of tags) {
    if (!db.tags.some((t) => t.name === name)) {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      db.tags.push({ name, color: COLORS[h % COLORS.length] });
    }
  }
}

function readLegacySettings() {
  try {
    const s = globalThis.localStorage?.getItem(LEGACY_SETTINGS_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Brings foreign or older collections into the expected shape. */
export function normalizeDb(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const db = {
    version: 1,
    tags: [],
    pins: [],
    postIndex: {},
    settings: {},
    ...raw,
  };
  db.changedAt = Number(raw.changedAt ?? raw.stand ?? 0) || 0;
  delete db.stand;
  db.deleted = (Array.isArray(raw.deleted) ? raw.deleted : [])
    .filter((d) => d && d.id && d.deletedAt)
    .map((d) => ({ id: String(d.id), deletedAt: String(d.deletedAt) }));
  db.pins = (Array.isArray(db.pins) ? db.pins : [])
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: p.id || newId('p'),
      lat: Number(p.lat),
      lon: Number(p.lon),
      title: String(p.title || p.name || 'Untitled'),
      address: String(p.address || ''),
      note: String(p.note || ''),
      when: cleanWhen(p.when),
      tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).map(normTag).filter(Boolean))],
      source: p.source || p.quelle || 'manual',
      ...(pinColorValue(p.color) ? { color: pinColorValue(p.color) } : {}),
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      posts: (Array.isArray(p.posts) ? p.posts : []).filter((x) => x && typeof x === 'object' && /^https?:[/][/]/i.test(String(x.url || ''))).map((x) => ({
        url: x.url,
        shortcode: x.shortcode || shortcode(x.url) || '',
        caption: String(x.caption || ''),
        username: x.username || '',
        thumb: x.thumb || '',
        postedAt: cleanDay(x.postedAt),
        addedAt: x.addedAt || new Date().toISOString(),
      })),
      keptApartFrom: Array.isArray(p.keptApartFrom) ? p.keptApartFrom
        : Array.isArray(p.getrenntVon) ? p.getrenntVon : [],
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

  db.tags = (Array.isArray(db.tags) ? db.tags : [])
    .map((t) => (typeof t === 'string' ? { name: normTag(t), color: '' } : { name: normTag(t.name), color: /^#[0-9a-f]{3,8}$/i.test(String(t.color)) ? String(t.color) : '' }))
    .filter((t) => t.name);

  return buildIndex(db);
}

/* Pending changes are written when the page is hidden or closed. */
if (typeof globalThis.addEventListener === 'function' && globalThis.document) {
  const flush = () => { if (store.hasPendingSave()) store.save(); };
  globalThis.document.addEventListener('visibilitychange', () => {
    if (globalThis.document.visibilityState === 'hidden') flush();
  });
  globalThis.addEventListener('pagehide', flush);
}

/** Drops filter tags no pin has anymore, so a filter can never be stuck without an "All" way out. */
export function pruneTagFilter(filterTags, existingNames) {
  const have = new Set(existingNames);
  for (const t of [...filterTags]) if (!have.has(t)) filterTags.delete(t);
  return filterTags;
}
