// test/address.test.mjs — oPin's move from the old address (insta-pinmap.…) to the new one (opin.…).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOldAddress, newAddressUrl } from '../web/js/address.js';

test('the old address: a host whose first label is insta-pinmap', () => {
  assert.equal(isOldAddress('insta-pinmap.someone.workers.dev'), true);
  for (const host of ['opin.someone.workers.dev', 'insta-pinmap-test.someone.workers.dev', 'my-insta-pinmap.someone.workers.dev',
    'someone.insta-pinmap.dev', 'localhost', '127.0.0.1', '']) {
    assert.equal(isOldAddress(host), false, host);
  }
});

test('the new address: the same URL with the first host label replaced by opin, subdomain kept', () => {
  assert.equal(newAddressUrl('https://insta-pinmap.someone.workers.dev/'), 'https://opin.someone.workers.dev/');
  assert.equal(newAddressUrl('https://insta-pinmap.other.workers.dev/?focus=input'), 'https://opin.other.workers.dev/?focus=input');
});

test('index.html: the move banner with its three steps, "Save backup" and "Open the new address", hidden until needed', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const banner = html.match(/<div class="reminder" id="move-reminder"[^>]*>[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(banner, /\bhidden\b/);
  assert.match(banner, /oPin has moved to a new address\. Your pins are stored at this address only: 1\. Save a backup here\. 2\. Open the new address and add it to your Home Screen\. 3\. There: Settings → Import → choose the backup\./);
  assert.match(banner, /<button type="button" class="btn btn--small" id="move-save">Save backup<\/button>/);
  assert.match(banner, /<a class="btn btn--small btn--primary" id="move-open" target="_blank" rel="noopener">Open the new address<\/a>/);
  assert.doesNotMatch(banner, /workers\.dev/, 'the new address is never hard-coded');
});

test('wrangler.toml deploys as "opin"', () => {
  assert.match(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), /^name = "opin"$/m);
});
