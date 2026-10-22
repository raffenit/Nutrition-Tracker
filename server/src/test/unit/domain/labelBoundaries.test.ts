import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findNutrientLabelBoundaries, sliceForLabelAnchor } from '../../../domain/labelBoundaries.js';
import { inferNutrientsFromUnits } from '../../../domain/labelUnits.js';

test('findNutrientLabelBoundaries separates Fat and Protein in one OCR run', () => {
  const text = 'Fat 2.59 8 (Protein 30g 60%';
  const bounds = findNutrientLabelBoundaries(text);
  const slots = bounds.map((row) => row.slot);
  assert.ok(slots.includes('total_fat'));
  assert.ok(slots.includes('protein'));
  const fatIdx = bounds.find((row) => row.slot === 'total_fat')!.index;
  const proteinIdx = bounds.find((row) => row.slot === 'protein')!.index;
  assert.ok(proteinIdx > fatIdx);

  const fatSlice = sliceForLabelAnchor(text, fatIdx, 'total_fat', 40);
  assert.match(fatSlice, /^Fat 2\.59/);
  assert.doesNotMatch(fatSlice, /Protein/i);
});

test('inferNutrientsFromUnits reads fat and protein from glued paragraph', () => {
  const text = 'Fat 2.59 8 (Protein 30g 60%';
  const nutrients = inferNutrientsFromUnits(text);
  assert.equal(nutrients.fat, 2.5);
  assert.equal(nutrients.protein, 30);
});
