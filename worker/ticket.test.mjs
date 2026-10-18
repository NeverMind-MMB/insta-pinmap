import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../web/js/sha256.js';
import { ticketInput, ticketKey, leadingZeroBits, solveTicket, ticketMinute } from '../web/js/ticket.js';
import { verifyTicket } from './ticket.js';

const enc = new TextEncoder();

test('pure-JS SHA-256 matches node:crypto', () => {
  for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'ü€😀']) {
    assert.equal(Buffer.from(sha256(enc.encode(s))).toString('hex'), createHash('sha256').update(s).digest('hex'), `len ${s.length}`);
  }
});

test('ticket key: Instagram shortcodes and keys up to 24 characters stay as they are (apps from before 2.2.0 send them so)', () => {
  for (const code of ['BsOGulcndj-', 'ABCDE', 'yt:AbCdEfGhIj0', 'fb:1234567890123456789', 'A'.repeat(24)]) {
    assert.equal(ticketKey(code), code);
    assert.equal(ticketInput(code, 7, 9), `${code}:7:9`);
  }
});

test('ticket key: a longer key becomes a 24-character hash of all of it, so two keys alike in their first 24 characters never share a ticket', () => {
  const pageA = 'fb:page:synthetic.restaurant.testtown.north';
  const pageB = 'fb:page:synthetic.restaurant.testtown.south';
  const pfbidA = `fb:pfbid${'0Synthetic'.repeat(4)}A`;
  const pfbidB = `fb:pfbid${'0Synthetic'.repeat(4)}B`;
  for (const [a, b] of [[pageA, pageB], [pfbidA, pfbidB], ['A'.repeat(40), 'A'.repeat(41)]]) {
    assert.equal(a.slice(0, 24), b.slice(0, 24));
    assert.equal(ticketKey(a).length, 24, a);
    assert.equal(ticketKey(b).length, 24, b);
    assert.notEqual(ticketKey(a), ticketKey(b));
    assert.notEqual(ticketInput(a, 7, 9), ticketInput(b, 7, 9));
  }
  const hex = createHash('sha256').update(pageA).digest('hex');
  assert.equal(ticketKey(pageA), `~${hex.slice(0, 23)}`, 'the same on every phone and in the Worker');
  assert.equal(ticketKey(pageA), ticketKey(pageA));
});

test('ticket key: a ticket solved for one long key is refused for another with the same first 24 characters', async () => {
  const a = 'fb:page:synthetic.restaurant.testtown.north';
  const b = 'fb:page:synthetic.restaurant.testtown.south';
  const minute = 29000000;
  const nonce = solveTicket(a, minute, 12);
  assert.equal(await verifyTicket({ code: a, minute, nonce, difficulty: 12, nowMinute: minute }), true);
  assert.equal(await verifyTicket({ code: b, minute, nonce, difficulty: 12, nowMinute: minute }), false);
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
