/**
 * store.js — data storage.
 *
 * data/pins.json on disk is the source of truth. The browser keeps a working
 * copy and writes it back in batches. In addition, a copy is kept in
 * localStorage after every change: if the server ever fails to respond,
 * nothing is lost and the app offers to apply the unsaved state on the
 * next start.
 */

import { buildIndex, newId, shortcode } from './dedupe.js';

const EMERGENCY_KEY = 'insta-pinmap.emergency-copy';
const SETTINGS_KEY = 'insta-pinmap.settings';

export const DEFAULT_SETTINGS = {
  radiusM: 150,
  tiles: 'osm',
  customStopTags: [],
  lastView: null,     // { lat, lon, zoom }
};

/** Colors for tags, strong enough to tell apart on the map. */
const COLORS = [
  '#b8543f', '#2f7d5d', '#3a6ea5', '#a3762b', '#7a4b8f',
  '#c0603f', '#2f7d7a', '#8f4b6b', '#4f7a2b', '#5a5f8f',
];

export const store = {
  db: { version: 1, tags: [], pins: [], postIndex: {}, settings: {} },
  settings: { ...DEFAULT_SETTINGS },
  serverUp: false,
  _listeners: new Set(),
  _saveTimer: null,
  _writing: false,

  /* ---------------- Loading ---------------- */

  async load() {
    this.settings = { ...DEFAULT_SETTINGS, ...readLocal(SETTINGS_KEY, {}) };

    try {
      const r = await fetch('/api/pins', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || 'Server responded with an error');
      this.db = normalizeDb(j.db);
      this.serverUp = true;
    } catch (e) {
      this.serverUp = false;
      const emergency = readLocal(EMERGENCY_KEY, null);
      this.db = emergency ? normalizeDb(emergency) : normalizeDb({});
      throw new Error(
        'The mini server is not responding. ' +
        (emergency
          ? 'Continuing with the last copy from the browser; nothing is saved until the server is running again.'
          : 'Is it running? Start it with "node server.js".')
      );
    }

    // Were there unsaved changes last time?
    const emergency = readLocal(EMERGENCY_KEY, null);
    if (this.serverUp && emergency && emergency.changedAt > (this.db.changedAt || 0)) {
      return { conflict: emergency };
    }
    return {};
  },

  /* ---------------- Saving ---------------- */

  /** Collects changes and writes them in batches, so not every keystroke touches the disk. */
  change(fn) {
    const result = fn(this.db);
    this.db.changedAt = Date.now();
    buildIndex(this.db);
    writeLocal(EMERGENCY_KEY, this.db);
    this._notify();

    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 400);
    return result;
  },

  async save() {
    if (!this.serverUp) return { ok: false, message: 'No server.' };
    if (this._writing) {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.save(), 300);
      return { ok: true, deferred: true };
    }
    this._writing = true;
    try {
      const r = await fetch('/api/pins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.db),
      });
      const j = await r.json();
      if (j.ok) {
        try { localStorage.removeItem(EMERGENCY_KEY); } catch { /* doesn't matter */ }
      }
      return j;
    } catch (e) {
      return { ok: false, message: e.message };
    } finally {
      this._writing = false;
    }
  },

  /* ---------------- Settings ---------------- */

  setSetting(name, value) {
    this.settings[name] = value;
    writeLocal(SETTINGS_KEY, this.settings);
    this._notify();
  },

  /* ---------------- Listeners ---------------- */

  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _notify() { for (const fn of this._listeners) { try { fn(this.db); } catch (e) { console.error(e); } } },

  /* ---------------- Pins ---------------- */

  pin(id) { return this.db.pins.find((p) => p.id === id) || null; },

  addPin({ lat, lon, title, address = '', note = '', status = 'wishlist', tags = [], post = null, source = 'manual' }) {
    const now = new Date().toISOString();
    const pin = {
      id: newId('p'),
      lat: round7(lat), lon: round7(lon),
      title: String(title || 'Untitled').trim(),
      address, note, status,
      tags: [...new Set(tags.map(normTag).filter(Boolean))],
      source,
      createdAt: now, updatedAt: now,
      posts: [],
      keptApartFrom: [],
    };
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
      if (fields.tags) {
        pin.tags = [...new Set(fields.tags.map(normTag).filter(Boolean))];
        rememberTags(db, pin.tags);
      }
      if (fields.lat != null) pin.lat = round7(fields.lat);
      if (fields.lon != null) pin.lon = round7(fields.lon);
      pin.updatedAt = new Date().toISOString();
      return pin;
    });
  },

  deletePin(id) {
    this.change((db) => {
      db.pins = db.pins.filter((p) => p.id !== id);
      for (const p of db.pins) {
        if (p.keptApartFrom) p.keptApartFrom = p.keptApartFrom.filter((x) => x !== id);
      }
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

  /** Color of a pin: that of its first tag, otherwise the accent color. */
  pinColor(pin) {
    const t = (pin.tags || [])[0];
    return t ? this.tagColor(t) : '#8a8f98';
  },

  /* ---------------- Backup ---------------- */

  asJson() {
    return JSON.stringify({ ...this.db, exportedAt: new Date().toISOString() }, null, 2);
  },

  replaceAll(foreign) {
    const fresh = normalizeDb(foreign);
    this.change((db) => {
      db.pins = fresh.pins;
      db.tags = fresh.tags;
      db.version = fresh.version || 1;
    });
  },
};

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
    addedAt: new Date().toISOString(),
  };
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

/** Brings foreign or older data into the expected shape. */
export function normalizeDb(raw) {
  const db = {
    version: 1,
    tags: [],
    pins: [],
    postIndex: {},
    settings: {},
    changedAt: 0,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  // Old backups used `stand` for the change time.
  db.changedAt = Number(raw?.changedAt ?? raw?.stand ?? 0) || 0;
  delete db.stand;
  db.pins = (Array.isArray(db.pins) ? db.pins : [])
    .map((p) => ({
      id: p.id || newId('p'),
      lat: Number(p.lat),
      lon: Number(p.lon),
      title: String(p.title || p.name || 'Untitled'),
      address: String(p.address || ''),
      note: String(p.note || ''),
      status: p.status === 'visited' ? 'visited' : 'wishlist',
      tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).map(normTag).filter(Boolean))],
      source: p.source || p.quelle || 'manual',
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
      posts: (Array.isArray(p.posts) ? p.posts : []).filter((x) => x && x.url).map((x) => ({
        url: x.url,
        shortcode: x.shortcode || shortcode(x.url) || '',
        caption: String(x.caption || ''),
        username: x.username || '',
        thumb: x.thumb || '',
        addedAt: x.addedAt || new Date().toISOString(),
      })),
      keptApartFrom: Array.isArray(p.keptApartFrom) ? p.keptApartFrom
        : Array.isArray(p.getrenntVon) ? p.getrenntVon : [],
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

  db.tags = (Array.isArray(db.tags) ? db.tags : [])
    .map((t) => (typeof t === 'string' ? { name: normTag(t), color: '' } : { name: normTag(t.name), color: t.color || '' }))
    .filter((t) => t.name);

  return buildIndex(db);
}

function readLocal(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage full or blocked; the server is the source of truth anyway */
  }
}
