/**
 * api.js — the calls that go to the Insta Pinmap Worker.
 * Each /api/ig call carries a work ticket (see ticket.js).
 */

let difficulty = 18;         // updated from X-Work-Difficulty
let minuteOffset = 0;        // server minute − phone minute, from X-Server-Minute
let versionListener = () => {};

export function onServerVersion(fn) { versionListener = fn; }

export function minuteWithOffset(nowMs, offsetMinutes) {
  return Math.floor(nowMs / 60000) + offsetMinutes;
}

const SOLVE_TIMEOUT_MS = 60000;

/** Takes the server's difficulty header; accepts integers, clamped to 8..26, anything else keeps `current`. */
export function adoptDifficulty(headerValue, current) {
  if (headerValue === null || headerValue === undefined || String(headerValue).trim() === '') return current;
  const n = Number(headerValue);
  if (!Number.isInteger(n)) return current;
  return Math.min(26, Math.max(8, n));
}

class SolveTimeout extends Error {}

function solveInWorker(code, minute, bits) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/js/ticket-worker.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new SolveTimeout('Ticket took too long')); }, SOLVE_TIMEOUT_MS);
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); resolve(e.data.nonce); };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message || 'Ticket worker failed')); };
    worker.postMessage({ code, minute, difficulty: bits });
  });
}

function noteVersion(res) {
  const v = res.headers.get('X-App-Version');
  if (v) versionListener(v);
}

export async function fetchPost(code) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const minute = minuteWithOffset(Date.now(), minuteOffset);
    let res;
    try {
      const nonce = await solveInWorker(code, minute, difficulty);
      res = await fetch(`/api/ig?code=${encodeURIComponent(code)}&m=${minute}&n=${nonce}`);
    } catch (err) {
      if (err instanceof SolveTimeout) return { ok: false, reason: 'ticket', message: "Couldn't read this post." };
      return { ok: false, reason: 'network', message: 'No internet. Try again later.' };
    }
    noteVersion(res);
    difficulty = adoptDifficulty(res.headers.get('X-Work-Difficulty'), difficulty);
    if (res.status === 403 && res.headers.has('X-Work-Difficulty')) {
      const serverMinute = Number(res.headers.get('X-Server-Minute'));
      if (Number.isFinite(serverMinute)) minuteOffset = serverMinute - Math.floor(Date.now() / 60000);
      continue;
    }
    if (res.status === 429) {
      return { ok: false, reason: 'rate-limit', message: 'Too many requests. Wait a minute and try again.' };
    }
    try {
      return await res.json();
    } catch {
      return { ok: false, reason: 'bad-response', message: "Couldn't read this post." };
    }
  }
  return { ok: false, reason: 'ticket', message: "Couldn't read this post." };
}

export async function resolveShortLink(url) {
  try {
    const res = await fetch(`/api/resolve?url=${encodeURIComponent(url)}`);
    noteVersion(res);
    return await res.json();
  } catch {
    return { ok: false, message: 'No internet. Try again later.' };
  }
}

const APPLE_BATCH = 10; // the Worker takes at most 10 IDs per call

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RATE_LIMIT_WAIT_MS = 61000; // the Worker counts per minute; one minute plus a second is always enough

/** Retry-After in whole seconds (1..300) → ms; anything else → the fixed wait. */
function retryAfterMs(header) {
  const s = String(header ?? '').trim();
  if (!/^\d+$/.test(s)) return RATE_LIMIT_WAIT_MS;
  const n = Number(s);
  return n >= 1 && n <= 300 ? n * 1000 : RATE_LIMIT_WAIT_MS;
}

/**
 * Looks up Apple Maps places by ID through the Worker, 10 per call, one call after the other.
 * onProgress(done, total, info) after each call; info.waitSeconds while waiting for the rate limit.
 * After a 429 it waits once (Retry-After seconds if given, else 61 s); a second 429 or a network error leaves the
 * remaining IDs unresolved. Never throws.
 * @returns {Promise<Map<string, {id, ok, name, address, lat, lon}>>} only the places found
 */
export async function resolveApplePlaces(ids, onProgress = () => {}, { sleep = wait } = {}) {
  const found = new Map();
  let waited = false;
  let done = 0;
  for (let i = 0; i < ids.length;) {
    const batch = ids.slice(i, i + APPLE_BATCH);
    let res;
    let body;
    try {
      res = await fetch(`/api/apple-places?ids=${batch.join(',')}`);
      noteVersion(res);
      if (res.status === 429) {
        if (waited) break;
        waited = true;
        const ms = retryAfterMs(res.headers.get('Retry-After'));
        onProgress(done, ids.length, { waitSeconds: ms / 1000 });
        await sleep(ms);
        continue;
      }
      body = await res.json();
    } catch {
      break;
    }
    for (const p of body?.places || []) {
      if (p?.ok && batch.includes(p.id) && Number.isFinite(p.lat) && Number.isFinite(p.lon)) found.set(p.id, p);
    }
    i += batch.length;
    done = i;
    onProgress(done, ids.length, {});
  }
  return found;
}
