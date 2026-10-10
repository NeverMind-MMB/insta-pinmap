import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseApplePlaceHtml, parseShortcutResults, shortcutInput, SHORTCUT_RUN_URL,
  applyShortcutResults, savePendingGuide, loadPendingGuide, clearPendingGuide, PENDING_GUIDE_KEY,
} from '../web/js/appleplace.js';
import { appleIdEntries } from '../web/js/importers.js';

/** The head of a real Apple Maps place page (trimmed), as served after the auid redirect. */
function appleHead({ name = 'Clutch23', lat = '48.8196266', lon = '9.2741936', title = 'Clutch23 in Fellbach, Germany - Apple Maps' } = {}) {
  return `<!DOCTYPE html>
<html lang="en-US" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>${title}</title>
<meta name="referrer" content="origin">
<link rel="canonical" href="https://maps.apple.com/place?place-id=I3841F79471A20254">
<meta property="place:location:latitude" content="${lat}">
<meta property="place:location:longitude" content="${lon}">
<meta property="og:title" content="${name}">
<meta property="og:image" content="https://snapshot.apple-mapkit.com/api/v1/snapshot?center=${lat},${lon}&amp;spn=0.009">
<meta name="description" content=" View details about ${name} on Apple Maps.">
</head><body><div id="app"><meta property="og:title" content="Body Title"></div></body></html>`;
}

/* ---------- parseApplePlaceHtml ---------- */

test('parseApplePlaceHtml: name, coordinates and address from the place page head', () => {
  assert.deepEqual(parseApplePlaceHtml(appleHead()), {
    name: 'Clutch23', lat: 48.8196266, lon: 9.2741936, address: 'Fellbach, Germany',
  });
});

test('parseApplePlaceHtml: decodes entities; a name containing " in " keeps the address', () => {
  const p = parseApplePlaceHtml(appleHead({
    name: 'Caf&#233; &amp; Bar in Town', title: 'Caf&#233; &amp; Bar in Town in M&#252;nchen, Germany - Apple Maps',
  }));
  assert.equal(p.name, 'Café & Bar in Town');
  assert.equal(p.address, 'München, Germany');
});

test('parseApplePlaceHtml: another title shape gives an empty address, not a failure', () => {
  const p = parseApplePlaceHtml(appleHead({ title: 'Apple Maps' }));
  assert.equal(p.name, 'Clutch23');
  assert.equal(p.address, '');
});

test('parseApplePlaceHtml: null without name or usable coordinates, and meta tags count only in the head', () => {
  assert.equal(parseApplePlaceHtml(appleHead({ lat: 'abc' })), null);
  assert.equal(parseApplePlaceHtml(appleHead({ lat: '91' })), null);
  assert.equal(parseApplePlaceHtml(appleHead({ name: '' })), null);
  assert.equal(parseApplePlaceHtml('<html><head><title>Apple Maps</title></head></html>'), null);
  assert.equal(parseApplePlaceHtml(''), null);
  assert.equal(parseApplePlaceHtml(undefined), null);
  const bodyOnly = '<html><head><title>X - Apple Maps</title></head><body><meta property="og:title" content="Body">' +
    '<meta property="place:location:latitude" content="1"><meta property="place:location:longitude" content="2"></body></html>';
  assert.equal(parseApplePlaceHtml(bodyOnly), null);
});

/* ---------- parseShortcutResults ---------- */

test('parseShortcutResults: "@@" lines with the full URL or the bare id', () => {
  const text = [
    'https://maps.apple.com/place?auid=4053793356543820372@@Clutch23@@48.8196266@@9.2741936@@Fellbach, Germany',
    '14921016072022586346@@Second@@52.5@@13.4@@Berlin, Germany',
  ].join('\n');
  const r = parseShortcutResults(text);
  assert.ok(r instanceof Map);
  assert.deepEqual([...r.keys()], ['4053793356543820372', '14921016072022586346']);
  assert.deepEqual(r.get('4053793356543820372'), { name: 'Clutch23', lat: 48.8196266, lon: 9.2741936, address: 'Fellbach, Germany' });
  assert.deepEqual(r.get('14921016072022586346'), { name: 'Second', lat: 52.5, lon: 13.4, address: 'Berlin, Germany' });
});

test('parseShortcutResults: spaces, CRLF, tabs, entities and decimal commas', () => {
  const text = [
    '  https://maps.apple.com/place?auid=1 @@ Caf&#233; &amp; Bar @@ 48,8196 @@ 9,2741 @@ Rock &#39;n&#x27; Roll &quot;Str&quot;, M&#252;nchen  ',
    '2\tTab Place\t-33.8688\t151.2093\tSydney, Australia',
    '3@@No Address@@1.5@@2.5',
  ].join('\r\n');
  const r = parseShortcutResults(text);
  assert.deepEqual(r.get('1'), { name: 'Café & Bar', lat: 48.8196, lon: 9.2741, address: 'Rock \'n\' Roll "Str", München' });
  assert.deepEqual(r.get('2'), { name: 'Tab Place', lat: -33.8688, lon: 151.2093, address: 'Sydney, Australia' });
  assert.deepEqual(r.get('3'), { name: 'No Address', lat: 1.5, lon: 2.5, address: '' });
});

test('parseShortcutResults: empty, failed and broken lines are ignored', () => {
  const text = [
    '',
    '   ',
    'https://maps.apple.com/place?auid=10@@@@@@@@',                 // the page had nothing
    '11@@Name only@@@@@@Somewhere',                                   // no coordinates
    '12@@Bad lat@@abc@@9@@x',
    '13@@Out of range@@95@@9@@x',
    'not-an-id@@Name@@1@@2@@x',
    'https://example.com/place?auid=14@@Foreign@@1@@2@@x',
    'just some text',
    '15@@Good@@1@@2@@x',
  ].join('\n');
  const r = parseShortcutResults(text);
  assert.deepEqual([...r.keys()], ['15']);
  assert.equal(parseShortcutResults('').size, 0);
  assert.equal(parseShortcutResults(undefined).size, 0);
});

test('parseShortcutResults: a missing name falls back to "Apple Maps place"', () => {
  const r = parseShortcutResults('16@@@@1@@2@@Town');
  assert.deepEqual(r.get('16'), { name: 'Apple Maps place', lat: 1, lon: 2, address: 'Town' });
});

/* ---------- Shortcut input and applying results ---------- */

test('shortcutInput: one place URL per line in guide order; the run URL takes the clipboard', () => {
  assert.equal(shortcutInput(['3', '1', '2']),
    'https://maps.apple.com/place?auid=3\nhttps://maps.apple.com/place?auid=1\nhttps://maps.apple.com/place?auid=2');
  assert.equal(SHORTCUT_RUN_URL, 'shortcuts://run-shortcut?name=Insta%20Pinmap%20Apple&input=clipboard');
});

test('applyShortcutResults: fills matching Apple rows, checks them and clears their warning', () => {
  const inline = { name: 'Inline', address: 'A', lat: 1, lon: 2, url: '', source: 'apple-guide', note: '', warning: '' };
  const entries = [inline, ...appleIdEntries(['111', '222'], new Map())];
  const results = parseShortcutResults('111@@Clutch23@@48.8@@9.27@@Fellbach, Germany\n999@@Other@@1@@1@@x');
  const found = applyShortcutResults(entries, results);
  assert.equal(found, 1);
  assert.deepEqual(entries[0], inline, 'inline places stay untouched');
  assert.equal(entries[1].name, 'Clutch23');
  assert.equal(entries[1].address, 'Fellbach, Germany');
  assert.equal(entries[1].lat, 48.8);
  assert.equal(entries[1].lon, 9.27);
  assert.equal(entries[1].warning, '');
  assert.equal(entries[1].checked, true);
  assert.equal(entries[1].url, 'https://maps.apple.com/place?auid=111');
  assert.equal(entries[2].lat, null);
  assert.equal(entries[2].checked, false);
  assert.equal(entries[2].warning, 'Look this place up with the Shortcut or the computer script.');
});

/* ---------- Pending guide import ---------- */

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

const GUIDE = {
  title: 'Epic Gamering',
  entries: [{ name: 'Hive Gaming', address: 'Nürnberg', lat: 49.4, lon: 11.0, url: '', source: 'apple-guide', note: '', warning: '' }],
  appleIds: ['111', '222'],
};

test('pending guide: saved under its key, read back within 24 h, gone after that or when cleared', () => {
  const s = memoryStorage();
  const now = Date.UTC(2026, 9, 10, 12, 0, 0);
  savePendingGuide(GUIDE, { storage: s, now });
  assert.equal(PENDING_GUIDE_KEY, 'insta-pinmap.pending-guide');
  const stored = JSON.parse(s.map.get(PENDING_GUIDE_KEY));
  assert.deepEqual(stored, { ...GUIDE, savedAt: now });

  assert.deepEqual(loadPendingGuide({ storage: s, now: now + 23 * 3600e3 }), { ...GUIDE, savedAt: now });
  assert.equal(loadPendingGuide({ storage: s, now: now + 24 * 3600e3 + 1 }), null, 'older than 24 h');
  assert.equal(s.map.has(PENDING_GUIDE_KEY), false, 'an expired one is removed');

  savePendingGuide(GUIDE, { storage: s, now });
  clearPendingGuide({ storage: s });
  assert.equal(loadPendingGuide({ storage: s, now }), null);
});

test('pending guide: broken data and failing storage never throw', () => {
  const s = memoryStorage();
  s.setItem(PENDING_GUIDE_KEY, '{not json');
  assert.equal(loadPendingGuide({ storage: s, now: 1 }), null);
  s.setItem(PENDING_GUIDE_KEY, JSON.stringify({ title: 'x', entries: 'no', appleIds: ['1'], savedAt: 1 }));
  assert.equal(loadPendingGuide({ storage: s, now: 1 }), null);
  s.setItem(PENDING_GUIDE_KEY, JSON.stringify({ title: 'x', entries: [], appleIds: [], savedAt: 1 }));
  assert.equal(loadPendingGuide({ storage: s, now: 1 }), null, 'nothing left to look up');
  s.setItem(PENDING_GUIDE_KEY, JSON.stringify({ title: 'x', entries: [], appleIds: ['1'], savedAt: 5 }));
  assert.equal(loadPendingGuide({ storage: s, now: 1 }), null, 'from the future');

  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  assert.doesNotThrow(() => savePendingGuide(GUIDE, { storage: throwing, now: 1 }));
  assert.equal(loadPendingGuide({ storage: throwing, now: 1 }), null);
  assert.doesNotThrow(() => clearPendingGuide({ storage: throwing }));
  assert.doesNotThrow(() => savePendingGuide(GUIDE, { storage: null, now: 1 }));
  assert.equal(loadPendingGuide({ storage: null, now: 1 }), null);
});

test('parseShortcutResults: a later id with exactly the name and coordinates of an earlier one is a stale value and dropped', () => {
  const text = [
    '1@@Clutch23@@48.8196266@@9.2741936@@Fellbach, Germany',
    '2@@Clutch23@@48.8196266@@9.2741936@@Fellbach, Germany',   // the Shortcut kept the previous place's values
    '3@@Clutch23@@48,8196266@@9,2741936@@',                     // same values, other spelling
    '4@@Clutch23@@48.8196267@@9.2741936@@Fellbach, Germany',   // a different spot with the same name is fine
    '1@@Clutch23@@48.8196266@@9.2741936@@Fellbach, Germany',   // the same id twice is not a stale value
  ].join('\n');
  const r = parseShortcutResults(text);
  assert.deepEqual([...r.keys()], ['1', '4']);
});
