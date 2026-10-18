/**
 * iglocation.js — the location tag of a public Instagram post.
 *
 * The page Instagram gives Googlebot holds the post's own media object far
 * behind </head> (around 400–520 KB into a 700 KB page): "code", "taken_at",
 * "media_type", … and then one flat dict
 *   "location":{"__typename":"XDTLocationDict","pk":…,"lat":…,"lng":…,"name":"…",…}
 * Untagged posts have "location":null. The facebookexternalhit page lacks it.
 * Unofficial, like the caption trick: if the structure changes, posts simply
 * come back without a location.
 */

const MARK = '"location":{"__typename":"XDTLocationDict"';
const CODE_KEY = '"code":"';
const MAX_CODE_DISTANCE = 4000; // the post's "code" stood 124 characters before its tag
const MAX_DICT_LENGTH = 4000;
const MAX_TAGS = 50;

/** The JSON object that starts at `start`, as text, or null if it doesn't end within `max` characters. */
function objectAt(s, start, max) {
  if (s[start] !== '{') return null;
  const end = Math.min(s.length, start + max);
  let depth = 0;
  let inString = false;
  for (let i = start; i < end; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function number(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The "code" value closest before `at`, if near enough. */
function codeBefore(s, at) {
  const key = s.lastIndexOf(CODE_KEY, at);
  if (key === -1 || at - key > MAX_CODE_DISTANCE) return '';
  const start = key + CODE_KEY.length;
  const end = s.indexOf('"', start);
  return end === -1 ? '' : s.slice(start, end);
}

/**
 * `{ name, lat, lon, address? }` of the location tag of post `code`, or null.
 * Only a dict right after this post's own "code" counts, so a tagged post in the
 * page's "more posts" list is never taken for an untagged one.
 * @param {string} html  the whole page, before anything cuts it at </head>
 * @param {string} code  the post's shortcode
 */
export function readLocationTag(html, code) {
  const s = typeof html === 'string' ? html : '';
  let found = 0;
  for (let at = s.indexOf(MARK); at !== -1 && found < MAX_TAGS; at = s.indexOf(MARK, at + MARK.length)) {
    found++;
    if (codeBefore(s, at) !== code) continue;
    const text = objectAt(s, at + '"location":'.length, MAX_DICT_LENGTH);
    if (!text) continue;
    let dict;
    try {
      dict = JSON.parse(text);
    } catch {
      continue;
    }
    const name = cleanText(dict.name, 200);
    const lat = number(dict.lat);
    const lon = number(dict.lng ?? dict.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const address = cleanText(dict.address, 300);
    return address ? { name, lat, lon, address } : { name, lat, lon };
  }
  return null;
}
