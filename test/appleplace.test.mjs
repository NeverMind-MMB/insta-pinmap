import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseApplePlaceHtml, parseShortcutResults, parseShortcutPages, parseShortcutPaste, shortcutInput, SHORTCUT_RUN_URL,
  applyShortcutResults, savePendingGuide, loadPendingGuide, clearPendingGuide, PENDING_GUIDE_KEY, applyPasteToGuide,
  parseGuidePage, isGuidePage, readShortcutPaste, appendGuidePlaces, shortcutClipboard, SHORTCUT_NAME, safeGuideLink, missingAppleIds,
} from '../web/js/appleplace.js';
import { pruneTagFilter } from '../web/js/store.js';
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
  assert.equal(SHORTCUT_RUN_URL, 'shortcuts://run-shortcut?name=Fetch%20Apple%20Guide&input=clipboard');
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
  assert.deepEqual(stored, { ...GUIDE, link: '', savedAt: now });

  assert.deepEqual(loadPendingGuide({ storage: s, now: now + 23 * 3600e3 }), { ...GUIDE, link: '', savedAt: now });
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

/* ---------- parseShortcutPages / parseShortcutPaste (raw pages pasted by the short Shortcut) ---------- */

function applePage(id, opts = {}) {
  return appleHead(opts).replace('<div id="app">', `<div id="app" data-ref="${id}">`);
}

test('parseShortcutPages: assigns pages to guide ids, ignores junk, unrelated and coordinate-less pages', () => {
  const text = [
    'leading junk\nhttps://maps.apple.com/place?auid=1',
    applePage('111', { name: 'Alpha', lat: '48.1', lon: '11.5', title: 'Alpha in Munich, Germany - Apple Maps' }),
    applePage('999', { name: 'Unrelated' }),
    applePage('222', { name: 'Beta &amp; Co', lat: '52,5', lon: '13.4', title: 'Beta &amp; Co in Berlin, Germany - Apple Maps' }),
    applePage('333', { lat: 'x', lon: 'y' }),
  ].join('\n');
  const m = parseShortcutPages(text, ['111', '222', '333', '444']);
  assert.deepEqual([...m.keys()], ['111', '222']);
  assert.deepEqual(m.get('111'), { name: 'Alpha', lat: 48.1, lon: 11.5, address: 'Munich, Germany' });
  assert.deepEqual(m.get('222'), { name: 'Beta & Co', lat: 52.5, lon: 13.4, address: 'Berlin, Germany' });
});

test('parseShortcutPages: a later page for an id already filled does not overwrite it; claimId is the fallback', () => {
  const claim = appleHead({ name: 'Claimed', lat: '1', lon: '2' }).replace('<div id="app">', '<a href="https://business.apple.com/?claimId=555">');
  const text = applePage('111', { name: 'First' }) + applePage('111', { name: 'Second' }) + claim;
  const m = parseShortcutPages(text, ['111', '555']);
  assert.equal(m.get('111').name, 'First');
  assert.equal(m.get('555').name, 'Claimed');
});

test('parseShortcutPages: a paste without any doctype is split at <html; lowercase doctype works', () => {
  const strip = (id, name) => applePage(id, { name }).replace(/<!DOCTYPE html>\s*/, '');
  const m1 = parseShortcutPages(`${strip('111', 'A')}
${strip('222', 'B')}`, ['111', '222']);
  assert.deepEqual([...m1.keys()], ['111', '222']);
  const low = (id, name) => applePage(id, { name }).replace('<!DOCTYPE html>', '<!doctype html>');
  const m2 = parseShortcutPages(`${low('111', 'A')}
${low('222', 'B')}`, ['111', '222']);
  assert.deepEqual([...m2.keys()], ['111', '222']);
});

test('parseShortcutPages: 2 MB paste of 45 pages parses in under 500 ms', () => {
  const pad = '<script>' + 'x'.repeat(43000) + '</script>';
  const ids = Array.from({ length: 45 }, (_, i) => String(4000000000000000000n + BigInt(i)));
  const text = ids.map((id, i) => applePage(id, { name: `P${i}`, lat: '48.5', lon: '9.5' })
    .replace('</div></body>', `${pad}</div></body>`)).join('\n');
  assert.ok(text.length > 1.9e6);
  const t0 = performance.now();
  const m = parseShortcutPages(text, ids);
  const ms = performance.now() - t0;
  console.log(`2 MB parse: ${ms.toFixed(1)} ms`);
  assert.equal(m.size, 45);
  assert.ok(ms < 500, `took ${ms} ms`);
});

test('parseShortcutPaste: HTML path when <html is present (any case), else the @@ format', () => {
  const ids = ['111'];
  const html = parseShortcutPaste(applePage('111', { name: 'Alpha' }), ids);
  assert.equal(html.get('111').name, 'Alpha');
  const html2 = parseShortcutPaste(applePage('111', { name: 'Alpha' }).replace(/<html/, '<HTML'), ids);
  assert.equal(html2.size, 1);
  const line = 'https://maps.apple.com/place?auid=111@@Beta@@1@@2@@Somewhere';
  assert.equal(parseShortcutPaste(line, ids).get('111').name, 'Beta');
});

test('parseShortcutPages: a literal "<html" inside a page does not split it', () => {
  const page = appleHead({ name: 'Probe' }).replace('</head><body>',
    '</head><body><script>var s="<html lang=x>";</script><div data-ref="111">');
  const m = parseShortcutPages(`${page}\n${applePage('222', { name: 'Next' })}`, ['111', '222']);
  assert.equal(m.get('111').name, 'Probe');
  assert.equal(m.get('222').name, 'Next');
});

test('parseShortcutPages: a page belongs to its own (first named) id, not the first in guide order', () => {
  const page = applePage('222', { name: 'Own' }).replace('</body>', '<i data-ref="111"></i></body>');
  const m = parseShortcutPages(page, ['111', '222']);
  assert.deepEqual([...m.keys()], ['222']);
  assert.equal(m.get('222').name, 'Own');
});

test('parseShortcutPaste: falls back to the @@ format when "<html" is in a field but no page matches', () => {
  const line = 'https://maps.apple.com/place?auid=111@@<html>Cafe@@1@@2@@Somewhere';
  assert.equal(parseShortcutPaste(line, ['111']).get('111').lon, 2);
});

test('pruneTagFilter: drops tags no pin has anymore', () => {
  const f = new Set(['a', 'gone']);
  pruneTagFilter(f, ['a', 'b']);
  assert.deepEqual([...f], ['a']);
});

/* ---------- The whole guide page (one fetch of the guide link) ---------- */

const GUIDE_PAGE = readFileSync(new URL('./fixtures/guide-page.html', import.meta.url), 'utf8');
const GUIDE_IDS = [
  '4053793356543820372', '14921016072022586346', '9816041141257892933', '4149090964667769162',
  '5722912085441730191', '3509017914921167370', '14862164460984384322',
];
const GUIDE_LINK = 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5n';

test('parseGuidePage: every place of the trimmed real guide page, in page order, no duplicates', () => {
  const places = parseGuidePage(GUIDE_PAGE);
  assert.equal(places.length, 10, 'list links and map annotations name the same 10 places');
  assert.deepEqual(places.map((p) => p.name), [
    'Hive Gaming', 'Clutch23', '404', 'Red Bull Gaming Garden', 'Bar42', 'G4METIME', 'eCamp', 'Xperion',
    'LVL World of Gaming - Berlin', 'Axezone Axtwerfen Frankfurt',
  ]);
  assert.deepEqual(places.filter((p) => p.id).map((p) => p.id), GUIDE_IDS);
  assert.equal(places.filter((p) => p.id === null).length, 3, 'custom pins have no Apple ID');
  assert.deepEqual(places[1], {
    id: '4053793356543820372', name: 'Clutch23', address: 'Pestalozzistraße 102, 70736 Fellbach, Germany',
    lat: 48.8196266, lon: 9.2741936,
  });
  assert.deepEqual(places[0], {
    id: null, name: 'Hive Gaming', address: 'Holzschuherstraße 36, 90439 Nuremberg, Germany', lat: 49.4458656, lon: 11.0497961,
  });
  assert.equal(places[8].address, 'Schützenstraße 73, 10117 Berlin, Germany');
  assert.equal(new Set(places.map((p) => `${p.lat},${p.lon}`)).size, 10);
});

test('parseGuidePage: entities and URL-encoding are decoded; a repeated link is dropped', () => {
  const link = '<a class="mw-place-link" href="https://maps.apple.com/place?address=M%C3%BCnchen%2C%20Germany&amp;coordinate=48.1%2C11.5&amp;name=Caf%C3%A9%20%26%20Bar&amp;place-id=I1" data-ref="777">' +
    '<div class="mw-collection-place-name">Caf&#233; &amp; Bar</div></a>';
  const places = parseGuidePage(`<html><body>${link}${link}</body></html>`);
  assert.deepEqual(places, [{ id: '777', name: 'Café & Bar', address: 'München, Germany', lat: 48.1, lon: 11.5 }]);
});

test('parseGuidePage: an Apple link without data-ref takes its id from the map annotations; annotation-only places are added', () => {
  const page = GUIDE_PAGE
    .replace(' data-ref="4053793356543820372"', '')
    .replace(/<a class="mw-place-link"[^>]*name=Xperion[^>]*>[\s\S]*?<\/a>/, '');
  const places = parseGuidePage(page);
  assert.equal(places.length, 10);
  assert.equal(places[1].id, '4053793356543820372');
  const xperion = places.find((p) => p.name === 'Xperion');
  assert.deepEqual(xperion, { id: '5722912085441730191', name: 'Xperion', address: '', lat: 50.9488973, lon: 6.9508416 });
  assert.equal(places.at(-1), xperion, 'annotation-only places come after the list');
});

test('parseGuidePage: invalid coordinates are skipped; junk gives an empty list', () => {
  const bad = '<a href="https://maps.apple.com/place?coordinate=95%2C11&amp;name=X" data-ref="1"></a>' +
    '<a href="https://maps.apple.com/place?coordinate=abc&amp;name=Y" data-ref="2"></a>' +
    '{"ref":"3","title":"Z","center":[1,200]}';
  assert.deepEqual(parseGuidePage(bad), []);
  assert.deepEqual(parseGuidePage(''), []);
  assert.deepEqual(parseGuidePage(undefined), []);
});

test('parseShortcutPaste: a guide page fills the Apple IDs; pages and @@ lines still work', () => {
  assert.equal(isGuidePage(GUIDE_PAGE), true);
  assert.equal(isGuidePage(applePage('111')), false);
  assert.equal(isGuidePage('111@@A@@1@@2@@x'), false);
  const placeWithGuideLink = applePage('111', { name: 'Alpha' })
    .replace('</body>', '<a href="https://maps.apple.com/guides?user=x">Guides</a></body>');
  assert.equal(isGuidePage(placeWithGuideLink), false, 'a place page that links to a guide stays a place page');
  assert.equal(parseShortcutPaste(placeWithGuideLink, ['111']).get('111').name, 'Alpha');
  assert.equal(isGuidePage('<html><link rel="canonical" href="https://maps.apple.com/guides"></html>'), true);
  const r = parseShortcutPaste(GUIDE_PAGE, GUIDE_IDS);
  assert.deepEqual([...r.keys()], GUIDE_IDS);
  assert.deepEqual(r.get('14921016072022586346'),
    { name: 'Bar42', lat: 51.3418078, lon: 12.3797079, address: 'Ritterstraße 42, 04109 Leipzig, Germany' });
  const { results, places } = readShortcutPaste(GUIDE_PAGE, GUIDE_IDS);
  assert.equal(results.size, 7);
  assert.equal(places.length, 10);
  const page = readShortcutPaste(applePage('111', { name: 'Alpha' }), ['111']);
  assert.equal(page.places, null);
  assert.equal(page.results.get('111').name, 'Alpha');
  assert.equal(readShortcutPaste('111@@Beta@@1@@2@@x', ['111']).results.get('111').name, 'Beta');
});

test('appendGuidePlaces: adds only places the list lacks, checked; repeated pastes add nothing more', () => {
  const inline = [
    { name: 'Hive Gaming', address: 'Nürnberg', lat: 49.445865599534336, lon: 11.0497961, url: '', source: 'apple-guide', note: '', warning: '' },
    { name: '404', address: 'Dresden', lat: 51.094296213630244, lon: 13.720068679376785, url: '', source: 'apple-guide', note: '', warning: '' },
  ];
  const entries = [...inline, ...appleIdEntries(GUIDE_IDS.slice(0, 6), new Map())];
  const { results, places } = readShortcutPaste(GUIDE_PAGE, GUIDE_IDS.slice(0, 6));
  assert.equal(applyShortcutResults(entries, results), 6);
  const added = appendGuidePlaces(entries, places);
  assert.deepEqual(added.map((e) => e.name), ['Red Bull Gaming Garden', 'Axezone Axtwerfen Frankfurt']);
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.at(-1), {
    name: 'Axezone Axtwerfen Frankfurt', address: 'Friesstraße 3, 60388 Frankfurt, Germany', lat: 50.1368616, lon: 8.7415972,
    url: 'https://maps.apple.com/place?auid=14862164460984384322', source: 'apple-guide', note: '', warning: '', checked: true,
  });
  assert.equal(entries.at(-2).url, '', 'a custom pin has no Apple link');
  assert.deepEqual(appendGuidePlaces(entries, places), [], 'nothing twice');
  assert.equal(entries.length, 10);
});

test('appendGuidePlaces: a page of another guide (nothing in common) adds nothing', () => {
  const entries = [{ name: 'Elsewhere', address: '', lat: 1, lon: 1, url: '', source: 'apple-guide', note: '', warning: '' }];
  assert.deepEqual(appendGuidePlaces(entries, parseGuidePage(GUIDE_PAGE)), []);
  assert.equal(entries.length, 1);
});

test('shortcutClipboard: one place link per Apple ID of the guide, in guide order; no guide link needed', () => {
  assert.equal(shortcutClipboard({ link: GUIDE_LINK, appleIds: ['3', '1', '2'] }),
    'https://maps.apple.com/place?auid=3\nhttps://maps.apple.com/place?auid=1\nhttps://maps.apple.com/place?auid=2');
  assert.equal(shortcutClipboard({ appleIds: ['7'] }), 'https://maps.apple.com/place?auid=7', 'a guide saved without its link works too');
  assert.equal(SHORTCUT_NAME, 'Fetch Apple Guide');
  assert.equal(SHORTCUT_RUN_URL, 'shortcuts://run-shortcut?name=Fetch%20Apple%20Guide&input=clipboard');
});

const OWNER_LINK = 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5nElcaM0hvbHpzY2h1aGVyc3RyYcOfZSAzNiwgOTA0MzkgTsO8cm5iZXJnLCBEZXV0c2NobGFuZCISCak0vB8SuUhAEcvv2d9%2BGSZAKgxIaXZlIEdhbWluZz8SDQiuTRDUhIiNx%2FL9oDgSURo1R3Jvw59lbmhhaW5lciBTdHJhw59lIDE4OCwgMDExMjkgRHJlc2RlbiwgRGV1dHNjaGxhbmQiEgna1vjlEYxJQBErmInXrHArQCoENDA0PxJrGjxPbHltcGlhcGFyaywgVG9uaS1NZXJrZW5zLVdlZyA0LCA4MDgwOSBNw7xuY2hlbiwgRGV1dHNjaGxhbmQiEgmZbbTiuhVIQBHGXDAhvhQnQCoXUmVkIEJ1bGwgR2FtaW5nIEdhcmRlbj8SDgiuTRDq57OmgKKGic8BEg4Irk0Qxeiv6pCt5ZyIARINCK5NEMrCuI7%2Bh6LKORINCK5NEI%2BtreyGx%2Fe1TxINCK5NEIrU7sq7pqLZMBIOCK5NEML2otPY%2BsCgzgE%3D';
const b64Bytes = (p) => Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('safeGuideLink: the guide link becomes the safe base64url form, same bytes', () => {
  const out = safeGuideLink(OWNER_LINK);
  const prefix = 'https://maps.apple.com/guides?user=';
  assert.ok(out.startsWith(prefix));
  const param = out.slice(prefix.length);
  assert.match(param, /^[A-Za-z0-9_-]+$/);
  assert.ok(b64Bytes(param).equals(Buffer.from(new URL(OWNER_LINK).searchParams.get('ug'), 'base64')));
  assert.ok(out.length < OWNER_LINK.length);
});

test('safeGuideLink: %2B, %2F and %3D%3D map to -, _ and nothing', () => {
  assert.equal(safeGuideLink('https://guides.apple.com/?ug=ab%2Bc%2Fd%3D%3D'), 'https://maps.apple.com/guides?user=ab-c_d');
  assert.equal(safeGuideLink('https://maps.apple.com/guides?user=ab-c_d'), 'https://maps.apple.com/guides?user=ab-c_d');
});

test('safeGuideLink: no ug/user parameter keeps the raw link', () => {
  assert.equal(safeGuideLink('https://guides.apple.com/'), 'https://guides.apple.com/');
  assert.equal(safeGuideLink('not a link'), 'not a link');
});

test('pending guide: keeps the original guide link', () => {
  const s = memoryStorage();
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  savePendingGuide({ ...GUIDE, link: GUIDE_LINK }, { storage: s, now });
  assert.equal(loadPendingGuide({ storage: s, now }).link, GUIDE_LINK);
  savePendingGuide(GUIDE, { storage: s, now });
  assert.equal(loadPendingGuide({ storage: s, now }).link, '');
});

/* ---------- Round 2: the places the guide page lacks ---------- */

test('foundAppleIds / missingAppleIds: read from the import rows, in guide order', async () => {
  const { foundAppleIds, missingAppleIds } = await import('../web/js/appleplace.js');
  const inline = { name: 'Inline', address: 'A', lat: 1, lon: 2, url: '', source: 'apple-guide', note: '', warning: '' };
  const place = { name: 'Two', address: 'Town', lat: 48.1, lon: 11.5 };
  const entries = [inline, ...appleIdEntries(['1', '2', '3'], new Map([['2', place]]))];
  entries.push({ ...inline, url: 'https://maps.apple.com/place?auid=99' }); // a place only the guide page had
  assert.deepEqual(missingAppleIds(['1', '2', '3'], entries), ['1', '3']);
  assert.deepEqual([...foundAppleIds(['1', '2', '3'], entries)], [['2', place]]);
  assert.deepEqual(missingAppleIds(['2'], entries), []);
  assert.deepEqual(missingAppleIds(['7'], entries), ['7'], 'an ID without any row is missing too');
});

test('after a paste: notice, retry button and copied notice name the count', async () => {
  const { lookupNotice, retryButton, copiedNotice } = await import('../web/js/appleplace.js');
  assert.equal(lookupNotice({ total: 49, missing: 0 }), 'Found 49 of 49.');
  assert.equal(lookupNotice({ total: 49, missing: 2 }),
    "Found 47 of 49. 2 places weren't found in Apple Maps (they may no longer exist).");
  assert.equal(lookupNotice({ total: 49, missing: 1 }),
    "Found 48 of 49. 1 place wasn't found in Apple Maps (it may no longer exist).");
  assert.equal(retryButton(2), 'Try the 2 places again');
  assert.equal(retryButton(1), 'Try the place again');
  assert.equal(copiedNotice(49),
    '49 place links copied. Run the Shortcut (it fetches one page per place, about a minute), then come back and tap Paste results.');
  assert.equal(copiedNotice(1),
    '1 place link copied. Run the Shortcut, then come back and tap Paste results.');
});

test('one round: every place page in one paste; a page Apple lacks stays missing and is tried again alone', async () => {
  const { lookupNotice } = await import('../web/js/appleplace.js');
  const ids = Array.from({ length: 49 }, (_, i) => String(5000 + i));
  const entries = appleIdEntries(ids, new Map());
  const guide = { appleIds: ids };
  assert.equal(shortcutClipboard(guide).split('\n').length, 49);

  // The Shortcut's answer: 48 pages with data, 1 without (404).
  const pages = ids.slice(0, 48).map((id, i) => applePage(id, { name: `Q${i}`, lat: '47.1', lon: '11.1' })).join('\n');
  const r = applyPasteToGuide(entries, ids, pages + '\n<!DOCTYPE html><html><head><title>Apple Maps</title></head><body></body></html>');
  assert.equal(r.found, 48);
  const missing = missingAppleIds(ids, entries);
  assert.deepEqual(missing, [ids[48]]);
  assert.equal(lookupNotice({ total: 49, missing: missing.length }),
    "Found 48 of 49. 1 place wasn't found in Apple Maps (it may no longer exist).");
  assert.equal(shortcutInput(missing), `https://maps.apple.com/place?auid=${ids[48]}`, 'the retry copies just that one');

  applyPasteToGuide(entries, ids, applePage(ids[48], { name: 'Late', lat: '47.3', lon: '11.3' }));
  assert.deepEqual(missingAppleIds(ids, entries), []);
  assert.equal(entries[48].name, 'Late');
  assert.equal(entries[0].name, 'Q0', 'earlier finds stay');
});

test('applyPasteToGuide: place pages match only still-missing IDs, an earlier find is never overwritten', () => {
  const found = new Map([['111', { name: 'Alpha', address: 'Munich', lat: 48.1, lon: 11.5 }]]);
  const entries = appleIdEntries(['111', '222'], found);
  // A page of 222 that names the already-found 111 first (say, in a "nearby" list).
  const page = appleHead({ name: 'Beta', lat: '47.2', lon: '11.2', title: 'Beta in Town, Germany - Apple Maps' })
    .replace('<div id="app">', '<div data-ref="111"></div><div id="app" data-ref="222">');
  const r = applyPasteToGuide(entries, ['111', '222'], page);
  assert.equal(r.found, 1);
  assert.equal(entries[0].name, 'Alpha');
  assert.equal(entries[0].lat, 48.1);
  assert.equal(entries[1].name, 'Beta');

});

test('pending guide: one saved by 2.0.7 (with round-2 lists) still loads; the lists are neither returned nor kept', () => {
  const s = memoryStorage();
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  const found = { 111: { name: 'Alpha', lat: 48.1, lon: 11.5, address: '' } };
  s.setItem(PENDING_GUIDE_KEY, JSON.stringify({ ...GUIDE, link: '', savedAt: now, found, requested: ['222'], tried: ['222'] }));
  const g = loadPendingGuide({ storage: s, now });
  assert.deepEqual(g.appleIds, GUIDE.appleIds);
  assert.equal(g.found.get('111').name, 'Alpha');
  assert.equal('requested' in g || 'tried' in g, false);
  savePendingGuide({ ...g, requested: ['222'], tried: ['222'] }, { storage: s, now });
  const raw = JSON.parse(s.map.get(PENDING_GUIDE_KEY));
  assert.equal('requested' in raw || 'tried' in raw, false);
});

test('pending guide: the places already found round-trip; a broken found is dropped, the guide still loads', () => {
  const s = memoryStorage();
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  const found = new Map([['111', { name: 'Alpha', lat: 48.1, lon: 11.5, address: 'Munich' }]]);
  savePendingGuide({ ...GUIDE, found }, { storage: s, now });
  assert.deepEqual(JSON.parse(s.map.get(PENDING_GUIDE_KEY)).found, { 111: { name: 'Alpha', lat: 48.1, lon: 11.5, address: 'Munich' } });
  const g = loadPendingGuide({ storage: s, now });
  assert.deepEqual(g.found, found);
  assert.deepEqual(g.appleIds, GUIDE.appleIds);

  savePendingGuide({ ...GUIDE, found: new Map() }, { storage: s, now });
  assert.equal('found' in JSON.parse(s.map.get(PENDING_GUIDE_KEY)), false, 'nothing found yet: no found field');
  assert.equal('found' in loadPendingGuide({ storage: s, now }), false);

  const stored = { ...GUIDE, link: '', savedAt: now };
  for (const broken of [
    'nope', ['111'], { 111: { name: 'A', lat: 'x', lon: 2, address: '' } }, { 111: { name: 'A', lat: 99, lon: 2, address: '' } },
    { 111: { name: 5, lat: 1, lon: 2, address: '' } }, { 333: { name: 'Not in the guide', lat: 1, lon: 2, address: '' } }, { 111: null },
  ]) {
    s.setItem(PENDING_GUIDE_KEY, JSON.stringify({ ...stored, found: broken }));
    const back = loadPendingGuide({ storage: s, now });
    assert.ok(back, JSON.stringify(broken));
    assert.equal('found' in back, false, JSON.stringify(broken));
    assert.deepEqual(back.appleIds, GUIDE.appleIds);
  }
});

test('parseGuidePage: a full-size page (290 KB) parses fast', () => {
  const big = GUIDE_PAGE.replace('</body>', `<script>${'x'.repeat(280 * 1024)}</script></body>`);
  const t0 = performance.now();
  const places = parseGuidePage(big);
  const ms = performance.now() - t0;
  assert.equal(places.length, 10);
  assert.ok(ms < 200, `took ${ms} ms`);
});

test('looksLikeGuidePage: the whole guide page, never links or short text; guidePageTitle strips Apple suffixes', async () => {
  const { looksLikeGuidePage, guidePageTitle } = await import('../web/js/appleplace.js');
  assert.equal(looksLikeGuidePage(GUIDE_PAGE), true);
  for (const t of [
    'https://www.instagram.com/p/ABC123/', 'https://guides.apple.com/?ug=Cg1FcGljIEdhbWVyaW5n',
    'https://maps.apple.com/guides?x=1', 'https://maps.app.goo.gl/abc', 'Cafe Luitpold Muenchen',
    applePage('111'), '111@@A@@1@@2@@x',
  ]) assert.equal(looksLikeGuidePage(t), false, t.slice(0, 40));
  assert.equal(guidePageTitle(GUIDE_PAGE), 'Epic Gamering');
  assert.equal(guidePageTitle('<title>Caf&#233; &amp; Co – Apple Karten</title>'), 'Café & Co');
  assert.equal(guidePageTitle('<html></html>'), '');
});
