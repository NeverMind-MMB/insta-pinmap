import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minuteWithOffset } from '../web/js/api.js';

test('minuteWithOffset applies the server clock difference', () => {
  const now = Date.UTC(2026, 9, 4, 12, 0, 30);
  assert.equal(minuteWithOffset(now, 0), Math.floor(now / 60000));
  assert.equal(minuteWithOffset(now, -7), Math.floor(now / 60000) - 7);
});

import { adoptDifficulty } from '../web/js/api.js';

test('adoptDifficulty accepts 8..26, clamps, and ignores garbage', () => {
  assert.equal(adoptDifficulty('18', 20), 18);
  assert.equal(adoptDifficulty('30', 18), 26);
  assert.equal(adoptDifficulty('2', 18), 8);
  assert.equal(adoptDifficulty('abc', 18), 18);
  assert.equal(adoptDifficulty(null, 18), 18);
});
