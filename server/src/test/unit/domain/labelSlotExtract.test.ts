import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSlotReadingsAcrossCandidates } from '../../../domain/labelSlotExtract.js';

test('merges sodium from one OCR candidate and fat from another by label + unit', () => {
  const sodiumRich = `
Nutrition Facts
Trans Fat 0g
Sedium 230mg_ 10%
Total Carbohydrate 4g
Protein 30g
`;
  const fatRich = `
Nutrition Facts
Tolal Fat2.Sg
Total Carbohydrate 4g
Protein 30g
`;
  const merged = mergeSlotReadingsAcrossCandidates([sodiumRich, fatRich]);
  assert.ok(merged);
  assert.equal(merged.sodium, 230);
  assert.equal(merged.fat, 2.5);
  assert.equal(merged.protein, 30);
});
