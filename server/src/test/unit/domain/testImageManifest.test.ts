import assert from 'node:assert/strict';
import { test } from 'node:test';
import { totalNutrientRowsFromGroundTruth } from '../../../domain/testImageManifest.types.js';

test('totalNutrientRowsFromGroundTruth sums main and secondary', () => {
  assert.equal(
    totalNutrientRowsFromGroundTruth({ mainSectionRows: 10, secondarySectionRows: 4 }),
    14,
  );
});
