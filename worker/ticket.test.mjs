import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../web/js/sha256.js';
import { ticketInput, leadingZeroBits, solveTicket, ticketMinute } from '../web/js/ticket.js';
import { verifyTicket } from './ticket.js';

const enc = new TextEncoder();

test('pure-JS SHA-256 matches node:crypto', () => {
  for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'ü€😀']) {
    assert.equal(Buffer.from(sha256(enc.encode(s))).toString('hex'), createHash('sha256').update(s).digest('hex'), `len ${s.length}`);
  }
});

test('ticket input cuts long codes to 24 characters', () => {
  assert.equal(ticketInput('A'.repeat(40), 7, 9), `${'A'.repeat(24)}:7:9`);
});

test('leadingZeroBits', () => {
  assert.equal(leadingZeroBits(new Uint8Array([0, 0, 0x10, 0xff])), 19);
  assert.equal(leadingZeroBits(new Uint8Array([0x80])), 0);
});

test('solved ticket is accepted, wrong nonce rejected', async () => {
  const minute = ticketMinute(Date.UTC(2026, 9, 4, 12, 0));
  const nonce = solveTicket('BsOGulcndj-', minute, 14);
  const bits = leadingZeroBits(sha256(enc.encode(ticketInput('BsOGulcndj-', minute, nonce))));
  assert.ok(bits >= 14, `solver result only has ${bits} bits`);
  assert.equal(await verifyTicket({ code: 'BsOGulcndj-', minute, nonce, difficulty: 14, nowMinute: minute }), true);
  let wrong = nonce + 1;
  while (leadingZeroBits(sha256(enc.encode(ticketInput('BsOGulcndj-', minute, wrong)))) >= 14) wrong++;
  assert.equal(await verifyTicket({ code: 'BsOGulcndj-', minute, nonce: wrong, difficulty: 14, nowMinute: minute }), false);
});

test('ticket outside ±2 minutes or malformed is rejected', async () => {
  const minute = 29000000;
  const nonce = solveTicket('ABCDE', minute, 8);
  assert.equal(await verifyTicket({ code: 'ABCDE', minute, nonce, difficulty: 8, nowMinute: minute + 2 }), true);
  assert.equal(await verifyTicket({ code: 'ABCDE', minute, nonce, difficulty: 8, nowMinute: minute + 3 }), false);
  assert.equal(await verifyTicket({ code: 'ABCDE', minute: 'x', nonce, difficulty: 8, nowMinute: minute }), false);
  assert.equal(await verifyTicket({ code: 'ABCDE', minute, nonce: '1e3', difficulty: 8, nowMinute: minute }), false);
});
