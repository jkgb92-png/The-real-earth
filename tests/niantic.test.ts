import nianticData, { toFeatureCollection } from '../agents/niantic';

test('toFeatureCollection produces FeatureCollection with matching feature count', () => {
  const fc = toFeatureCollection(nianticData as any);
  expect(fc.type).toBe('FeatureCollection');
  expect(Array.isArray(fc.features)).toBe(true);
  expect(fc.features.length).toBe((nianticData as any).length);
});

test('first feature is a Point', () => {
  const fc = toFeatureCollection(nianticData as any);
  expect(fc.features[0].geometry.type).toBe('Point');
});
