/**
 * dedupe.js — link normalization, distances, duplicate and proximity detection.
 *
 * Two rules from the requirements are anchored here:
 *   • A post belongs to exactly one pin (postIndex).
 *   • A new pin close to an existing one triggers a question;
 *     the decision is made by hand.
 */

import { sourceOf } from './sources.js';

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
  const short = s.match(/(?:instagr\.am|ig\.me)\/(?:p|reel)\/([A-Za-z0-9_-]+)/i);
  if (short) return short[1];
  return null;
}

/** Canonical form of an Instagram link, regardless of how it was shared. */
export function normalizeLink(input) {
  const code = shortcode(input);
  return code ? `https://www.instagram.com/p/${code}/` : null;
}

/** Embed URL for the iframe. */
export function embedLink(input) {
  const code = shortcode(input);
  return code ? `https://www.instagram.com/p/${code}/embed/captioned/` : null;
}

/** True for a link from Instagram, by its prefix (sources.js); shortcode() then reads the post's code. */
export function isInstagramLink(input) {
  return sourceOf(input) === 'instagram';
}

/* ------------------------------------------------------------------ *
 * Distance
 * ------------------------------------------------------------------ */

const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

/** Distance between two points in meters (haversine). */
export function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Human-readable: 87 m, 1,2 km, 340 km */
export function distanceText(m) {
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
export function findPost(db, link) {
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
export function buildIndex(db) {
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
 * @param {string} [except] pin id to skip (when moving a pin)
 */
export function nearbyPins(db, lat, lon, radiusM, except = null) {
  const result = [];
  for (const pin of db.pins) {
    if (except && pin.id === except) continue;
    const d = distanceM(lat, lon, pin.lat, pin.lon);
    if (d <= radiusM) result.push({ pin, distance: d });
  }
  return result.sort((a, b) => a.distance - b.distance);
}

/**
 * Was "separate pin" already chosen for this pair before?
 * Then don't ask again.
 */
export function wantedApart(pin, otherPinId) {
  return Array.isArray(pin.keptApartFrom) && pin.keptApartFrom.includes(otherPinId);
}

export function markApart(pinA, pinB) {
  pinA.keptApartFrom = [...new Set([...(pinA.keptApartFrom || []), pinB.id])];
  pinB.keptApartFrom = [...new Set([...(pinB.keptApartFrom || []), pinA.id])];
}

/* ------------------------------------------------------------------ *
 * Ids
 * ------------------------------------------------------------------ */

export function newId(prefix = 'p') {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${time}${random}`;
}
