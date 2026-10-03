/**
 * dedupe.js — link normalization, distances, duplicate and proximity detection.
 *
 * Two rules from the requirements are anchored here:
 *   • A post belongs to exactly one pin (postIndex).
 *   • A new pin close to an existing one triggers a question;
 *     the decision is made by hand.
 */

/* ------------------------------------------------------------------ *
 * Instagram links
 * ------------------------------------------------------------------ */

/**
 * Extracts the shortcode from every common link form.
 * Treats /p/, /reel/, /reels/, /tv/ and /username/p/ the same and drops
 * suffixes such as ?igsh=, ?utm_source= and the trailing slash.
 */
export function shortcode(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const kurz = s.match(/(?:instagr\.am|ig\.me)\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);
  if (kurz) return kurz[1];
  return null;
}

/** Canonical form of an Instagram link, regardless of how it was shared. */
export function normalisiereLink(input) {
  const code = shortcode(input);
  return code ? `https://www.instagram.com/p/${code}/` : null;
}

/** Embed URL for the iframe. */
export function embedLink(input) {
  const code = shortcode(input);
  return code ? `https://www.instagram.com/p/${code}/embed/captioned/` : null;
}

export function istInstagramLink(input) {
  return shortcode(input) !== null;
}

/* ------------------------------------------------------------------ *
 * Distance
 * ------------------------------------------------------------------ */

const ERDRADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Distance between two points in meters (haversine). */
export function entfernung(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * ERDRADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Human-readable: 87 m, 1,2 km, 340 km */
export function entfernungText(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}

/* ------------------------------------------------------------------ *
 * Duplicate posts
 * ------------------------------------------------------------------ */

/**
 * Is this post already saved somewhere?
 * @returns {{pin: object, post: object}|null}
 */
export function findePost(db, link) {
  const code = shortcode(link);
  if (!code) return null;

  // Fast path via the index ...
  const pinId = db.postIndex?.[code];
  if (pinId) {
    const pin = db.pins.find((p) => p.id === pinId);
    if (pin) {
      const post = (pin.posts || []).find((x) => shortcode(x.url) === code);
      if (post) return { pin, post };
    }
  }
  // ... and a full scan as a fallback, in case the index ever fell
  // behind (for example after a manual import).
  for (const pin of db.pins) {
    for (const post of pin.posts || []) {
      if (shortcode(post.url) === code) return { pin, post };
    }
  }
  return null;
}

/** Rebuilds the postIndex from the pins. Call after every import. */
export function baueIndex(db) {
  const idx = {};
  for (const pin of db.pins) {
    for (const post of pin.posts || []) {
      const code = shortcode(post.url);
      if (code && !idx[code]) idx[code] = pin.id;
    }
  }
  db.postIndex = idx;
  return db;
}

/* ------------------------------------------------------------------ *
 * Neighborhood
 * ------------------------------------------------------------------ */

/**
 * Pins near a coordinate, nearest first.
 * @param {number} radiusM  threshold in meters
 * @param {string} [ausser] pin id to skip (when moving a pin)
 */
export function nahePins(db, lat, lon, radiusM, ausser = null) {
  const raus = [];
  for (const pin of db.pins) {
    if (ausser && pin.id === ausser) continue;
    const d = entfernung(lat, lon, pin.lat, pin.lon);
    if (d <= radiusM) raus.push({ pin, distanz: d });
  }
  return raus.sort((a, b) => a.distanz - b.distanz);
}

/**
 * Was "separate pin" already chosen for this pair before?
 * Then don't ask again.
 */
export function getrenntGewollt(pin, anderePinId) {
  return Array.isArray(pin.getrenntVon) && pin.getrenntVon.includes(anderePinId);
}

export function merkeGetrennt(pinA, pinB) {
  pinA.getrenntVon = [...new Set([...(pinA.getrenntVon || []), pinB.id])];
  pinB.getrenntVon = [...new Set([...(pinB.getrenntVon || []), pinA.id])];
}

/* ------------------------------------------------------------------ *
 * Ids
 * ------------------------------------------------------------------ */

export function neueId(praefix = 'p') {
  const zeit = Date.now().toString(36);
  const zufall = Math.random().toString(36).slice(2, 7);
  return `${praefix}_${zeit}${zufall}`;
}
