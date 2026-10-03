import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minuteWithOffset } from '../web/js/api.js';

test('minuteWithOffset applies the server clock difference', () => {
  const now = Date.UTC(2026, 9, 4, 12, 0, 30);
  assert.equal(minuteWithOffset(now, 0), Math.floor(now / 60000));
  assert.equal(minuteWithOffset(now, -7), Math.floor(now / 60000) - 7);
});
