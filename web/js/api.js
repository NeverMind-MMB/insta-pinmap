/**
 * api.js — the calls that go to the oPin Worker.
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

/**
 * A YouTube video or Facebook post, reel or page through /api/post
 * (worker/post.js), with a work ticket over its post key (postlinks.js).
 * Same retry rules as fetchPost.
 */
export async function fetchSocialPost(link, key) {
  const failed = { ok: false, reason: 'ticket', message: "Couldn't read this post." };
  for (let attempt = 0; attempt < 2; attempt++) {
    const minute = minuteWithOffset(Date.now(), minuteOffset);
    let res;
    try {
      const nonce = await solveInWorker(key, minute, difficulty);
      res = await fetch(`/api/post?url=${encodeURIComponent(link)}&m=${minute}&n=${nonce}`);
    } catch (err) {
      if (err instanceof SolveTimeout) return failed;
      return { ok: false, reason: 'network', message: 'No internet. Try again later.' };
    }
    noteVersion(res);
    difficulty = adoptDifficulty(res.headers.get('X-Work-Difficulty'), difficulty);
    if (res.status === 403 && res.headers.has('X-Work-Difficulty')) {
      const serverMinute = Number(res.headers.get('X-Server-Minute'));
      if (Number.isFinite(serverMinute)) minuteOffset = serverMinute - Math.floor(Date.now() / 60000);
      continue;
    }
    if (res.status === 429) return { ok: false, reason: 'rate-limit', message: 'Too many requests. Wait a minute and try again.' };
    try {
      return await res.json();
    } catch {
      return { ok: false, reason: 'bad-response', message: "Couldn't read this post." };
    }
  }
  return failed;
}

/**
 * Title, channel and thumbnail of a YouTube video straight from YouTube's
 * oEmbed (CORS open, no Worker): the fallback when /api/post can't read the
 * video. null when that fails too.
 */
export async function fetchYouTubeOembed(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || typeof j.title !== 'string' || !j.title) return null;
    const thumb = typeof j.thumbnail_url === 'string' && j.thumbnail_url.startsWith('https://i.ytimg.com/') ? j.thumbnail_url : '';
    return { ok: true, kind: 'youtube', url, title: j.title, text: '', author: String(j.author_name || ''), thumb };
  } catch {
    return null;
  }
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
