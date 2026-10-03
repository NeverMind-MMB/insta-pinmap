/**
 * update.js — "Check for updates" and "Install" in Settings → App.
 * The service worker never updates itself (see sw.js).
 */

import { APP_VERSION, compareVersions } from './version.js';

const CACHE = 'insta-pinmap-app';

export async function checkForUpdate() {
  const res = await fetch('/version.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('The update server did not answer.');
  const info = await res.json();
  return { current: APP_VERSION, latest: info.version, available: compareVersions(info.version, APP_VERSION) > 0, info };
}

/** Downloads everything first; only a complete download replaces the cached app. */
export async function installUpdate(info) {
  const fresh = [];
  for (const file of ['/version.json', ...info.files]) {
    const res = await fetch(file, { cache: 'reload' });
    if (!res.ok) throw new Error(`Download failed: ${file}`);
    fresh.push([file, res]);
  }
  const cache = await caches.open(CACHE);
  for (const [file, res] of fresh) await cache.put(file, res);
  location.reload();
}
