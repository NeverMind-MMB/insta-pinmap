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
export const HASHTAG_STOPP = new Set([
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
const WORT_STOPP = new Set([
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
function istWort(s) {
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
const VERBINDER =
  'von|vom|van|der|den|des|dem|zur|zum|' +
  'da|de|del|della|di|do|dos|das|du|la|le|les|el|los|las|' +
  'of|the|op|ter|sur|sous|aux|al|ibn|bin';

/** Instagram accounts that are never a place. */
const HANDLE_STOPP = new Set(['instagram', 'reels', 'explore', 'shop', 'creators']);

/* ------------------------------------------------------------------ *
 * Flag emoji → country code
 * ------------------------------------------------------------------ */

/**
 * Convert regional indicator pairs (🇩🇪 = U+1F1E9 U+1F1EA) into a country code.
 * The code is not used as a candidate of its own but as a filter for all
 * the others; that is exactly what decides Paris/France versus Paris/Texas.
 */
export function flaggenLaender(text) {
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
 * Small helpers
 * ------------------------------------------------------------------ */

/** Removes emoji and symbol clutter, keeps letters. */
function ohneEmoji(s) {
  return String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function saeubern(s) {
  return ohneEmoji(s)
    .replace(/^[\s\-–—•·:,.!?"'`«»„“”()[\]{}]+/, '')
    .replace(/[\s\-–—•·:,.!?"'`«»„“”()[\]{}]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Split CamelCase and snake_case into words: NuernbergFood → "Nuernberg Food". */
export function tagInWorte(tag) {
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
function trimmVerbinder(s) {
  const verb = new Set(VERBINDER.split('|'));
  const artikel = new Set(['der', 'die', 'das', 'dem', 'den', 'the']);
  const worte = String(s).split(/\s+/).filter(Boolean);
  while (worte.length > 1 && verb.has(worte[worte.length - 1].toLowerCase())) worte.pop();
  while (worte.length > 1 && artikel.has(worte[0].toLowerCase())) worte.shift();
  return worte.join(' ');
}

function gueltigerName(s) {
  const t = trimmVerbinder(saeubern(s));
  if (t.length < 3 || t.length > 80) return false;
  if (!/[a-zA-ZäöüÄÖÜß]/.test(t)) return false;

  // Only rate real words. Otherwise a separator rescues the match:
  // "Werbung | Anzeige" passed the check because the | is in no stop list
  // and the every() condition therefore failed.
  const worte = t.toLowerCase().split(/[\s,]+/).filter(istWort);
  if (!worte.length) return false;
  if (worte.every((w) => WORT_STOPP.has(w))) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Candidate extraction
 * ------------------------------------------------------------------ */

/** Explicit place markers. Highest likelihood of a match. */
const MARKER = [
  // 📍 place   /   📌 place   /   🗺 place
  { re: /[\u{1F4CD}\u{1F4CC}\u{1F5FA}\u{1F3E0}]\s*([^\n#@]{3,80})/gu, punkte: 100 },
  // "Location: X" / "Ort: X" / "Adresse: X" / "Wo: X"
  { re: /\b(?:location|ort|adresse|address|standort|wo|where|spot|place)\s*[:\-–]\s*([^\n#@]{3,80})/gi, punkte: 95 },
  // "@ place" with a space: Instagram's old way of writing a location
  { re: /(?:^|\s)@\s+([A-ZÄÖÜ][^\n#@]{2,60})/gm, punkte: 85 },
  // "im/in/an/bei/at Xyz", only if followed by a capitalized word.
  // The article may come along ("an der Praia …") and is cut off afterwards.
  {
    re: new RegExp(
      `\\b(?:in|im|an|am|auf|bei|beim|vor|nahe|neben|near|at|from|aus|to|nach)\\s+` +
      `((?:der |die |das |dem |den |the )?` +
      `(?:[A-ZÄÖÜ][\\wäöüß'’-]*)(?:[ -](?:[A-ZÄÖÜ][\\wäöüß'’-]*|${VERBINDER})){0,4})`,
      'g'
    ),
    punkte: 70,
  },
];

/**
 * @param {string} caption   the post text
 * @param {object} [extra]   { username, location } if available
 * @returns {{candidates: Array, countries: string[], hashtags: string[]}}
 */
export function ortsKandidaten(caption, extra = {}) {
  const text = String(caption || '');
  const countries = flaggenLaender(text);
  const treffer = new Map(); // lowercased -> {text, punkte, quelle}

  const add = (roh, punkte, quelle) => {
    const t = trimmVerbinder(saeubern(roh));
    if (!gueltigerName(t)) return;
    const key = t.toLowerCase();
    const alt = treffer.get(key);
    if (!alt || alt.punkte < punkte) treffer.set(key, { text: t, punkte, quelle });
    else if (alt.quelle !== quelle) alt.punkte += 6; // confirmed from two directions
  };

  // 0) A location name supplied by Instagram beats everything else.
  if (extra.location) add(extra.location, 130, 'instagram');

  // 1) Explicit markers
  for (const { re, punkte } of MARKER) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Cut at separators: "📍 Nürnberg | Werbung" -> "Nürnberg".
      // And at the end of a sentence, otherwise "Ort: Elbphilharmonie Hamburg.
      // Konzert war Wahnsinn" becomes a single, useless search term.
      const roh = m[1]
        .split(/[.!?]\s+|\s+[–—-]\s+|\s*[|•·]\s*|\s{2,}|,\s*(?=[a-z])/)[0]
        .replace(/[.!?]+$/, '');
      add(roh, punkte, 'marker');
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  // 2) @ mentions: on Instagram, shops' accounts are often named like the shop
  const handles = [...text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9._]{3,30})\b/g)].map((m) => m[1]);
  for (const h of handles) {
    if (HANDLE_STOPP.has(h.toLowerCase())) continue;
    if (extra.username && h.toLowerCase() === String(extra.username).toLowerCase()) continue;
    const worte = tagInWorte(h);
    add(worte, 55, 'handle');
  }

  // 3) Hashtags
  const hashtags = [...text.matchAll(/#([\p{L}\p{N}_]{2,50})/gu)].map((m) => m[1]);
  for (const tag of hashtags) {
    const klein = tag.toLowerCase();
    if (HASHTAG_STOPP.has(klein)) continue;
    if (/^\d+$/.test(tag)) continue;
    const worte = tagInWorte(tag);
    // A single word starting with an uppercase letter is often a place name
    const punkte = worte.includes(' ') ? 45 : 50;
    add(worte, punkte, 'hashtag');
  }

  // 4) The remaining sentence.
  //
  // The most important case of all, and originally overlooked: captions that
  // consist of nothing but the place name and one or two emoji: "Zermatt 🇨🇭❄️".
  // The word-sequence rule further down needs at least two words and never
  // finds such names. If, after removing emoji, hashtags, mentions and URLs,
  // something short remains that looks like a name, it is very likely
  // exactly the place we are looking for.
  const rest = ohneEmoji(
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
    const worte = rest.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    const grossAnteil = worte.filter((w) => /^[A-ZÄÖÜ]/.test(w)).length / worte.length;
    // At most five words, mostly capitalized, and a capitalized start:
    // "Zermatt", "Praia da Marinha", "Cinque Terre, Italien" pass,
    // "Nur ein Selfie, nichts weiter" does not.
    if (worte.length <= 5 && grossAnteil >= 0.5 && /^[A-ZÄÖÜ]/.test(rest)) {
      add(rest, 80, 'restsatz');
    }
  }

  // 5) Capitalized word sequences in running text (proper names)
  const ohne = ohneEmoji(text.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/@[A-Za-z0-9._]+/g, ' '));
  const eigennameRe = new RegExp(
    `(?:^|[.!?:;,]\\s+|\\s)` +
    `((?:[A-ZÄÖÜ][\\wäöüß'’-]{1,})(?:[ -](?:[A-ZÄÖÜ][\\wäöüß'’-]{1,}|${VERBINDER})){1,4})`,
    'g'
  );
  for (const zeile of ohne.split('\n')) {
    const re = new RegExp(eigennameRe.source, 'g');
    let m;
    while ((m = re.exec(zeile)) !== null) {
      add(m[1], 30, 'eigenname');
      if (m.index === re.lastIndex) re.lastIndex++;
    }

    // Single capitalized words as weak candidates. In German every noun is
    // capitalized, so this is thin evidence, hence few points. But it is
    // enough that "Neuschwanstein" in the middle of a sentence is not
    // lost entirely.
    const einzel = /(?:^|[.!?:;,]\s+|\s)([A-ZÄÖÜ][\p{L}äöüß'’-]{3,})(?=$|[\s.!?:;,])/gu;
    let e;
    while ((e = einzel.exec(zeile)) !== null) {
      add(e[1], 22, 'einzelwort');
      if (e.index === einzel.lastIndex) einzel.lastIndex++;
    }
  }

  const candidates = [...treffer.values()]
    .sort((a, b) => b.punkte - a.punkte || a.text.length - b.text.length)
    .slice(0, 8);

  return { candidates, countries, hashtags };
}

/* ------------------------------------------------------------------ *
 * Tag suggestions
 * ------------------------------------------------------------------ */

/**
 * The caption text without emoji, hashtags, mentions and URLs.
 * Used to prefill the search field when the automatic extraction finds
 * nothing: a starting point to trim down is better than an empty field.
 */
export function sauberterText(caption) {
  return ohneEmoji(
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
export function tagVorschlaege(caption, zusatzStopp = []) {
  const stopp = new Set([...HASHTAG_STOPP, ...zusatzStopp.map((s) => String(s).toLowerCase())]);
  const raus = [];
  const gesehen = new Set();
  for (const m of String(caption || '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) {
    const tag = m[1];
    const klein = tag.toLowerCase();
    if (stopp.has(klein) || gesehen.has(klein) || /^\d+$/.test(tag)) continue;
    gesehen.add(klein);
    raus.push(klein);
    if (raus.length >= 12) break;
  }
  return raus;
}

/* ------------------------------------------------------------------ *
 * Rating matches
 * ------------------------------------------------------------------ */

/** Specific places are more likely meant than whole cities or countries. */
const ART_PUNKTE = {
  amenity: 30, shop: 30, tourism: 28, leisure: 26, historic: 24, craft: 22,
  building: 12, natural: 14, waterway: 10,
  highway: 4, place: 8, boundary: -8, administrative: -8,
};
const KIND_PUNKTE = {
  cafe: 6, restaurant: 6, bar: 6, pub: 6, bakery: 5, hotel: 5, museum: 5,
  attraction: 5, viewpoint: 5, park: 4, beach: 4, peak: 3,
  city: 2, town: 1, village: 0, suburb: -2, neighbourhood: -3,
  country: -14, state: -10, county: -8, road: -6, residential: -6, house: -4,
};

/**
 * Rates geocoder matches for a candidate.
 * @param {Array} treffer  normalized matches from the server
 * @param {object} ctx     { kandidatPunkte, countries }
 */
export function bewerteTreffer(treffer, ctx = {}) {
  const { kandidatPunkte = 50, countries = [] } = ctx;
  return treffer
    .map((t) => {
      let p = kandidatPunkte;
      p += ART_PUNKTE[t.category] ?? 0;
      p += KIND_PUNKTE[t.kind] ?? 0;
      if (typeof t.importance === 'number') p += t.importance * 20;
      if (countries.length) {
        // A flag in the post is a strong signal
        p += countries.includes(t.countryCode) ? 35 : -25;
      }
      if (!t.address) p -= 5;
      return { ...t, punkte: Math.round(p) };
    })
    .sort((a, b) => b.punkte - a.punkte);
}
