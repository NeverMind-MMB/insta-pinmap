// test/ui.test.mjs — the import dialog's helpers in ui.js (no DOM: markup is read from index.html).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHORTCUT_INSTALL_URL } from '../web/js/appleplace.js';
import { linkShortcutInstall } from '../web/js/ui.js';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

/** index.html from `start` up to the next `end`. */
function between(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `${start} … ${end}`);
  return html.slice(a, b);
}

/* ---------- Shortcut help (2.0.10) ---------- */

test('Shortcut help: collapsed, with an install link, in the import dialog\'s Apple notice and in Settings → Import', () => {
  const places = {
    'import dialog': between('id="import-apple"', 'id="import-all"'),
    'Settings → Import': between('<legend>Import</legend>', '</fieldset>'),
  };
  for (const [where, part] of Object.entries(places)) {
    const help = part.match(/<details\b([^>]*)>\s*<summary>Shortcut help<\/summary>([\s\S]*?)<\/details>/);
    assert.ok(help, `${where}: <details> "Shortcut help"`);
    assert.doesNotMatch(help[1], /\bopen\b/, `${where}: collapsed`);
    const link = help[2].match(/<a\b[^>]*\bdata-shortcut-install\b[^>]*>/);
    assert.ok(link, `${where}: install link`);
    assert.match(link[0], /target="_blank"/, `${where}: opens in a new tab`);
    assert.doesNotMatch(link[0], /\bhref=/, `${where}: the address comes from SHORTCUT_INSTALL_URL`);
  }
  assert.equal(html.match(/data-shortcut-install/g).length, 2);
  assert.ok(!html.includes('icloud.com'), 'the address lives in SHORTCUT_INSTALL_URL only');
});

test('Shortcut help: both install links get SHORTCUT_INSTALL_URL, the shared "Fetch Apple Guide"', () => {
  const links = [{}, {}];
  linkShortcutInstall({ querySelectorAll: (sel) => (sel === 'a[data-shortcut-install]' ? links : []) });
  assert.deepEqual(links.map((a) => a.href), [SHORTCUT_INSTALL_URL, SHORTCUT_INSTALL_URL]);
  assert.equal(SHORTCUT_INSTALL_URL, 'https://www.icloud.com/shortcuts/6aeae7fdbdc94bffb0273030edffdd92');
});

/* ---------- Import tag from the guide or list name (2.0.10) ---------- */

const { store, normalizeDb } = await import('../web/js/store.js');
const { importTag, applyImport } = await import('../web/js/ui.js');

test('import tag: the guide or list name as a tag, file names without their extension', () => {
  assert.equal(importTag('Epic Gamering'), 'epic-gamering');
  assert.equal(importTag('Want to go.csv'), 'want-to-go');
  assert.equal(importTag('Trip #2 Rome.kml'), 'trip-2-rome');
  assert.equal(importTag('Saved Places.json'), 'saved-places');
  assert.equal(importTag('Rome, Italy.csv'), 'rome-italy', 'one file with a comma in its name');
});

test('import tag: empty when the name only stands in for a missing one', () => {
  for (const name of ['', '  ', null, undefined, 'Apple Guide', 'Places found', 'Apple Maps places']) {
    assert.equal(importTag(name), '', String(name));
  }
});

/** Just enough document for applyImport's progress toasts. */
function fakeDocument() {
  const els = new Map();
  const el = () => ({
    textContent: '', value: '', dataset: {}, classList: { add() {}, remove() {} },
    matches: () => false, showPopover() {}, hidePopover() {},
  });
  return { getElementById: (id) => els.get(id) ?? els.set(id, el()).get(id), querySelectorAll: () => [] };
}

const row = (name, lat, lon, extra = {}) => ({ name, address: '', lat, lon, url: '', source: 'apple-guide', note: '', warning: '', ...extra });
const OLD_PIN = { id: 'old', lat: 48.1, lon: 11.5, title: 'Old place', tags: ['coffee'], updatedAt: '2026-01-01T00:00:00.000Z' };

/** "Import selected" with the tag field holding `tag`; returns a lookup of the pins by title. */
async function importRows(rows, sourceName, tag, pins = [OLD_PIN], color = '') {
  globalThis.document = fakeDocument();
  store.db = normalizeDb({ pins: structuredClone(pins) });
  try {
    await applyImport(rows, sourceName, { redraw() {} }, tag, color);
  } finally {
    delete globalThis.document;
  }
  return (title) => store.db.pins.find((p) => p.title === title);
}

test('Import selected: every new pin gets the tag; a pin already at the spot gets it added, nothing removed', async () => {
  const pin = await importRows([row('New place', 47.1, 11.1), row('Old place again', 48.1, 11.5)], 'Synthetic Guide', 'synthetic-guide');
  assert.equal(store.db.pins.length, 2, 'the second row is the pin already there');
  assert.deepEqual(pin('New place').tags, ['synthetic-guide']);
  assert.deepEqual(pin('Old place').tags, ['coffee', 'synthetic-guide']);
  assert.equal(store.allTags().find((t) => t.name === 'synthetic-guide')?.count, 2, 'in the tag filter');
  assert.match(store.db.tags.find((t) => t.name === 'synthetic-guide')?.color ?? '', /^#[0-9a-f]{6}$/i, 'with a colour');
});

test('Import selected: the typed tag is normalized; a cleared field adds no tag and leaves the pin already there alone', async () => {
  let pin = await importRows([row('New place', 47.1, 11.1)], 'Synthetic Guide', '  My Trip ');
  assert.deepEqual(pin('New place').tags, ['my-trip']);
  pin = await importRows([row('New place', 47.1, 11.1), row('Old place again', 48.1, 11.5)], 'Synthetic Guide', '');
  assert.deepEqual(pin('New place').tags, []);
  assert.deepEqual(pin('Old place').tags, ['coffee']);
  assert.equal(pin('Old place').updatedAt, '2026-01-01T00:00:00.000Z');
});

test('Import selected from Google list files: the field replaces the list name it started with; rows of other lists keep theirs', async () => {
  const listRow = (name, lat, list) => row(name, lat, 11, { source: 'google-csv', tagSuggestion: list });
  let pin = await importRows([listRow('A', 40, 'mailand')], 'Mailand.csv', 'milano', []);
  assert.deepEqual(pin('A').tags, ['milano']);
  pin = await importRows([listRow('A', 40, 'mailand')], 'Mailand.csv', '', []);
  assert.deepEqual(pin('A').tags, []);
  pin = await importRows([listRow('A', 40, 'mailand'), listRow('B', 41, 'rom')], 'Mailand.csv, Rom.csv', '', []);
  assert.deepEqual([pin('A').tags, pin('B').tags], [['mailand'], ['rom']]);
});

/* ---------- Fix round 1 (2.0.10 review) ---------- */

/** fetch for /api/resolve (answers `resolved`) and the place search (answers `hit` or nothing); records the URLs. */
function stubNetwork({ resolved, hit = null }) {
  const calls = [];
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('/api/resolve')) return json({ ok: true, url: resolved });
    if (u.includes('photon')) {
      return json({ features: hit ? [{ geometry: { coordinates: [hit.lon, hit.lat] }, properties: { name: hit.name } }] : [] });
    }
    return json([]);
  };
  return calls;
}

/** A batch row for a Google short link, as readLink makes it. */
const shortLinkRow = (url) => row('Google place', null, null, { url, source: 'google-link', warning: 'Short link; it will be resolved on import.' });

test('a Google short link in an import: the pin takes name and spot from the resolved link', async () => {
  stubNetwork({ resolved: 'https://www.google.com/maps/place/Synthetic+Bar/@45.4,9.2,17z/data=!3d45.4719!4d9.1721' });
  const pin = await importRows([shortLinkRow('https://maps.app.goo.gl/synthetic1')], '', '', []);
  assert.equal(store.db.pins.length, 1);
  assert.equal(pin('Synthetic Bar')?.lat, 45.4719);
});

test('a Google short link resolving to a name without a spot: searched by that name', async () => {
  const calls = stubNetwork({ resolved: 'https://www.google.com/maps/place/Synthetic+Bar/', hit: { name: 'Synthetic Bar', lat: 45.5, lon: 9.3 } });
  const pin = await importRows([shortLinkRow('https://maps.app.goo.gl/synthetic2')], '', '', []);
  assert.equal(pin('Synthetic Bar')?.lat, 45.5);
  assert.ok(calls.some((u) => u.includes('photon') && u.includes('q=Synthetic+Bar')), calls.join('\n'));
});

test('a Google short link resolving to neither name nor spot: no place search for "Google place"', async () => {
  const calls = stubNetwork({ resolved: 'https://www.google.com/maps?cid=1234567890' });
  await importRows([shortLinkRow('https://maps.app.goo.gl/synthetic3')], '', '', []);
  assert.equal(store.db.pins.length, 0, 'left without coordinates');
  assert.deepEqual(calls.filter((u) => !u.startsWith('/api/resolve')), [], 'nothing searched');
});

test('import from several files: the tag field starts empty and each list keeps its own tag, as in 2.0.9', async () => {
  for (const names of ['Want to go.csv, Favorite places.csv', 'Rome, Italy.csv, Paris.csv', 'Trip.kml, Mailand.csv']) {
    assert.equal(importTag(names), '', names);
  }
  const listRow = (name, lat, list) => row(name, lat, 11, { source: 'google-csv', tagSuggestion: list });
  const pin = await importRows([listRow('A', 40, 'want to go'), listRow('B', 41, 'favorite places')],
    'Want to go.csv, Favorite places.csv', '', []);
  assert.deepEqual([pin('A').tags, pin('B').tags], [['want-to-go'], ['favorite-places']]);
});

test('import tag: no stray hyphens where emoji or "&" were, in the prefill and in a typed tag', async () => {
  assert.equal(importTag('☕ Coffee in Vienna'), 'coffee-in-vienna');
  assert.equal(importTag('Rome 🇮🇹'), 'rome');
  assert.equal(importTag('A & B'), 'a-b');
  const pin = await importRows([row('New place', 47.1, 11.1)], 'Synthetic Guide', ' Bars & Cafés 🍸', []);
  assert.deepEqual(pin('New place').tags, ['bars-cafés']);
});

/* ---------- The unsupported-link dialog (2.0.10) ---------- */

test('index.html: the unsupported-link dialog, its GitHub link without an address, and the supported list collapsed', () => {
  const dlg = between('id="dlg-unsupported"', '</dialog>');
  assert.match(dlg, /<h2 id="dlg-unsupported-title">This link isn't supported yet<\/h2>/);
  const link = dlg.match(/<a\b[^>]*\bid="unsupported-issues"[^>]*>([^<]*)<\/a>/);
  assert.ok(link, 'Check GitHub issues link');
  assert.equal(link[1], 'Check GitHub issues');
  assert.match(link[0], /target="_blank"/);
  assert.match(link[0], /rel="noopener"/);
  assert.doesNotMatch(link[0], /\bhref=/, 'the address comes from sources.js');
  const details = dlg.match(/<details\b([^>]*)>\s*<summary>Supported links and files<\/summary>/);
  assert.ok(details, 'Supported links and files');
  assert.doesNotMatch(details[1], /\bopen\b/, 'collapsed');
  assert.ok(!html.includes('github.com'), 'ISSUES_URL lives in sources.js only');
});

/** Just enough document for showUnsupported. */
function dialogDocument() {
  const node = () => ({
    textContent: '', href: '', open: true, shown: false, children: [],
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = kids; },
    showModal() { this.shown = true; },
  });
  const els = new Map();
  return { getElementById: (id) => els.get(id) ?? els.set(id, node()).get(id), createElement: () => node() };
}

test('showUnsupported: names the site, searches GitHub issues for it, lists what works, collapsed', async () => {
  const { showUnsupported } = await import('../web/js/ui.js');
  const doc = dialogDocument();
  globalThis.document = doc;
  try {
    doc.getElementById('unsupported-list').children = ['left over'];
    showUnsupported('https://www.pinterest.com/pin/123456789/');
    assert.equal(doc.getElementById('unsupported-text').textContent,
      "pinterest.com links don't work in this version of the app. If nobody has asked for it yet, open an issue on GitHub.");
    assert.equal(doc.getElementById('unsupported-issues').href,
      'https://github.com/NeverMind-MMB/insta-pinmap/issues?q=is%3Aissue%20pinterest.com');
    const lines = doc.getElementById('unsupported-list').children
      .map((p) => p.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''));
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^One link at a time \(input bar\): instagram\.com\/p\/… · instagram\.com\/reel\/… · /);
    assert.match(lines[0], / — or type a place name to search$/);
    assert.match(lines[1], /^Several links at once \(Settings → Import\): maps\.apple\.com\/… place links · /);
    assert.match(lines[2], /^Files \(Settings → Import → Choose files\): Google Maps saved places and lists \(files from the Google Takeout zip\) · /);
    assert.equal(doc.getElementById('unsupported-sources').open, false);
    assert.equal(doc.getElementById('dlg-unsupported').shown, true);
  } finally {
    delete globalThis.document;
  }
});

/* ---------- The pin colour picker (2.0.10) ---------- */

/** Just enough document for colorPicker: elements with children, attributes and "input:checked". */
function pickerDocument() {
  const node = (tag) => ({
    tag, className: '', title: '', type: '', name: '', value: '', checked: false, textContent: '', style: {}, attrs: {}, dataset: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); return kid; },
    querySelectorAll(sel) {
      const all = [];
      const walk = (n) => { for (const c of n.children || []) { all.push(c); walk(c); } };
      walk(this);
      return sel === 'input' ? all.filter((n) => n.tag === 'input') : [];
    },
    querySelector(sel) {
      return sel === 'input:checked' ? this.querySelectorAll('input').find((n) => n.checked) || null : null;
    },
  });
  return { createElement: node };
}

test('colour picker: "Auto" in the source colour first, then the eight palette colours, each a named radio', async () => {
  const { colorPicker, pickedColor } = await import('../web/js/ui.js');
  globalThis.document = pickerDocument();
  try {
    const box = colorPicker('detail-color', { label: 'Colour', auto: '#a3762b', value: '' });
    assert.equal(box.attrs.role, 'radiogroup');
    assert.equal(box.attrs['aria-label'], 'Colour');
    const options = box.children.map((label) => {
      const [input, dot, name] = label.children;
      return { type: input.type, group: input.name, value: input.value, checked: input.checked, dot: dot.style.background, name: name.textContent };
    });
    assert.equal(options.length, 9);
    assert.deepEqual(options[0], { type: 'radio', group: 'detail-color', value: '', checked: true, dot: '#a3762b', name: 'Auto (source colour)' });
    assert.deepEqual(options.slice(1).map((o) => [o.name, o.value]), [
      ['Rust', '#b8543f'], ['Amber', '#a3762b'], ['Olive', '#4f7a2b'], ['Green', '#2f7d5d'],
      ['Teal', '#2f7d7a'], ['Blue', '#3a6ea5'], ['Purple', '#7a4b8f'], ['Plum', '#8f4b6b'],
    ]);
    assert.equal(pickedColor(box), '', 'Auto');
    box.children[0].children[0].checked = false;
    box.children[6].children[0].checked = true;
    assert.equal(pickedColor(box), '#3a6ea5');
  } finally {
    delete globalThis.document;
  }
});

test('colour picker: the pin\'s colour starts checked; a colour outside the palette stays unless another is picked', async () => {
  const { colorPicker, pickedColor } = await import('../web/js/ui.js');
  globalThis.document = pickerDocument();
  try {
    const plum = colorPicker('c', { auto: '#3a6ea5', value: '#8f4b6b' });
    assert.deepEqual(plum.children.filter((l) => l.children[0].checked).map((l) => l.children[0].value), ['#8f4b6b']);
    const custom = colorPicker('c', { auto: '#3a6ea5', value: '#123456' });
    assert.equal(custom.children.some((l) => l.children[0].checked), false);
    assert.equal(pickedColor(custom), '#123456');
  } finally {
    delete globalThis.document;
  }
});

test('Import selected with a colour: every new pin gets it, a pin already there keeps its own; Auto leaves each its source colour', async () => {
  const oldPin = { ...OLD_PIN, color: '#2f7d7a' };
  let pin = await importRows([row('New place', 47.1, 11.1), row('Old place again', 48.1, 11.5)], 'Synthetic Guide', '', [oldPin], '#8f4b6b');
  assert.equal(pin('New place').color, '#8f4b6b');
  assert.equal(pin('Old place').color, '#2f7d7a');
  pin = await importRows([row('New place', 47.1, 11.1), row('Track start', 47.2, 11.2, { source: 'gpx' })], 'Mixed', '', [], '');
  assert.equal('color' in pin('New place'), false);
  assert.equal(store.pinColor(pin('New place')), '#3a6ea5', 'Apple Maps');
  assert.equal(store.pinColor(pin('Track start')), '#a3762b', 'GPS file');
});

test('a Google short link resolving to a search link: named and searched by its search text', async () => {
  const calls = stubNetwork({ resolved: 'https://www.google.com/maps?q=Synthetic+Bar+Milan', hit: { name: 'Synthetic Bar', lat: 45.5, lon: 9.3 } });
  const pin = await importRows([shortLinkRow('https://maps.app.goo.gl/synthetic4')], '', '', []);
  assert.equal(pin('Synthetic Bar Milan')?.lat, 45.5);
  assert.ok(calls.some((u) => u.includes('photon') && u.includes('q=Synthetic+Bar+Milan')), calls.join('\n'));
});

test('the unsupported-link dialog can name a kind of link instead of a site (Google Maps lists)', async () => {
  const { showUnsupported } = await import('../web/js/ui.js');
  const doc = dialogDocument();
  globalThis.document = doc;
  try {
    showUnsupported('https://www.google.com/maps/placelists/list/AbCdEf123', 'Google Maps lists');
    assert.equal(doc.getElementById('unsupported-text').textContent,
      "Google Maps lists don't work in this version of the app. If nobody has asked for it yet, open an issue on GitHub.");
    assert.equal(doc.getElementById('unsupported-issues').href,
      'https://github.com/NeverMind-MMB/insta-pinmap/issues?q=is%3Aissue%20Google%20Maps%20lists');
  } finally {
    delete globalThis.document;
  }
});
