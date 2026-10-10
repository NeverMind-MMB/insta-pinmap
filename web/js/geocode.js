/**
 * geocode.js — place search straight from the browser.
 *
 * Photon first (allows search-as-you-type), Nominatim as fallback. Both allow
 * browser requests (CORS). Nominatim's rules: at most one request per second
 * and no search-as-you-type — the queue below enforces the first, and the app
 * only searches on button press or once per candidate. Please keep it that way.
 */

export function makeQueue(gapMs) {
  let last = 0;
  let chain = Promise.resolve();
  return function queued(fn) {
    const run = chain.then(async () => {
      const wait = Math.max(0, last + gapMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}

const photonQueue = makeQueue(250);
const nominatimQueue = makeQueue(1100);

export function normPhoton(json) {
  return (json?.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    const parts = [p.name, p.street && `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}`, p.postcode,
      p.city || p.town || p.village, p.state, p.country];
    return {
      lat, lon,
      name: p.name || p.street || p.city || p.country || '',
      address: [...new Set(parts.filter(Boolean))].join(', '),
      kind: p.osm_value || p.type || '',
      category: p.osm_key || '',
      countryCode: (p.countrycode || '').toUpperCase(),
      importance: typeof p.importance === 'number' ? p.importance : null,
      source: 'photon',
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

export function normNominatim(arr) {
  return (arr || []).map((r) => ({
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    name: r.name || (r.display_name || '').split(',')[0],
    address: r.display_name || '',
    kind: r.type || '',
    category: r.class || '',
    countryCode: (r.address?.country_code || '').toUpperCase(),
    importance: typeof r.importance === 'number' ? r.importance : null,
    source: 'nominatim',
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

function browserLanguage() {
  return String(globalThis.navigator?.language || 'en').slice(0, 2).toLowerCase();
}

export async function searchPlaces(q, { limit = 8, countryCode = '', lang = browserLanguage() } = {}) {
  const query = String(q || '').trim();
  if (!query) return { ok: true, results: [], provider: 'none' };

  let answered = false;   // at least one provider replied successfully

  try {
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('lang', ['de', 'en', 'fr'].includes(lang) ? lang : 'en');
    const res = await photonQueue(() => fetch(u.href));
    if (res.ok) {
      const results = normPhoton(await res.json());
      answered = true;
      if (results.length) return { ok: true, results, provider: 'photon' };
    }
  } catch { /* fall through to Nominatim */ }

  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('addressdetails', '1');
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('accept-language', lang);
    if (countryCode) u.searchParams.set('countrycodes', countryCode.toLowerCase());
    const res = await nominatimQueue(() => fetch(u.href));
    if (res.ok) {
      const results = normNominatim(await res.json());
      answered = true;
      if (results.length) return { ok: true, results, provider: 'nominatim' };
    }
  } catch { /* nothing left */ }

  // A provider answered, but knows nothing: that is a result, not an outage.
  if (answered) return { ok: true, results: [], provider: 'none' };
  return { ok: false, results: [], provider: 'none', message: "Place search isn't responding." };
}
