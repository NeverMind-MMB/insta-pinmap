import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { APP_VERSION, compareVersions } from '../web/js/version.js';

const info = JSON.parse(readFileSync(new URL('../web/version.json', import.meta.url), 'utf8'));

test('version.js and version.json agree', () => {
  assert.equal(APP_VERSION, info.version);
});

test('compareVersions', () => {
  assert.equal(compareVersions('2.0.1', '2.0.0'), 1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.9.9', '2.0.0'), -1);
  assert.equal(compareVersions('2.10.0', '2.9.0'), 1);
});

test('every listed file exists and every app module is listed', () => {
  for (const f of info.files) assert.ok(existsSync(new URL(`../web${f}`, import.meta.url)), `missing ${f}`);
  const modules = readdirSync(new URL('../web/js/', import.meta.url)).filter((n) => n.endsWith('.js'));
  for (const m of modules) assert.ok(info.files.includes(`/js/${m}`), `/js/${m} not in version.json`);
  assert.ok(info.files.includes('/index.html'));
});
