import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSlotConsensus, extractSlotReadingsFromText, mergeSlotReadingsAcrossCandidates } from '../../../domain/labelSlotExtract.js';

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

test('breaks equal-score slot ties by how many candidates agree', () => {
  const read = (carbs: number) => `Nutrition Facts\nTotal Carbohydrate ${carbs}g\nProtein 30g\n`;
  const merged = mergeSlotReadingsAcrossCandidates([read(2), read(4), read(4)]);
  assert.ok(merged);
  assert.equal(merged.carbs, 4);
  const carbs = assessSlotConsensus([read(2), read(4), read(4)]).get('carbs');
  assert.ok(carbs);
  assert.equal(carbs.support, 2);
  assert.equal(carbs.contested, true);
  assert.deepEqual(carbs.rivals, [2]);
  assert.equal(assessSlotConsensus([read(4), read(4)]).get('carbs')?.contested, false);
});

test('clean "Total Carbohydrate 4g" outranks a garbled read of the same row', () => {
  const garbled = `Nutrition Facts\n[Total Carbohydratedg 1% | 2 9\nProtein 30g\n`;
  const clean = `Nutrition Facts\nTotal Carbohydrate 4g 0h) Se <\nProtein 30g\n`;
  const merged = mergeSlotReadingsAcrossCandidates([garbled, clean]);
  assert.ok(merged);
  assert.equal(merged.carbs, 4);
  assert.equal(assessSlotConsensus([garbled, clean]).get('carbs')?.contested, false);
});

test('full label phrase scores high even when the anchor lands on its second word', () => {
  const text = `Nutrition Facts
Total Fat 2.5g 3%
Total Carbohydrate 4g 1%
Total Sugars 2g
`;
  const strength = (slot: string) => extractSlotReadingsFromText(text, 0).find((r) => r.slot === slot)?.labelStrength;
  assert.equal(strength('fat'), 100);
  assert.equal(strength('carbs'), 100);
  assert.equal(strength('sugar'), 100);
});

test('label lookback stays on the same line', () => {
  const text = `Nutrition Facts
Total
Carbohydrate 4g
`;
  const carbs = extractSlotReadingsFromText(text, 0).find((r) => r.slot === 'carbs');
  assert.ok(carbs);
  assert.equal(carbs.labelStrength, 65);
});

test('a parent row smaller than its sub-rows yields to a consistent rival reading', () => {
  const merged = mergeSlotReadingsAcrossCandidates([
    'Total Carb. 2g 1%\nDietary Fiber 6g 21%\nTotal Sugars 20g',
    'Total Carb. 2g 1%\nDietary Fiber 6g\nTotal Sugars 20g',
    'Total Carb: 32g 12%\nDietary Fiber 6g\nTotal Sugars 20g',
  ]);
  assert.equal(merged?.carbs, 32);
});

test('a consistent parent row keeps its top-ranked reading', () => {
  const merged = mergeSlotReadingsAcrossCandidates([
    'Total Carbohydrate 4g\nTotal Sugars 2g',
    'Total Carbohydrate 4g\nTotal Sugars 2g',
    'Total Carbohydrate 14g',
  ]);
  assert.equal(merged?.carbs, 4);
});

test('a %DV figure after an unreadable amount is never taken as the gram amount', () => {
  const merged = mergeSlotReadingsAcrossCandidates([
    'Protein Gg 10% 5%',
    'Protein Sg 10% 5%',
    'Frotein 5g 10% 169',
  ]);
  assert.equal(merged?.protein, 5);
});
