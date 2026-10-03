/**
 * store.js — data storage.
 *
 * data/pins.json on disk is the source of truth. The browser keeps a working
 * copy and writes it back in batches. In addition, a copy is kept in
 * localStorage after every change: if the server ever fails to respond,
 * nothing is lost and the app offers to apply the unsaved state on the
 * next start.
 */

import { baueIndex, neueId, shortcode } from './dedupe.js';

const NOTFALL_SCHLUESSEL = 'ortsammlung.notfallkopie';
const EINST_SCHLUESSEL = 'ortsammlung.einstellungen';

export const STANDARD_EINSTELLUNGEN = {
  radiusM: 150,
  kacheln: 'osm',
  eigeneStoppTags: [],
  letzteAnsicht: null,     // { lat, lon, zoom }
};

/** Colors for tags, strong enough to tell apart on the map. */
const FARBEN = [
  '#b8543f', '#2f7d5d', '#3a6ea5', '#a3762b', '#7a4b8f',
  '#c0603f', '#2f7d7a', '#8f4b6b', '#4f7a2b', '#5a5f8f',
];

export const store = {
  db: { version: 1, tags: [], pins: [], postIndex: {}, settings: {} },
  einstellungen: { ...STANDARD_EINSTELLUNGEN },
  serverDa: false,
  _horcher: new Set(),
  _speicherTimer: null,
  _schreibtGerade: false,

  /* ---------------- Loading ---------------- */

  async laden() {
    this.einstellungen = { ...STANDARD_EINSTELLUNGEN, ...leseLokal(EINST_SCHLUESSEL, {}) };

    try {
      const r = await fetch('/api/pins', { cache: 'no-store' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.message || 'Server responded with an error');
      this.db = normalisiere(j.db);
      this.serverDa = true;
    } catch (e) {
      this.serverDa = false;
      const notfall = leseLokal(NOTFALL_SCHLUESSEL, null);
      this.db = notfall ? normalisiere(notfall) : normalisiere({});
      throw new Error(
        'The mini server is not responding. ' +
        (notfall
          ? 'Continuing with the last copy from the browser; nothing is saved until the server is running again.'
          : 'Is it running? Start it with "node server.js".')
      );
    }

    // Were there unsaved changes last time?
    const notfall = leseLokal(NOTFALL_SCHLUESSEL, null);
    if (this.serverDa && notfall && notfall.stand > (this.db.stand || 0)) {
      return { konflikt: notfall };
    }
    return {};
  },

  /* ---------------- Saving ---------------- */

  /** Collects changes and writes them in batches, so not every keystroke touches the disk. */
  aendern(fn) {
    const ergebnis = fn(this.db);
    this.db.stand = Date.now();
    baueIndex(this.db);
    schreibeLokal(NOTFALL_SCHLUESSEL, this.db);
    this._melden();

    clearTimeout(this._speicherTimer);
    this._speicherTimer = setTimeout(() => this.sichern(), 400);
    return ergebnis;
  },

  async sichern() {
    if (!this.serverDa) return { ok: false, message: 'No server.' };
    if (this._schreibtGerade) {
      clearTimeout(this._speicherTimer);
      this._speicherTimer = setTimeout(() => this.sichern(), 300);
      return { ok: true, verschoben: true };
    }
    this._schreibtGerade = true;
    try {
      const r = await fetch('/api/pins', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.db),
      });
      const j = await r.json();
      if (j.ok) {
        try { localStorage.removeItem(NOTFALL_SCHLUESSEL); } catch { /* doesn't matter */ }
      }
      return j;
    } catch (e) {
      return { ok: false, message: e.message };
    } finally {
      this._schreibtGerade = false;
    }
  },

  /* ---------------- Settings ---------------- */

  setzeEinstellung(name, wert) {
    this.einstellungen[name] = wert;
    schreibeLokal(EINST_SCHLUESSEL, this.einstellungen);
    this._melden();
  },

  /* ---------------- Listeners ---------------- */

  bei(fn) { this._horcher.add(fn); return () => this._horcher.delete(fn); },
  _melden() { for (const fn of this._horcher) { try { fn(this.db); } catch (e) { console.error(e); } } },

  /* ---------------- Pins ---------------- */

  pin(id) { return this.db.pins.find((p) => p.id === id) || null; },

  neuerPin({ lat, lon, title, address = '', note = '', status = 'wishlist', tags = [], post = null, quelle = 'manuell' }) {
    const jetzt = new Date().toISOString();
    const pin = {
      id: neueId('p'),
      lat: runde(lat), lon: runde(lon),
      title: String(title || 'Untitled').trim(),
      address, note, status,
      tags: [...new Set(tags.map(normTag).filter(Boolean))],
      quelle,
      createdAt: jetzt, updatedAt: jetzt,
      posts: [],
      getrenntVon: [],
    };
    if (post) pin.posts.push(machPost(post));
    this.aendern((db) => {
      db.pins.push(pin);
      merkeTags(db, pin.tags);
    });
    return pin;
  },

  postAnhaengen(pinId, post) {
    return this.aendern((db) => {
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin) return null;
      const code = shortcode(post.url);
      if (code && (pin.posts || []).some((x) => shortcode(x.url) === code)) return pin;
      pin.posts = [...(pin.posts || []), machPost(post)];
      pin.updatedAt = new Date().toISOString();
      return pin;
    });
  },

  pinAendern(id, felder) {
    return this.aendern((db) => {
      const pin = db.pins.find((p) => p.id === id);
      if (!pin) return null;
      Object.assign(pin, felder);
      if (felder.tags) {
        pin.tags = [...new Set(felder.tags.map(normTag).filter(Boolean))];
        merkeTags(db, pin.tags);
      }
      if (felder.lat != null) pin.lat = runde(felder.lat);
      if (felder.lon != null) pin.lon = runde(felder.lon);
      pin.updatedAt = new Date().toISOString();
      return pin;
    });
  },

  pinLoeschen(id) {
    this.aendern((db) => {
      db.pins = db.pins.filter((p) => p.id !== id);
      for (const p of db.pins) {
        if (p.getrenntVon) p.getrenntVon = p.getrenntVon.filter((x) => x !== id);
      }
    });
  },

  postLoeschen(pinId, url) {
    const code = shortcode(url);
    this.aendern((db) => {
      const pin = db.pins.find((p) => p.id === pinId);
      if (!pin) return;
      pin.posts = (pin.posts || []).filter((x) => shortcode(x.url) !== code);
      pin.updatedAt = new Date().toISOString();
    });
  },

  /* ---------------- Tags ---------------- */

  alleTags() {
    const zaehler = new Map();
    for (const pin of this.db.pins) {
      for (const t of pin.tags || []) zaehler.set(t, (zaehler.get(t) || 0) + 1);
    }
    return [...zaehler.entries()]
      .map(([name, anzahl]) => ({ name, anzahl, farbe: this.tagFarbe(name) }))
      .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'));
  },

  tagFarbe(name) {
    const eintrag = (this.db.tags || []).find((t) => t.name === name);
    if (eintrag?.color) return eintrag.color;
    // Stable color derived from the name, so it never changes
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return FARBEN[h % FARBEN.length];
  },

  /** Color of a pin: that of its first tag, otherwise the accent color. */
  pinFarbe(pin) {
    const t = (pin.tags || [])[0];
    return t ? this.tagFarbe(t) : '#8a8f98';
  },

  /* ---------------- Backup ---------------- */

  alsJSON() {
    return JSON.stringify({ ...this.db, exportiertAm: new Date().toISOString() }, null, 2);
  },

  uebernehmen(fremd) {
    const neu = normalisiere(fremd);
    this.aendern((db) => {
      db.pins = neu.pins;
      db.tags = neu.tags;
      db.version = neu.version || 1;
    });
  },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function runde(n) { return Math.round(Number(n) * 1e7) / 1e7; }

export function normTag(s) {
  return String(s || '')
    .trim().toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 40);
}

function machPost(p) {
  return {
    url: p.url,
    shortcode: shortcode(p.url) || '',
    caption: String(p.caption || '').slice(0, 4000),
    username: p.username || '',
    thumb: p.thumb || '',
    addedAt: new Date().toISOString(),
  };
}

function merkeTags(db, tags) {
  db.tags = db.tags || [];
  for (const name of tags) {
    if (!db.tags.some((t) => t.name === name)) {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
      db.tags.push({ name, color: FARBEN[h % FARBEN.length] });
    }
  }
}

/** Brings foreign or older data into the expected shape. */
function normalisiere(roh) {
  const db = {
    version: 1,
    tags: [],
    pins: [],
    postIndex: {},
    settings: {},
    stand: 0,
    ...(roh && typeof roh === 'object' ? roh : {}),
  };
  db.pins = (Array.isArray(db.pins) ? db.pins : [])
    .map((p) => ({
      id: p.id || neueId('p'),
      lat: Number(p.lat),
      lon: Number(p.lon),
      title: String(p.title || p.name || 'Untitled'),
      address: String(p.address || ''),
      note: String(p.note || ''),
      status: p.status === 'visited' ? 'visited' : 'wishlist',
      tags: [...new Set((Array.isArray(p.tags) ? p.tags : []).map(normTag).filter(Boolean))],
      quelle: p.quelle || 'manuell',
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
      getrenntVon: Array.isArray(p.getrenntVon) ? p.getrenntVon : [],
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

  db.tags = (Array.isArray(db.tags) ? db.tags : [])
    .map((t) => (typeof t === 'string' ? { name: normTag(t), color: '' } : { name: normTag(t.name), color: t.color || '' }))
    .filter((t) => t.name);

  return baueIndex(db);
}

function leseLokal(schluessel, standard) {
  try {
    const s = localStorage.getItem(schluessel);
    return s ? JSON.parse(s) : standard;
  } catch {
    return standard;
  }
}

function schreibeLokal(schluessel, wert) {
  try {
    localStorage.setItem(schluessel, JSON.stringify(wert));
  } catch {
    /* Storage full or blocked; the server is the source of truth anyway */
  }
}
