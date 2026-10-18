// test/pinwheel.test.mjs — the add-pin animation plays only where it can be seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playPinwheel } from '../web/js/pinwheel.js';

/** The #pinwheel box inside the map view; `mapShown` is false while the List tab hides the map view (phone). */
function pinwheelDocument({ mapShown }) {
  const classes = new Set();
  const logo = { attrs: {}, style: {}, setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; } };
  const caption = { textContent: '' };
  const box = {
    hidden: true,
    parentElement: { getClientRects: () => (mapShown ? [{ width: 375, height: 600 }] : []) },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    querySelector: (selector) => (selector === '.pinwheel__logo' ? logo : caption),
    getBoundingClientRect: () => ({}),
  };
  return { box, logo, document: { getElementById: (id) => (id === 'pinwheel' ? box : null) } };
}

test('the pinwheel plays over the map view when that shows', (t) => {
  const { box, logo, document } = pinwheelDocument({ mapShown: true });
  globalThis.document = document;
  t.after(() => { delete globalThis.document; });
  playPinwheel({ logo: '/icons/sources/apple.png' });
  assert.equal(box.hidden, false);
  assert.equal(box.classList.contains('is-playing'), true);
  assert.equal(logo.attrs.href, '/icons/sources/apple.png');
});

test('the pinwheel is skipped while the map view is hidden (List tab on a phone), not saved up for later', (t) => {
  const { box, document } = pinwheelDocument({ mapShown: false });
  globalThis.document = document;
  t.after(() => { delete globalThis.document; });
  playPinwheel({ logo: '/icons/sources/apple.png' });
  assert.equal(box.hidden, true);
  assert.equal(box.classList.contains('is-playing'), false);
});
