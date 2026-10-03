/**
 * sw.js — service worker.
 *
 * Two jobs:
 *  1. Make the app installable (Chrome requires a service worker for that).
 *  2. Keep the interface and libraries available offline, so the app
 *     starts even without a network. Map tiles and Instagram of course
 *     still need a connection.
 *
 * Explicitly NOT cached: /api/*. The data should always come fresh from
 * the server, otherwise you see old pins.
 */

const VERSION = 'ortsammlung-v1';
const HUELLE = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/store.js',
  '/js/map.js',
  '/js/ui.js',
  '/js/addflow.js',
  '/js/extract.js',
  '/js/dedupe.js',
  '/js/importers.js',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/markercluster/leaflet.markercluster.js',
  '/vendor/markercluster/MarkerCluster.css',
  '/vendor/markercluster/MarkerCluster.Default.css',
  '/vendor/fflate.js',
  '/vendor/togeojson.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // One by one, so a missing file does not break the whole installation
      .then((c) => Promise.all(HUELLE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Foreign origins (tiles, Instagram embeds) pass straight through.
  if (url.origin !== self.location.origin) return;

  // Never serve data and APIs from the cache.
  if (url.pathname.startsWith('/api/') || url.pathname === '/share') return;

  // On navigation: network first, the cached start page if that fails.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html').then((r) => r || fehlseite()))
    );
    return;
  }

  // Otherwise: cache first, refresh in the background.
  e.respondWith(
    caches.match(e.request).then((treffer) => {
      const ausNetz = fetch(e.request)
        .then((antwort) => {
          if (antwort.ok && e.request.method === 'GET') {
            const kopie = antwort.clone();
            caches.open(VERSION).then((c) => c.put(e.request, kopie)).catch(() => {});
          }
          return antwort;
        })
        .catch(() => treffer);
      return treffer || ausNetz;
    })
  );
});

function fehlseite() {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Not reachable</title>
     <style>body{font:16px/1.6 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;
     place-items:center;background:#16181c;color:#e9e6e1;text-align:center;padding:24px}
     code{background:#2b2f36;padding:2px 6px;border-radius:4px}</style></head>
     <body><div><h1>The mini server is not running</h1>
     <p>Start it with <code>node server.js</code> —<br>in Termux with <code>./start-termux.sh</code>.</p>
     </div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
  );
}
