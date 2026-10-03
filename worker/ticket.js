/**
 * ticket.js — checks a work ticket with WebCrypto (one hash).
 * Input format must match web/js/ticket.js.
 */

import { ticketInput, leadingZeroBits, TICKET_WINDOW } from '../web/js/ticket.js';

export async function verifyTicket({ code, minute, nonce, difficulty, nowMinute }) {
  const m = Number(minute);
  const n = String(nonce);
  if (!Number.isInteger(m) || !/^\d{1,16}$/.test(n)) return false;
  if (Math.abs(m - nowMinute) > TICKET_WINDOW) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticketInput(code, m, n))));
  return leadingZeroBits(digest) >= difficulty;
}
