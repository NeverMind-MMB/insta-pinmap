/**
 * ticket.js — the "work ticket" that keeps scripts from using /api/ig in bulk.
 *
 * For each request the app finds a nonce so that
 * SHA-256("<code, max 24 chars>:<minute>:<nonce>") starts with `difficulty`
 * zero bits. That costs the phone about a second and the Worker one hash to check.
 * Same input format as worker/ticket.js — change both together.
 */

import { firstWordOfSingleBlock } from './sha256.js';

export const TICKET_WINDOW = 2; // minutes either side the Worker accepts

export function ticketMinute(nowMs = Date.now()) {
  return Math.floor(nowMs / 60000);
}

export function ticketInput(code, minute, nonce) {
  return `${String(code).slice(0, 24)}:${minute}:${nonce}`;
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
