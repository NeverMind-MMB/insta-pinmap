import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPhoton, normNominatim, makeQueue } from '../web/js/geocode.js';

test('normPhoton builds name, address and country code', () => {
  const r = normPhoton({ features: [{ geometry: { coordinates: [13.6486, 47.5621] }, properties: {
    name: 'Hallstatt', postcode: '4830', state: 'Oberösterreich', country: 'Österreich', countrycode: 'at', osm_key: 'place', osm_value: 'village' } }] });
  assert.deepEqual(r[0], { lat: 47.5621, lon: 13.6486, name: 'Hallstatt', address: 'Hallstatt, 4830, Oberösterreich, Österreich',
    kind: 'village', category: 'place', countryCode: 'AT', importance: null, source: 'photon' });
});

test('normNominatim parses strings and drops broken rows', () => {
  const r = normNominatim([{ lat: '52.5', lon: '13.4', display_name: 'Berlin, Deutschland', type: 'city', class: 'place', importance: 0.8, address: { country_code: 'de' } }, { lat: 'x', lon: '1' }]);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'Berlin');
  assert.equal(r[0].countryCode, 'DE');
});

test('makeQueue keeps the gap and survives a failing call', async () => {
  const q = makeQueue(100);
  const times = [];
  await Promise.allSettled([
    q(async () => { times.push(Date.now()); throw new Error('boom'); }),
    q(async () => { times.push(Date.now()); }),
    q(async () => { times.push(Date.now()); }),
  ]);
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 95 && times[2] - times[1] >= 95, `gaps ${times[1] - times[0]}, ${times[2] - times[1]}`);
});
