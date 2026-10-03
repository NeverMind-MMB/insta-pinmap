/**
 * sw.js — serves the app from the cache, so it opens without internet and
 * without asking Cloudflare.
 *
 * This file must stay byte-for-byte the same between app versions: then the
 * browser's own periodic check finds nothing new and never updates by itself.
 * Updates happen only through Settings → App → Install (js/update.js).
 */

const CACHE = 'insta-pinmap-app';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    if ((await cache.keys()).length === 0) {
      const info = await (await fetch('/version.json', { cache: 'reload' })).json();
      await cache.addAll(['/version.json', ...info.files]);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Update checks and downloads must reach the network.
  if (request.cache === 'no-store' || request.cache === 'reload') return;

  const key = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')
    ? '/index.html'
    : url.pathname;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(key))
      .then((hit) => hit || fetch(request))
  );
});
