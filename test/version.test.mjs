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

test('rebuildResponse drops the redirected flag and keeps body, status and type', async () => {
  const { rebuildResponse } = await import('../web/js/update.js');
  const src = new Response('<!DOCTYPE html>hi', { status: 200, headers: { 'content-type': 'text/html' } });
  Object.defineProperty(src, 'redirected', { value: true });
  const out = await rebuildResponse(src);
  assert.equal(out.redirected, false);
  assert.equal(out.status, 200);
  assert.equal(out.headers.get('content-type'), 'text/html');
  assert.equal(await out.text(), '<!DOCTYPE html>hi');
});

test('sw.js has no version number and handles redirected cache hits', () => {
  const sw = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
  assert.ok(!/\d+\.\d+\.\d+/.test(sw));
  assert.ok(sw.includes('hit.redirected'));
  assert.ok(sw.includes("request.mode !== 'navigate'"));
});
