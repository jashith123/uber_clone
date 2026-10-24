/**
 * Address search providers: Google Places replies are mapped to the same shape
 * Nominatim results use, so the app does not care which one answered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { placesFromGoogle, placeFromGoogleReverse } = await import('../src/services/geo.js');

test('a Places text-search reply becomes name/label/lat/lng, dropping entries without a location', () => {
  const out = placesFromGoogle({
    places: [
      { displayName: { text: 'Elante Mall' }, formattedAddress: 'Industrial Area Phase I, Chandigarh, 160002', location: { latitude: 30.7056, longitude: 76.8013 }, primaryType: 'shopping_mall' },
      { displayName: { text: 'No location' }, formattedAddress: 'Nowhere' },
    ],
  });
  assert.deepEqual(out, [{ name: 'Elante Mall', label: 'Industrial Area Phase I, Chandigarh, 160002', lat: 30.7056, lng: 76.8013, type: 'shopping_mall' }]);
  assert.deepEqual(placesFromGoogle({}), []);
});

test('a reverse-geocode reply names the place by its first real address part', () => {
  const r = placeFromGoogleReverse(
    {
      results: [
        {
          formatted_address: 'WJRP+6M, Sector 17, Chandigarh, 160017, India',
          address_components: [
            { long_name: 'WJRP+6M', types: ['plus_code'] },
            { long_name: 'Sector 17', types: ['sublocality_level_1', 'sublocality', 'political'] },
          ],
        },
      ],
    },
    30.741,
    76.7822,
  );
  assert.deepEqual(r, { label: 'WJRP+6M, Sector 17, Chandigarh, 160017, India', name: 'Sector 17', lat: 30.741, lng: 76.7822 });
  assert.equal(placeFromGoogleReverse({ results: [] }, 1, 2), null);
});
