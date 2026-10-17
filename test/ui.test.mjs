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
  assert.equal(importTag('Mailand.csv, Rom.csv'), 'mailand-rom');
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
async function importRows(rows, sourceName, tag, pins = [OLD_PIN]) {
  globalThis.document = fakeDocument();
  store.db = normalizeDb({ pins: structuredClone(pins) });
  try {
    await applyImport(rows, sourceName, { redraw() {} }, tag);
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
