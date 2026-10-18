// test/guidehelper.test.mjs — the oPin guide helper: a bookmarklet that reads an Apple Guide on maps.apple.com (web/js/guidehelper.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { guideHelper, guideHelperCode, linkGuideHelper } = await import('../web/js/guidehelper.js');
const { ugLink, pbText, pbIdRef, pbPin } = await import('./ug.mjs');

/* A synthetic guide: one own pin, three Apple Maps places (1001 on the page, 1002 and 1003 fetched). */
const SYN_GUIDE = ugLink([pbText(1, 'Synthetic Guide'), pbIdRef(9902, '1001'), pbPin('Pin?', 'Street 1, Town', 47.1, 11.1), pbIdRef(6489, '1002'), pbIdRef(9902, '1003')]);
const GUIDE_URL = 'https://maps.apple.com/guides?user=' +
  new URL(SYN_GUIDE).searchParams.get('ug').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SHELL = '{"items":[{"ref":"1001","muid":"a"},{"ref":"1002","muid":"b"},{"ref":"1003","muid":"c"},{"ref":"1001","muid":"a"}],' +
  '"map":[{"ref":"1001","title":"Museum \\"Neu\\"","center":[48.1,11.5]}]}';

function placePage(name, lat, lon) {
  return `<!DOCTYPE html><html><head><title>${name} in Testtown, Germany - Apple Maps</title>
<meta property="og:title" content="${name}"><meta property="place:location:latitude" content="${lat}">
<meta property="place:location:longitude" content="${lon}"></head><body>${'<p>x</p>'.repeat(500)}</body></html>`;
}

/** A page for the helper: maps.apple.com with shell-props, a body for its box, a clipboard. */
function helperPage({ host = 'maps.apple.com', shell = SHELL, clipboard = 'ok' } = {}) {
  const made = [];
  const make = (tag) => {
    const on = {};
    const el = {
      tag, id: '', textContent: '', value: '', children: [], style: '',
      setAttribute(k, v) { this[k] = v; },
      appendChild(kid) { this.children.push(kid); return kid; },
      addEventListener(type, fn) { (on[type] ??= []).push(fn); },
      click: async () => { for (const fn of on.click || []) await fn(); },
      remove() { this.removed = true; },
      select() { this.selected = true; },
    };
    made.push(el);
    return el;
  };
  const body = make('body');
  globalThis.document = {
    body,
    getElementById: (id) => (id === 'shell-props' ? (shell ? { textContent: shell } : null) : made.find((e) => e.id === id && !e.removed) || null),
    createElement: make,
  };
  globalThis.location = { href: GUIDE_URL, hostname: host };
  const copied = [];
  let refusals = clipboard === 'refuse' ? Infinity : clipboard === 'refuse-once' ? 1 : 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (t) => { if (refusals-- > 0) throw new Error('NotAllowedError'); copied.push(t); } } },
  });
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    const id = /auid=(\d+)/.exec(String(url))?.[1];
    if (id === '1002') return new Response(placePage('Lake Village', 47.6, 11.3));
    if (id === '1003') return new Response(placePage('Hill &amp; Hut', 47.7, 11.4));
    return new Response('gone', { status: 404 });
  };
  const box = () => body.children[0];
  const say = () => box().children[0].textContent;
  const buttons = () => box().children.filter((c) => c.tag === 'button');
  return { copied, fetched, box, say, buttons };
}

function cleanUp() {
  delete globalThis.document;
  delete globalThis.location;
}

test('the guide helper: the page\'s places plus the others fetched from /place?auid= heads; the guide link first, then "@@" lines, copied', async () => {
  const page = helperPage();
  try {
    await guideHelper();
    assert.deepEqual(page.fetched.sort(), ['/place?auid=1002', '/place?auid=1003'], 'only the places the page lacks');
    assert.equal(page.copied.length, 1);
    const [first, ...lines] = page.copied[0].split('\n');
    assert.equal(first, GUIDE_URL);
    assert.deepEqual(lines.sort(), [
      'https://maps.apple.com/place?auid=1001@@Museum "Neu"@@48.1@@11.5@@',
      'https://maps.apple.com/place?auid=1002@@Lake Village@@47.6@@11.3@@Testtown, Germany',
      'https://maps.apple.com/place?auid=1003@@Hill & Hut@@47.7@@11.4@@Testtown, Germany',
    ]);
    assert.equal(page.say(), 'oPin: Copied 3 of 3 places — paste in oPin.');
    assert.deepEqual(page.buttons().map((b) => b.textContent), ['Close']);
  } finally {
    cleanUp();
  }
});

test('what the helper copies, pasted in oPin\'s input bar, opens that guide\'s import with every place found', async () => {
  const page = helperPage();
  let copied;
  try {
    await guideHelper();
    [copied] = page.copied;
  } finally {
    cleanUp();
  }
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const { startAdd, isShortcutPaste } = await import('../web/js/router.js');
  assert.equal(isShortcutPaste(copied), true, 'pasted whole, not into the one-line field');
  const imports = [];
  await startAdd(copied, { toast() {}, hideToast() {}, inputDone() {}, showImport: (e, n, g) => imports.push({ e, n, g }), importPaste: () => assert.fail('not an import of several links') });
  const { e, n, g } = imports[0];
  assert.equal(n, 'Synthetic Guide');
  assert.deepEqual(g.appleIds, ['1001', '1002', '1003']);
  assert.deepEqual(e.map((r) => [r.name, r.checked !== false]), [['Pin', true], ['Museum "Neu"', true], ['Lake Village', true], ['Hill & Hut', true]]);
});

test('the guide helper: when the browser refuses the clipboard after the wait, a Copy button (and then a text box) takes over', async () => {
  let page = helperPage({ clipboard: 'refuse-once' });
  try {
    await guideHelper();
    assert.equal(page.say(), 'oPin: 3 of 3 places ready.');
    const [copyButton] = page.buttons();
    assert.equal(copyButton.textContent, 'Copy');
    await copyButton.click();
    assert.equal(page.copied.length, 1);
    assert.equal(page.say(), 'oPin: Copied 3 of 3 places — paste in oPin.');
  } finally {
    cleanUp();
  }
  page = helperPage({ clipboard: 'refuse' });
  try {
    await guideHelper();
    await page.buttons()[0].click();
    const area = page.box().children.find((c) => c.tag === 'textarea');
    assert.ok(area?.selected, 'the text, selected, to copy by hand');
    assert.match(area.value, /^https:\/\/maps\.apple\.com\/guides\?user=/);
  } finally {
    cleanUp();
  }
});

test('the guide helper elsewhere than maps.apple.com, or on a page without places: says what to do, fetches nothing', async () => {
  for (const [options, said] of [[{ host: 'www.example.com' }, /open the guide on maps\.apple\.com/], [{ shell: '{"nothing":1}' }, /lists no Apple Maps places/]]) {
    const page = helperPage(options);
    try {
      await guideHelper();
      assert.match(page.say(), said);
      assert.deepEqual(page.fetched, []);
      assert.deepEqual(page.copied, []);
    } finally {
      cleanUp();
    }
  }
});

test('guideHelperCode: a javascript:void(…) bookmark address that holds the helper, and still runs without its line breaks', () => {
  const code = guideHelperCode();
  assert.match(code, /^javascript:void%20\(function%20guideHelper\(\)/);
  const source = decodeURIComponent(code.slice('javascript:'.length));
  assert.equal(source, `void (${guideHelper.toString()})();`);
  assert.doesNotThrow(() => new Function(source.replace(/\r?\n/g, ' ')), 'no line comment cuts it short');
  assert.ok(code.length < 16000, `${code.length} characters`);
});

test('the app hands the helper out but never runs it: the link gets the code, a click says how to add it; "Copy helper code" copies it', async () => {
  const handlers = {};
  const link = { href: '', addEventListener: (type, fn) => { handlers.link = fn; } };
  const copyButton = { addEventListener: (type, fn) => { handlers.copy = fn; } };
  const root = { querySelectorAll: (sel) => (sel === 'a[data-guide-helper]' ? [link] : sel === 'button[data-guide-helper-copy]' ? [copyButton] : []) };
  const toasts = [];
  linkGuideHelper(root, (text, kind) => toasts.push([text, kind]));
  assert.equal(link.href, guideHelperCode());
  let prevented = false;
  handlers.link({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented, 'the javascript: link is not followed in the app');
  assert.match(toasts.at(-1)[0], /^Drag "oPin guide helper" to your bookmarks bar/);
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { copied.push(t); } } } });
  await handlers.copy();
  assert.deepEqual(copied, [guideHelperCode()]);
  assert.match(toasts.at(-1)[0], /paste it as its address/);
});

test('index.html: "No iPhone?" with the helper link and "Copy helper code" in the import dialog\'s Apple notice and in Settings\' Shortcut help', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const part = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
  for (const [where, text] of [
    ['import dialog', part('id="import-apple"', 'id="import-all"')],
    ['Settings → Import', part('<legend>Import</legend>', '</fieldset>')],
  ]) {
    assert.match(text, /No iPhone\? Open the guide on maps\.apple\.com in a desktop browser and use the oPin guide helper/, where);
    const link = text.match(/<a\b[^>]*\bdata-guide-helper\b[^>]*>oPin guide helper<\/a>/);
    assert.ok(link, `${where}: the helper link`);
    assert.doesNotMatch(link[0], /\bhref=/, `${where}: the code comes from guidehelper.js`);
    assert.match(text, /<button type="button" class="btn btn--small" data-guide-helper-copy>Copy helper code<\/button>/, where);
  }
  assert.equal(html.match(/data-guide-helper\b(?!-)/g).length, 2);
});
