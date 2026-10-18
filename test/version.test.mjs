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

/** Runs sw.js's install handler against a fake cache and network. */
async function runSwInstall({ cached = [], network }) {
  const { runInNewContext } = await import('node:vm');
  const store = new Map(cached.map((u) => [u, new Response('old')]));
  const puts = [];
  const fetched = [];
  const listeners = {};
  const cache = {
    match: async (key) => store.get(typeof key === 'string' ? key : key.url) || undefined,
    keys: async () => [...store.keys()],
    put: async (key, res) => { puts.push(key); store.set(key, res); },
  };
  const context = {
    self: { addEventListener: (type, fn) => { listeners[type] = fn; }, skipWaiting: async () => {} },
    caches: { open: async () => cache },
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : new URL(req.url).pathname;
      fetched.push(url);
      return network(url);
    },
    Request: class { constructor(url, init) { this.url = `https://app.example${url}`; this.init = init; } },
    Response, URL,
  };
  runInNewContext(readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8'), context);
  let done;
  listeners.install({ waitUntil: (p) => { done = p; } });
  let error = null;
  try { await done; } catch (e) { error = e; }
  return { puts, fetched, error };
}

const SW_INFO = { version: '9.9.9', files: ['/index.html', '/js/app.js'] };
const okNetwork = (url) => url === '/version.json'
  ? new Response(JSON.stringify(SW_INFO), { headers: { 'content-type': 'application/json' } })
  : new Response(`file ${url}`);

test('sw.js install: fills an empty cache and writes version.json last', async () => {
  const r = await runSwInstall({ network: okNetwork });
  assert.equal(r.error, null);
  assert.deepEqual(r.puts, ['/index.html', '/js/app.js', '/version.json']);
});

test('sw.js install: a partly written cache without version.json is filled again', async () => {
  const r = await runSwInstall({ cached: ['/index.html'], network: okNetwork });
  assert.deepEqual(r.puts, ['/index.html', '/js/app.js', '/version.json']);
});

test('sw.js install: a complete cache is left alone', async () => {
  const r = await runSwInstall({ cached: ['/index.html', '/js/app.js', '/version.json'], network: okNetwork });
  assert.deepEqual(r.fetched, []);
  assert.deepEqual(r.puts, []);
});

test('sw.js install: a failed version.json or file download writes nothing', async () => {
  const badInfo = await runSwInstall({ network: (url) => (url === '/version.json' ? new Response('gone', { status: 503 }) : okNetwork(url)) });
  assert.ok(badInfo.error);
  assert.deepEqual(badInfo.puts, []);
  const badFile = await runSwInstall({ network: (url) => (url === '/js/app.js' ? new Response('gone', { status: 404 }) : okNetwork(url)) });
  assert.ok(badFile.error);
  assert.deepEqual(badFile.puts, []);
});

test('index.html has the startup guard before the app module, and app.js reports its start', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const guard = html.indexOf('Reinstall app files');
  assert.ok(guard > 0);
  assert.ok(guard < html.indexOf('<script type="module"'));
  assert.ok(html.includes("caches.delete('insta-pinmap-app')"));
  assert.ok(!/indexedDB/i.test(html.slice(html.lastIndexOf('<script>', guard), html.indexOf('</script>', guard))), 'the guard must not touch pins');
  const app = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('window.__instaPinmapStarted = true'));
});

/* ---------- 2.1.0 oPin ---------- */

test('version.json lists every icon, the source logos and /favicon.ico', () => {
  const walk = (dir) => readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`]));
  const files = [...walk('../web/icons/').map((f) => f.replace('../web', '')), '/favicon.ico'];
  assert.ok(files.includes('/icons/sources/google.png') && files.includes('/icons/settings.png'));
  for (const f of files) assert.ok(info.files.includes(f), `${f} not in version.json`);
});

test('index.html: the pinwheel as favicon, touch icon and top-bar logo, the settings drawing on its button', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
  assert.match(html, /<link rel="icon" href="\/icons\/icon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png">/);
  assert.match(html, /class="topbar__title">\s*<img class="topbar__logo" src="\/icons\/icon\.svg" alt="">/);
  assert.match(html, /id="btn-settings"[^>]*>\s*<img src="\/icons\/settings\.png" alt="" width="24" height="24">\s*<\/button>/);
});

test('the app is called oPin: page title, top bar, manifest, self-test (internal names stay)', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /<title>oPin<\/title>/);
  assert.match(html, /<span>oPin<\/span>\s*<\/h1>/);
  assert.ok(!/Insta Pinmap/.test(html), 'no old name on the page');
  const manifest = JSON.parse(readFileSync(new URL('../web/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'oPin');
  assert.equal(manifest.short_name, 'oPin');
  assert.match(readFileSync(new URL('../web/selftest.html', import.meta.url), 'utf8'), /<title>Self-test — oPin<\/title>/);
  assert.match(html, /caches\.delete\('insta-pinmap-app'\)/, 'the cache keeps its name');
});
