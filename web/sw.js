/**
 * sw.js — serves the app from the cache, so it opens without internet and
 * without asking Cloudflare.
 *
 * This file must stay byte-for-byte the same between app versions: then the
 * browser's own periodic check finds nothing new and never updates by itself.
 * Updates happen only through Settings → App → Install (js/update.js).
 */

const CACHE = 'opin-app';

/** A plain copy of a response: body read fully, never flagged as redirected. */
async function rebuild(res) {
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // version.json is written last, so its presence means the cache is complete.
    // If it is missing (first install or an interrupted write), download everything again.
    if (!(await cache.match('/version.json'))) {
      const infoRes = await fetch('/version.json', { cache: 'reload' });
      if (!infoRes.ok) throw new Error('Download failed: /version.json');
      const info = await infoRes.clone().json();
      const fresh = [];
      for (const url of info.files) {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!res.ok) throw new Error(`Download failed: ${url}`);
        fresh.push([url, await rebuild(res)]);
      }
      fresh.push(['/version.json', await rebuild(infoRes)]);
      for (const [url, copy] of fresh) await cache.put(url, copy);
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
  if (request.mode !== 'navigate' && (request.cache === 'no-store' || request.cache === 'reload')) return;

  const key = request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')
    ? '/index.html'
    : url.pathname;
  event.respondWith(
    caches.open(CACHE)
      .then((cache) => cache.match(key))
      .then((hit) => (hit && hit.redirected ? rebuild(hit) : hit) || fetch(request))
  );
});
