/**
 * update.js — "Check for updates" and "Install" in Settings → App.
 * The service worker never updates itself (see sw.js).
 */

import { APP_VERSION, compareVersions } from './version.js';

const CACHE = 'opin-app';

export async function checkForUpdate() {
  const res = await fetch('/version.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('The update server did not answer.');
  const info = await res.json();
  return { current: APP_VERSION, latest: info.version, available: compareVersions(info.version, APP_VERSION) > 0, info };
}

/** A plain copy of a response: body read fully, never flagged as redirected. */
export async function rebuildResponse(res) {
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Downloads everything first; only a complete download replaces the cached app. */
export async function installUpdate(info) {
  const fresh = [];
  for (const file of [...info.files, '/version.json']) {
    const res = await fetch(file, { cache: 'reload' });
    if (!res.ok) throw new Error(`Download failed: ${file}`);
    fresh.push([file, await rebuildResponse(res)]);
  }
  const cache = await caches.open(CACHE);
  // version.json goes last: an interrupted write leaves the old version number, so the update is offered again.
  for (const [file, copy] of fresh) await cache.put(file, copy);
  location.reload();
}
