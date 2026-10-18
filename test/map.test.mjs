// test/map.test.mjs — the small preview map in the dialogs (Leaflet stubbed).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PreviewMap } from '../web/js/map.js';

/** Just enough of Leaflet for PreviewMap. */
function fakeLeaflet() {
  const chain = { addTo() { return this; } };
  return {
    map: () => ({ setView() { return this; }, invalidateSize() {}, fitBounds() {}, remove() {} }),
    tileLayer: () => ({ ...chain }),
    layerGroup: () => ({ ...chain, clearLayers() {} }),
    marker: () => ({ ...chain }),
    divIcon: () => ({}),
    latLngBounds: () => ({ pad() { return this; } }),
  };
}

test('preview map: closing the dialog within 60 ms of showing it (Drop pin tapped at once) does not throw', (t) => {
  globalThis.L = fakeLeaflet();
  globalThis.document = { getElementById: () => ({}) };
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); delete globalThis.L; delete globalThis.document; });
  const preview = new PreviewMap('confirm-map');
  preview.show([{ lat: 48.1, lon: 11.5, title: 'Synthetic place' }]);
  preview.destroy();
  assert.doesNotThrow(() => mock.timers.tick(100));
});
