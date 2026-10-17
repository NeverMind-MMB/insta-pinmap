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
