/**
 * instagram.js — read caption, username and image of a public Instagram post.
 *
 * Instagram returns the caption in <meta name="description"> only to crawlers
 * (Googlebot, facebookexternalhit); a normal browser identity gets an empty
 * shell. This is unofficial and can stop working at any time — the app then
 * falls back to manual search.
 */

export const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,40}$/;

export const CRAWLER_USER_AGENTS = [
  'Googlebot/2.1 (+http://www.google.com/bot.html)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
];

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Content of <meta name="key"> or <meta property="key">, attribute order does not matter. */
export function metaContent(html, key) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const id = tag.match(/\b(?:name|property)\s*=\s*"([^"]*)"/i);
    if (!id || id[1].toLowerCase() !== key.toLowerCase()) continue;
    const content = tag.match(/\bcontent\s*=\s*"([^"]*)"/i);
    return content ? decodeEntities(content[1]) : '';
  }
  return null;
}

/**
 * '<likes>, <comments> - <username> <date word> <date>: "<caption>"'
 * The date word depends on the language ("on", "am", …).
 */
export function parseDescription(text) {
  const s = String(text || '').trim();
  const dash = s.indexOf(' - ');
  const open = s.indexOf(': "');
  const close = s.lastIndexOf('"');
  if (dash === -1 || open === -1 || close <= open + 2) return { username: '', caption: s };
  const username = (s.slice(dash + 3).match(/^[A-Za-z0-9._]+/) || [''])[0];
  return { username, caption: s.slice(open + 3, close).trim() };
}

/** Everything up to the first </head>: the meta tags live there, and less text costs less CPU time. */
export function headOnly(html) {
  const s = String(html || '');
  const end = s.search(/<\/head\s*>/i);
  return end === -1 ? s : s.slice(0, end);
}

export function parsePostPage(fullHtml) {
  const html = headOnly(fullHtml);
  const description = metaContent(html, 'description') ?? metaContent(html, 'og:description');
  const imageUrl = metaContent(html, 'og:image') || '';
  if (!description && !imageUrl) return null;
  const { username, caption } = parseDescription(description || '');
  return { username, caption, imageUrl };
}

export async function fetchPost(code, fetchFn = fetch) {
  if (!SHORTCODE_RE.test(String(code || ''))) {
    return { ok: false, reason: 'bad-code', message: "That isn't an Instagram post link." };
  }
  let reason = 'not-found';
  for (const ua of CRAWLER_USER_AGENTS) {
    let res;
    try {
      res = await fetchFn(`https://www.instagram.com/p/${code}/`, {
        headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.8,de;q=0.6' },
        redirect: 'manual',
      });
    } catch {
      reason = 'network';
      continue;
    }
    if (res.status !== 200) { reason = `http-${res.status}`; continue; }
    const page = parsePostPage(await res.text());
    if (page && (page.caption || page.imageUrl)) {
      return { ok: true, shortcode: code, caption: page.caption, username: page.username, imageUrl: page.imageUrl };
    }
    reason = 'not-found';
  }
  return { ok: false, reason, message: "Couldn't read this post." };
}

/** Inlines a small image as a data: URL, because Instagram image links expire. */
export async function imageAsDataUrl(url, fetchFn = fetch, maxBytes = 200 * 1024) {
  if (!url) return '';
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') return '';
    const host = parsedUrl.hostname;
    const allowedHosts = ['cdninstagram.com', 'fbcdn.net', 'instagram.com'];
    const isAllowed = allowedHosts.includes(host) || allowedHosts.some(h => host.endsWith('.' + h));
    if (!isAllowed) return '';
    const res = await fetchFn(url, { redirect: 'manual' });
    if (!res.ok) return '';
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\//.test(type)) return '';
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) return '';
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return '';
  }
}
