/**
 * extract.js — derive place candidates from an Instagram text.
 *
 * Purely rule-based, no AI, no network. Runs in the browser and in Node
 * (for the tests). Returns a list sorted by likelihood of being a match;
 * the final confirmation is always done by hand.
 */

/* ------------------------------------------------------------------ *
 * Stop lists
 * ------------------------------------------------------------------ */

/** Hashtags that are never a place. */
export const HASHTAG_STOPLIST = new Set([
  // Reach
  'reels', 'reel', 'reelsinstagram', 'explore', 'explorepage', 'fyp', 'foryou', 'foryoupage',
  'viral', 'trending', 'instagood', 'instadaily', 'instagram', 'igers', 'photooftheday',
  'picoftheday', 'follow', 'followme', 'like4like', 'l4l', 'f4f', 'likeforlike', 'ad', 'werbung',
  'anzeige', 'sponsored', 'paidpartnership', 'linkinbio', 'newpost', 'repost',
  // Food
  'food', 'foodie', 'foodporn', 'foodstagram', 'foodblogger', 'foodlover', 'yummy', 'lecker',
  'delicious', 'tasty', 'essen', 'hunger', 'homemade', 'restaurant', 'cafe', 'coffee', 'kaffee',
  'brunch', 'breakfast', 'fruehstueck', 'lunch', 'dinner', 'abendessen', 'dessert', 'cake',
  'kuchen', 'pizza', 'burger', 'sushi', 'pasta', 'vegan', 'vegetarian', 'vegetarisch', 'bio',
  'streetfood', 'bar', 'cocktails', 'drinks', 'wine', 'wein', 'bier', 'beer', 'craftbeer',
  // Travel
  'travel', 'travelgram', 'traveling', 'travelling', 'reise', 'reisen', 'urlaub', 'holiday',
  'vacation', 'wanderlust', 'travelphotography', 'traveltheworld', 'instatravel', 'roadtrip',
  'adventure', 'abenteuer', 'explore_more', 'nature', 'natur', 'mountains', 'berge', 'beach',
  'strand', 'sunset', 'sunrise', 'sonnenuntergang', 'view', 'aussicht', 'landscape', 'hiking',
  'wandern', 'camping', 'vanlife', 'citytrip', 'staedtereise', 'weekendtrip', 'kurzurlaub',
  // General
  'love', 'liebe', 'happy', 'gluecklich', 'fun', 'spass', 'weekend', 'wochenende', 'summer',
  'sommer', 'winter', 'herbst', 'autumn', 'fall', 'spring', 'fruehling', 'friends', 'freunde',
  'family', 'familie', 'life', 'leben', 'lifestyle', 'mood', 'vibes', 'aesthetic', 'ootd',
  'photography', 'fotografie', 'photo', 'foto', 'nofilter', 'throwback', 'tbt', 'memories',
  'erinnerungen', 'goodtimes', 'blessed', 'motivation', 'inspiration', 'style', 'design',
  'art', 'kunst', 'music', 'musik', 'fitness', 'gym', 'sport', 'workout', 'health',
  'gaming', 'games', 'esports', 'shopping', 'sale', 'new', 'neu', 'tipp', 'tipps', 'tip', 'tips',
  'geheimtipp', 'muststay', 'mustsee', 'musttry', 'bucketlist', 'hiddengem', 'insidertipp',
]);

/** Words that are worthless as a place name on their own. */
const WORD_STOPLIST = new Set([
  // Articles, pronouns, filler words
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'aber', 'auch', 'noch', 'schon', 'sehr', 'mehr', 'hier', 'dort',
  'immer', 'wieder', 'nicht', 'kein', 'keine', 'mit', 'ohne', 'für', 'als', 'wie',
  'von', 'vom', 'zum', 'zur', 'nach', 'bei', 'aus', 'auf', 'über', 'unter', 'ich', 'wir',
  'ihr', 'sie', 'man', 'mein', 'meine', 'unser', 'unsere', 'euer', 'eure', 'dein', 'deine',
  'the', 'and', 'this', 'that', 'with', 'from', 'for', 'you', 'your', 'our', 'was', 'were',
  'here', 'there', 'when', 'what', 'which', 'about', 'just', 'some', 'very', 'much',
  // Time words and greetings: they come at the start of a sentence and are capitalized
  'heute', 'gestern', 'morgen', 'abend', 'nacht', 'mittag', 'vormittag', 'nachmittag',
  'guten', 'gute', 'guter', 'gutes', 'hallo', 'hey', 'moin', 'servus', 'tschüss',
  'danke', 'bitte', 'liebe', 'lieber', 'lieben', 'leute', 'freunde', 'grüße', 'gruß',
  'endlich', 'wieder', 'bald', 'gerade', 'eben', 'jetzt', 'damals', 'früher', 'später',
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  'januar', 'februar', 'märz', 'april', 'juni', 'juli', 'august', 'september',
  'oktober', 'november', 'dezember', 'wochenende', 'urlaub', 'ferien',
  'hello', 'good', 'morning', 'evening', 'night', 'today', 'yesterday', 'tomorrow',
  'guys', 'everyone', 'friends', 'thanks', 'please', 'finally', 'again',
  // Ratings
  'best', 'beste', 'bester', 'bestes', 'super', 'toll', 'schön', 'schöne', 'schöner',
  'schönes', 'nice', 'great', 'amazing', 'lecker', 'leckere', 'wunderschön', 'traumhaft',
  'krass', 'geil', 'perfekt', 'perfect', 'love', 'liebe', 'favorite', 'favourite',
  // Extras
  'werbung', 'anzeige', 'link', 'bio', 'infos', 'video', 'reel', 'post', 'story',
  'teil', 'part', 'folge', 'update', 'neu', 'neue', 'neuer', 'news',
  // Everyday nouns. In German every noun is capitalized, so otherwise
  // they slip through as single-word candidates.
  // Deliberately NOT included: Essen, Hamm, Halle, Bergen and similar; these
  // are real city names that must not get lost here.
  'selfie', 'foto', 'fotos', 'bild', 'bilder', 'moment', 'momente', 'aussicht',
  'stadt', 'dorf', 'land', 'leben', 'zeit', 'jahr', 'jahre', 'woche', 'monat',
  'wetter', 'himmel', 'sonne', 'regen', 'schnee', 'arbeit', 'frühstück',
  'stimmung', 'erinnerung', 'erinnerungen', 'freude', 'glück', 'spaziergang',
  'selfies', 'picture', 'photo', 'moment', 'view', 'weather', 'time', 'year',
  'week', 'month', 'life', 'work', 'breakfast', 'memory', 'memories',
]);

/** Is this a word at all, or just a separator? */
function isWord(s) {
  return /[\p{L}\p{N}]/u.test(s);
}

/**
 * Lowercase connectors INSIDE proper names.
 * Without them "Praia da Marinha" breaks off after "Praia" and
 * "Rio de Janeiro" after "Rio".
 *
 * Explicitly NOT included: general prepositions such as an, in, im, auf, zu.
 * They almost always come BEFORE the name rather than inside it; with them
 * "Sunset an der Praia da Marinha" turns into the nonsense "Sunset an der Praia".
 * The marker rule further down handles that role.
 */
const CONNECTORS =
  'von|vom|van|der|den|des|dem|zur|zum|' +
  'da|de|del|della|di|do|dos|das|du|la|le|les|el|los|las|' +
  'of|the|op|ter|sur|sous|aux|al|ibn|bin';

/** Instagram accounts that are never a place. */
const HANDLE_STOPLIST = new Set(['instagram', 'reels', 'explore', 'shop', 'creators']);

/* ------------------------------------------------------------------ *
 * Flag emoji → country code
 * ------------------------------------------------------------------ */

/**
 * Convert regional indicator pairs (🇩🇪 = U+1F1E9 U+1F1EA) into a country code.
 * The code is not used as a candidate of its own but as a filter for all
 * the others; that is exactly what decides Paris/France versus Paris/Texas.
 */
export function flagCountries(text) {
  const out = [];
  const s = String(text || '');
  for (let i = 0; i < s.length - 1; ) {
    const a = s.codePointAt(i);
    if (a >= 0x1f1e6 && a <= 0x1f1ff) {
      const next = i + String.fromCodePoint(a).length;
      const b = s.codePointAt(next);
      if (b >= 0x1f1e6 && b <= 0x1f1ff) {
        const cc = String.fromCharCode(65 + (a - 0x1f1e6)) + String.fromCharCode(65 + (b - 0x1f1e6));
        if (!out.includes(cc)) out.push(cc);
        i = next + String.fromCodePoint(b).length;
        continue;
      }
    }
    i += String.fromCodePoint(a).length;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Country and region words → country code
 * ------------------------------------------------------------------ */

/**
 * German and English names of countries and unambiguous regions.
 * Data, so the German words stay German.
 *
 * Deliberately NOT included, because they clash with food, names or other
 * places: turkey, chile, georgia, jordan, china (porcelain) and "island"
 * (an ordinary English word; "iceland" is in).
 */
const COUNTRY_WORDS = {
  // Countries
  DE: 'deutschland germany',
  AT: 'österreich oesterreich austria',
  CH: 'schweiz switzerland suisse svizzera',
  IT: 'italien italy italia',
  FR: 'frankreich france',
  ES: 'spanien spain españa espana',
  PT: 'portugal',
  NL: 'niederlande netherlands holland',
  BE: 'belgien belgium',
  DK: 'dänemark daenemark denmark',
  NO: 'norwegen norway norge',
  SE: 'schweden sweden sverige',
  FI: 'finnland finland',
  IS: 'iceland',
  IE: 'irland ireland',
  GB: 'schottland scotland england wales',
  GR: 'griechenland greece',
  HR: 'kroatien croatia hrvatska',
  SI: 'slowenien slovenia',
  CZ: 'tschechien czechia',
  PL: 'polen poland polska',
  HU: 'ungarn hungary',
  JP: 'japan',
  TH: 'thailand',
  ID: 'indonesien indonesia',
  US: 'usa',
  CA: 'kanada canada',
  AU: 'australien australia',
  NZ: 'neuseeland',
  MA: 'marokko morocco',
  // Regions
  _DE: 'bayern bavaria franken allgäu allgaeu schwarzwald rügen sylt',
  _AT: 'tirol salzkammergut steiermark kärnten kaernten salzburgerland wachau',
  _IT: 'südtirol suedtirol dolomiten dolomites toskana tuscany sizilien sicily sardinien sardinia amalfi cinqueterre',
  _PT: 'algarve madeira azoren azores',
  _FR: 'provence bretagne brittany normandie normandy korsika corsica',
  _ES: 'mallorca andalusien andalusia kanaren canaries teneriffa tenerife',
  _NO: 'lofoten',
  _ID: 'bali',
};

const WORD_TO_COUNTRY = new Map();
for (const [key, words] of Object.entries(COUNTRY_WORDS)) {
  for (const w of words.split(' ')) WORD_TO_COUNTRY.set(w, key.replace('_', ''));
}

/**
 * Country codes named in a text by country or region words, in order of
 * first appearance. Whole words only; hashtags are split with tagToWords
 * first ("#VisitAustria" counts, "#bavarianalps" does not).
 */
export function countryHints(text) {
  const spaced = String(text || '').replace(/#([\p{L}\p{N}_]+)/gu, (_, tag) => ' ' + tagToWords(tag) + ' ');
  const out = [];
  for (const m of spaced.toLowerCase().matchAll(/[\p{L}]+/gu)) {
    const cc = WORD_TO_COUNTRY.get(m[0]);
    if (cc && !out.includes(cc)) out.push(cc);
  }
  return out;
}

/** Flag emoji for a 2-letter country code; '' for anything else. */
export function flagEmoji(countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(0x1f1e6 + cc.charCodeAt(0) - 65, 0x1f1e6 + cc.charCodeAt(1) - 65);
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Removes emoji and symbol clutter, keeps letters. */
function withoutEmoji(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanUp(s) {
  return withoutEmoji(s)
    .replace(/^[\s\-–—•·:,.!?"'`«»„“”()[\]{}]+/, '')
    .replace(/[\s\-–—•·:,.!?"'`«»„“”()[\]{}]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Split CamelCase and snake_case into words: NuernbergFood → "Nuernberg Food". */
export function tagToWords(tag) {
  let s = String(tag || '').replace(/^#/, '');
  s = s.replace(/[_.]+/g, ' ');
  // Split before an uppercase letter that follows a lowercase letter/digit
  s = s.replace(/([a-zäöüß0-9])([A-ZÄÖÜ])/g, '$1 $2');
  // End of an uppercase run before a normal word: OSMKarte → OSM Karte
  s = s.replace(/([A-ZÄÖÜ]{2,})([A-ZÄÖÜ][a-zäöüß])/g, '$1 $2');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * A name may neither end with a connector ("Rio de") nor start with an
 * article ("der Praia da Marinha").
 */
function trimConnectors(s) {
  const connectorSet = new Set(CONNECTORS.split('|'));
  const articles = new Set(['der', 'die', 'das', 'dem', 'den', 'the']);
  const words = String(s).split(/\s+/).filter(Boolean);
  while (words.length > 1 && connectorSet.has(words[words.length - 1].toLowerCase())) words.pop();
  while (words.length > 1 && articles.has(words[0].toLowerCase())) words.shift();
  return words.join(' ');
}

function isValidName(s) {
  const t = trimConnectors(cleanUp(s));
  if (t.length < 3 || t.length > 80) return false;
  if (!/[a-zA-ZäöüÄÖÜß]/.test(t)) return false;

  // Only rate real words. Otherwise a separator rescues the match:
  // "Werbung | Anzeige" passed the check because the | is in no stop list
  // and the every() condition therefore failed.
  const words = t.toLowerCase().split(/[\s,]+/).filter(isWord);
  if (!words.length) return false;
  if (words.every((w) => WORD_STOPLIST.has(w))) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Candidate extraction
 * ------------------------------------------------------------------ */

/** Explicit place markers. Highest likelihood of a match. */
const MARKERS = [
  // 📍 place   /   📌 place   /   🗺 place
  { re: /[\u{1F4CD}\u{1F4CC}\u{1F5FA}\u{1F3E0}]\s*([^\n#@]{3,80})/gu, points: 100 },
  // "Location: X" / "Ort: X" / "Adresse: X" / "Wo: X"
  { re: /\b(?:location|ort|adresse|address|standort|wo|where|spot|place)\s*[:\-–]\s*([^\n#@]{3,80})/gi, points: 95 },
  // "@ place" with a space: Instagram's old way of writing a location
  { re: /(?:^|\s)@\s+([A-ZÄÖÜ][^\n#@]{2,60})/gm, points: 85 },
  // "im/in/an/bei/at Xyz", only if followed by a capitalized word.
  // The article may come along ("an der Praia …") and is cut off afterwards.
  {
    re: new RegExp(
      `\\b(?:in|im|an|am|auf|bei|beim|vor|nahe|neben|near|at|from|aus|to|nach)\\s+` +
      `((?:der |die |das |dem |den |the )?` +
      `(?:[A-ZÄÖÜ][\\wäöüß'’-]*)(?:[ -](?:[A-ZÄÖÜ][\\wäöüß'’-]*|${CONNECTORS})){0,4})`,
      'g'
    ),
    points: 70,
  },
];

/**
 * @param {string} caption   the post text
 * @param {object} [extra]   { username, location } if available
 * @returns {{candidates: Array, countries: string[], hashtags: string[], hintedCountries: string[]}}
 */
export function placeCandidates(caption, extra = {}) {
  const text = String(caption || '');
  const countries = flagCountries(text);
  const matches = new Map(); // lowercased -> {text, points, source}

  const add = (raw, points, source) => {
    const t = trimConnectors(cleanUp(raw));
    if (!isValidName(t)) return;
    const key = t.toLowerCase();
    const existing = matches.get(key);
    if (!existing || existing.points < points) matches.set(key, { text: t, points, source });
    else if (existing.source !== source) existing.points += 6; // confirmed from two directions
  };

  // 0) A location name supplied by Instagram beats everything else.
  if (extra.location) add(extra.location, 130, 'instagram');

  // 1) Explicit markers
  for (const { re, points } of MARKERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Cut at separators: "📍 Nürnberg | Werbung" -> "Nürnberg".
      // And at the end of a sentence, otherwise "Ort: Elbphilharmonie Hamburg.
      // Konzert war Wahnsinn" becomes a single, useless search term.
      const raw = m[1]
        .split(/[.!?]\s+|\s+[–—-]\s+|\s*[|•·]\s*|\s{2,}|,\s*(?=[a-z])/)[0]
        .replace(/[.!?]+$/, '');
      add(raw, points, 'marker');
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  // 2) @ mentions: on Instagram, shops' accounts are often named like the shop
  const handles = [...text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9._]{3,30})\b/g)].map((m) => m[1]);
  for (const h of handles) {
    if (HANDLE_STOPLIST.has(h.toLowerCase())) continue;
    if (extra.username && h.toLowerCase() === String(extra.username).toLowerCase()) continue;
    const words = tagToWords(h);
    add(words, 55, 'handle');
  }

  // 3) Hashtags
  const hashtags = [...text.matchAll(/#([\p{L}\p{N}_]{2,50})/gu)].map((m) => m[1]);
  for (const tag of hashtags) {
    const lower = tag.toLowerCase();
    if (HASHTAG_STOPLIST.has(lower)) continue;
    if (/^\d+$/.test(tag)) continue;
    const words = tagToWords(tag);
    // A single word starting with an uppercase letter is often a place name
    const points = words.includes(' ') ? 45 : 50;
    add(words, points, 'hashtag');
  }

  // 4) The remaining sentence.
  //
  // The most important case of all, and originally overlooked: captions that
  // consist of nothing but the place name and one or two emoji: "Zermatt 🇨🇭❄️".
  // The word-sequence rule further down needs at least two words and never
  // finds such names. If, after removing emoji, hashtags, mentions and URLs,
  // something short remains that looks like a name, it is very likely
  // exactly the place we are looking for.
  const rest = withoutEmoji(
    text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .replace(/@[A-Za-z0-9._]+/g, ' ')
  )
    // Cut at separators, otherwise "Werbung | Anzeige" becomes a single
    // match that no stop list can catch any more.
    .split(/\s*[|•·]\s*|\s+[–—]\s+/)[0]
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (rest && rest.length <= 70 && !/[!?;:]|\.\s/.test(rest)) {
    const words = rest.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    const capitalShare = words.filter((w) => /^[A-ZÄÖÜ]/.test(w)).length / words.length;
    // At most five words, mostly capitalized, and a capitalized start:
    // "Zermatt", "Praia da Marinha", "Cinque Terre, Italien" pass,
    // "Nur ein Selfie, nichts weiter" does not.
    if (words.length <= 5 && capitalShare >= 0.5 && /^[A-ZÄÖÜ]/.test(rest)) {
      add(rest, 80, 'remainder');
    }
  }

  // 5) Capitalized word sequences in running text (proper names)
  const stripped = withoutEmoji(text.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/@[A-Za-z0-9._]+/g, ' '));
  const properNameRe = new RegExp(
    `(?:^|[.!?:;,]\\s+|\\s)` +
    `((?:[A-ZÄÖÜ][\\wäöüß'’-]{1,})(?:[ -](?:[A-ZÄÖÜ][\\wäöüß'’-]{1,}|${CONNECTORS})){1,4})`,
    'g'
  );
  for (const line of stripped.split('\n')) {
    const re = new RegExp(properNameRe.source, 'g');
    let m;
    while ((m = re.exec(line)) !== null) {
      add(m[1], 30, 'properName');
      if (m.index === re.lastIndex) re.lastIndex++;
    }

    // Single capitalized words as weak candidates. In German every noun is
    // capitalized, so this is thin evidence, hence few points. But it is
    // enough that "Neuschwanstein" in the middle of a sentence is not
    // lost entirely.
    const single = /(?:^|[.!?:;,]\s+|\s)([A-ZÄÖÜ][\p{L}äöüß'’-]{3,})(?=$|[\s.!?:;,])/gu;
    let e;
    while ((e = single.exec(line)) !== null) {
      add(e[1], 22, 'singleWord');
      if (e.index === single.lastIndex) single.lastIndex++;
    }
  }

  const candidates = [...matches.values()]
    .sort((a, b) => b.points - a.points || a.text.length - b.text.length)
    .slice(0, 8);

  const hintedCountries = countryHints(text).filter((c) => !countries.includes(c));

  return { candidates, countries, hashtags, hintedCountries };
}

/* ------------------------------------------------------------------ *
 * Tag suggestions
 * ------------------------------------------------------------------ */

/**
 * The caption text without emoji, hashtags, mentions and URLs.
 * Used to prefill the search field when the automatic extraction finds
 * nothing: a starting point to trim down is better than an empty field.
 */
export function cleanedText(caption) {
  return withoutEmoji(
    String(caption || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .replace(/@[A-Za-z0-9._]+/g, ' ')
  )
    .split(/\n|\s*[|•·]\s*/)[0]
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80);
}

/** The post's hashtags, filtered and normalized, as tag suggestions. */
export function tagSuggestions(caption, extraStops = []) {
  const stops = new Set([...HASHTAG_STOPLIST, ...extraStops.map((s) => String(s).toLowerCase())]);
  const result = [];
  const seen = new Set();
  for (const m of String(caption || '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) {
    const tag = m[1];
    const lower = tag.toLowerCase();
    if (stops.has(lower) || seen.has(lower) || /^\d+$/.test(tag)) continue;
    seen.add(lower);
    result.push(lower);
    if (result.length >= 12) break;
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Rating matches
 * ------------------------------------------------------------------ */

/** Specific places are more likely meant than whole cities or countries. */
const CATEGORY_POINTS = {
  amenity: 30, shop: 30, tourism: 28, leisure: 26, historic: 24, craft: 22,
  building: 12, natural: 14, waterway: 10,
  highway: 4, place: 8, boundary: -8, administrative: -8,
};
const KIND_POINTS = {
  cafe: 6, restaurant: 6, bar: 6, pub: 6, bakery: 5, hotel: 5, museum: 5,
  attraction: 5, viewpoint: 5, park: 4, beach: 4, peak: 3,
  city: 2, town: 1, village: 0, suburb: -2, neighbourhood: -3,
  country: -14, state: -10, county: -8, road: -6, residential: -6, house: -4,
};

/**
 * Rates geocoder matches for a candidate.
 * @param {Array} matches  normalized matches from the server
 * @param {object} ctx     { candidatePoints, countries, hintedCountries }
 */
export function scoreMatches(matches, ctx = {}) {
  const { candidatePoints = 50, countries = [], hintedCountries = [] } = ctx;
  return matches
    .map((t) => {
      let p = candidatePoints;
      p += CATEGORY_POINTS[t.category] ?? 0;
      p += KIND_POINTS[t.kind] ?? 0;
      if (typeof t.importance === 'number') p += t.importance * 20;
      if (countries.length) {
        // A flag in the post is a strong signal
        p += countries.includes(t.countryCode) ? 35 : -25;
      } else if (hintedCountries.length) {
        // A country or region word is weaker, and only counts without a flag
        p += hintedCountries.includes(t.countryCode) ? 20 : -10;
      }
      if (!t.address) p -= 5;
      return { ...t, points: Math.round(p) };
    })
    .sort((a, b) => b.points - a.points);
}

/* ------------------------------------------------------------------ *
 * Dates: when the event in a caption takes place
 * ------------------------------------------------------------------ */

/** Month words, English and German, full names and common abbreviations (data). */
const MONTH_WORDS = {
  january: 1, jan: 1, januar: 1, jänner: 1,
  february: 2, feb: 2, febr: 2, februar: 2,
  march: 3, mar: 3, märz: 3, maerz: 3, mär: 3, mrz: 3,
  april: 4, apr: 4,
  may: 5, mai: 5,
  june: 6, jun: 6, juni: 6,
  july: 7, jul: 7, juli: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, oktober: 10, okt: 10,
  november: 11, nov: 11,
  december: 12, dec: 12, dezember: 12, dez: 12,
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH = String.raw`(${Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join('|')})\.?(?!\p{L})`;
const DAY = String.raw`(\d{1,2})`;
const ORD = String.raw`(?:st|nd|rd|th)?`;
/** Month words that "Month day" may start with: English (and shared) only — German never writes "März 10". */
const EN_MONTH_WORDS = [
  'january', 'jan', 'february', 'feb', 'march', 'mar', 'april', 'apr', 'may', 'june', 'jun',
  'july', 'jul', 'august', 'aug', 'september', 'sept', 'sep', 'october', 'oct', 'november', 'nov',
  'december', 'dec',
];
/** English month words that are also everyday lowercase words ("you may", "we march"). */
const LOWERCASE_WORDS = new Set(['may', 'march', 'mar']);

const EN_MONTH = String.raw`(${[...EN_MONTH_WORDS].sort((a, b) => b.length - a.length).join('|')})\.?(?!\p{L})`;
/** Between two days: a range or a pair ("1. und 2. Oktober" → 1–2 Oct). */
const DASH = String.raw`\s*(?:[-–—]|bis|to|until|till|und|and|&)\s*`;
/** A number followed by one of these is a time, price, distance or count, not a day. */
const NOT_A_DAY = String.raw`(?!\s*(?:uhr|h|am|pm|a\.m\.|p\.m\.|€|eur|euro|km|m|mi|miles?|min|mal|x|%|tage?|days?|years?|jahre?|stunden|hours?|weeks?|wochen)(?!\p{L}))`;
const YEAR = String.raw`(?:,?\s+(\d{4})(?!\d))?`;
/** Before a day number: no letter, digit, dash or number/price sign ("9.000", "€14.09", "v2.0"). */
const LEAD_NUM = String.raw`(^|[^\p{L}\p{N}.,:/€$£_\-–—])`;
const LEAD_WORD = String.raw`(^|[^\p{L}\p{N}_])`;
const MONTH_PREFIX = String.raw`(?:im|in|this|next|diesen|nächsten|kommenden|anfang|mitte|ende|early|mid|late|end of|beginning of|start of)`;

/** Each pattern reads { d1, d2, month | monthWord, year } from its match; group 1 is the lead character. */
const DATE_PATTERNS = [
  // 14.09.2026 · 14.9.26 · 14.09. · 14.–16.09. · 14.-16.9.2026
  { re: String.raw`${LEAD_NUM}${DAY}\.(?:${DASH}${DAY}\.)?(\d{1,2})\.(\d{4}|\d{2})?(?!\d|\.\d)`,
    read: (m) => ({ d1: m[2], d2: m[3], month: m[4], year: m[5] }) },
  // 14. September (2026) · 14.–16. September · 14. bis 16. September · 14 Sep · 14-16 Sep 2026 · 14th of September
  { re: String.raw`${LEAD_NUM}${DAY}(?:\.|${ORD})(?:${DASH}${DAY}(?:\.|${ORD}))?${NOT_A_DAY}\s*(?:of\s+)?${MONTH}${YEAR}`,
    read: (m) => ({ d1: m[2], d2: m[3], monthWord: m[4], year: m[5] }) },
  // September 14(, 2026) · Sept 14-16 · Sep 14th — not "Sep 10 km", "June 10am-2pm", "Sept 9-17 Uhr"
  { re: String.raw`${LEAD_WORD}${EN_MONTH}\s*${DAY}(${ORD})(?:${DASH}${DAY}${ORD})?${NOT_A_DAY}(?!${DASH}\d)${YEAR}(?![\d:]|[.,]\d)`,
    read: (m) => ({ monthWord: m[2], d1: m[3], d2: m[5], year: m[6],
      // "with Jan 2 friends": a bare "Jan <day>" is too often the name; it needs an ordinal, range or year.
      nameLike: /^jan$/i.test(m[2]) && !/^jan\./i.test(m[0].slice(m[1].length)) && !m[4] && !m[5] && !m[6] }) },
  // im / in / this / Ende / Anfang September (2026) — not when a day follows
  { re: String.raw`${LEAD_WORD}${MONTH_PREFIX}[\s-]+${MONTH}(?:\s+(\d{4})(?!\d)|(?!\s*\d))`,
    read: (m) => ({ monthWord: m[2], year: m[3] }) },
  // September 2026
  { re: String.raw`${LEAD_WORD}${MONTH}\s+(\d{4})(?!\d)`,
    read: (m) => ({ monthWord: m[2], year: m[3] }) },
].map((p) => ({ ...p, re: new RegExp(p.re, 'giu') }));

/** Links, @handles, hashtags and phone numbers never hold the event date. */
const DATE_NOISE = /(?:https?:\/\/|www\.)\S+|@[\p{L}\p{N}_.]+|#[\p{L}\p{N}_]+|(?:\+\d{1,3}|\(?0\d{2,5}\)?)(?:[\s/()-]*\d){5,}/gu;

const pad2 = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

function isRealDay(iso) {
  const m = ISO_DAY.exec(String(iso || ''));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo);
}

const dayMs = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const dayDistance = (a, b) => Math.abs(dayMs(a) - dayMs(b));

function addDays(iso, days) {
  const d = new Date(dayMs(iso) + days * 86400000);
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function localToday() {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** '2019-01-04' → '4 Jan 2019' (the same in every locale); '' for anything else. */
export function formatDay(iso) {
  if (!isRealDay(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]} ${y}`;
}

/** Applies the year rules to what a pattern read; null if it is no real date. */
function resolveDate({ d1, d2, month, monthWord, year, nameLike }, postedAt, today) {
  if (nameLike) return null;
  if (monthWord != null) {
    const word = monthWord.toLowerCase();
    if (LOWERCASE_WORDS.has(word) && monthWord[0] === word[0]) return null; // "you may 14 …", "we march 4 …"
    month = MONTH_WORDS[word];
  }
  month = Number(month);
  if (!(month >= 1 && month <= 12)) return null;

  const monthOnly = d1 == null;
  const first = monthOnly ? 1 : Number(d1);
  const lastDay = monthOnly || d2 == null ? null : Number(d2);
  if (first < 1 || (lastDay != null && lastDay < first)) return null;

  const span = (yy) => {
    const last = monthOnly ? daysIn(yy, month) : lastDay ?? first;
    return last > daysIn(yy, month) ? null : { from: isoOf(yy, month, first), to: isoOf(yy, month, last), last };
  };

  const posted = isRealDay(postedAt) ? postedAt : '';
  const explicit = year != null;
  let y;
  let r;
  if (explicit) {
    y = year.length === 2 ? 2000 + Number(year) : Number(year);
    if (y < 1900 || y > 2199) return null;
    r = span(y);
    if (!r) return null;
    // History ("Seit 14.09.2015", "Born on 14.09.1985") is no event to go to.
    const cutoff = posted ? addDays(posted, -30) : addDays(today, -365);
    if (r.to < cutoff) return null;
  } else {
    // The occurrence closest to the post date (or today): a December post about "14.01." means next January.
    const anchor = posted || today;
    const anchorYear = Number(anchor.slice(0, 4));
    for (const yy of [anchorYear - 1, anchorYear, anchorYear + 1]) {
      const s = span(yy);
      if (s && (!r || dayDistance(s.from, anchor) < dayDistance(r.from, anchor))) { r = s; y = yy; }
    }
    if (!r) return null;
  }

  const mon = SHORT_MONTHS[month - 1];
  const text = monthOnly ? `${mon} ${y}`
    : r.last === first ? `${first} ${mon} ${y}`
      : `${first}–${r.last} ${mon} ${y}`;
  if (r.to >= today) return { from: r.from, to: r.to, monthOnly, yearly: false, text };

  // Already over: most likely something that comes back every year. Recurring events
  // rarely keep their exact days, so only the month of the next occurrence is suggested.
  let next = y + 1;
  while (isoOf(next, month, daysIn(next, month)) < today) next++;
  return {
    from: isoOf(next, month, 1),
    to: isoOf(next, month, daysIn(next, month)),
    monthOnly: true,
    yearly: true,
    text: `${mon} ${next}, probably yearly (last: ${text})`,
  };
}

/**
 * The date an event in the caption takes place, if the caption names one.
 * The first date in the text wins.
 * Without a year, the occurrence closest to the post date (or today) is meant.
 * Explicit dates more than 30 days before the post (a year before today without
 * a post date) are history and skipped. A date that is over becomes the month
 * of its next occurrence: "Sep 2027, probably yearly (last: 14–16 Sep 2025)".
 * @param {string} caption
 * @param {object} [ctx]  { postedAt: 'YYYY-MM-DD' | '', today: 'YYYY-MM-DD' (default: today) }
 * @returns {null | {from: string, to: string, monthOnly: boolean, yearly: boolean, text: string}}
 */
export function eventDate(caption, { postedAt = '', today = '' } = {}) {
  const text = String(caption || '').replace(DATE_NOISE, (s) => ' '.repeat(s.length));
  if (!/\d|\p{L}/u.test(text)) return null;
  const now = isRealDay(today) ? today : localToday();

  let best = null;
  for (const { re, read } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index + m[1].length;
      if (best && start > best.start) break;
      const result = resolveDate(read(m), postedAt, now);
      if (result) {
        const length = m[0].length - m[1].length;
        if (!best || start < best.start || length > best.length) best = { start, length, result };
        break;
      }
      re.lastIndex = m.index + 1;
    }
  }
  return best ? best.result : null;
}
