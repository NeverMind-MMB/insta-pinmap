/**
 * ticket.js — the "work ticket" that keeps scripts from using /api/ig in bulk.
 *
 * For each request the app finds a nonce so that
 * SHA-256("<key>:<minute>:<nonce>") starts with `difficulty` zero bits (the key:
 * the code or post key itself up to 24 characters; a longer post key its hash, a
 * longer shortcode its first 24 characters; see ticketKey).
 * That costs the phone about a second and the Worker one hash to check.
 * Same input format as worker/ticket.js — change both together.
 */

import { firstWordOfSingleBlock, sha256 } from './sha256.js';

export const TICKET_WINDOW = 2; // minutes either side the Worker accepts

export function ticketMinute(nowMs = Date.now()) {
  return Math.floor(nowMs / 60000);
}

const MAX_KEY_BYTES = 24;

/**
 * What a ticket is computed over: the code as it is when it has at most 24 bytes. A longer
 * post key ("yt:", "fb:", "tt:" … — it has a ":") becomes "~" and the first 23 hex digits of
 * its SHA-256, so two long keys that begin alike (fb:page:<name>, fb:pfbid…) never share a
 * ticket. An Instagram shortcode (no ":") keeps the cut to its first 24 characters that apps
 * from before 2.2.0 make, so their tickets for long private-post codes still verify and they
 * see the Worker's real answer. At most 24 characters either way: one SHA-256 block.
 */
export function ticketKey(code) {
  const s = String(code);
  if (!s.includes(':')) return s.slice(0, MAX_KEY_BYTES);
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= MAX_KEY_BYTES) return s;
  return `~${[...sha256(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, MAX_KEY_BYTES - 1)}`;
}

export function ticketInput(code, minute, nonce) {
  return `${ticketKey(code)}:${minute}:${nonce}`;
}

export function leadingZeroBits(bytes) {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) { n += 8; continue; }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

/** Finds the first nonce that meets the difficulty (difficulty ≤ 32). */
export function solveTicket(code, minute, difficulty) {
  const prefix = new TextEncoder().encode(ticketInput(code, minute, ''));
  const block = new Uint8Array(64);
  block.set(prefix);
  for (let nonce = 0; ; nonce++) {
    const digits = String(nonce);
    let len = prefix.length;
    for (let i = 0; i < digits.length; i++) block[len++] = digits.charCodeAt(i);
    if (Math.clz32(firstWordOfSingleBlock(block, len)) >= difficulty) return nonce;
  }
}
