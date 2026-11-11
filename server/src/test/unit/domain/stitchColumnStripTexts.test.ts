import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import { stitchColumnStripOcrTexts } from '../../../domain/stitchColumnStripTexts.js';

const STRIP_A = `
Nutrition Facts
Crunchy Wafer
Calories 140
Total Fat 5g
Sodium 120mg
Protein 2g
`;

const STRIP_B = `
Nutrition Facts
Cocoa Bar
Calories 150
Total Fat 6g
Sodium 140mg
Protein 8g
`;

const STRIP_C = `
Nutrition Facts
Peanut Mix
Calories 160
Total fat 7g
Sodium 100mg
Protein 6g
`;

test('stitchColumnStripOcrTexts builds a spaced multi-product table', () => {
  const stitched = stitchColumnStripOcrTexts([STRIP_A, STRIP_B, STRIP_C]);
  assert.ok(stitched);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.ok(cols && cols.length === 3);
  assert.equal(cols![1]!.name, 'Cocoa Bar');
  assert.equal(cols![1]!.nutrients.calories, 150);
  assert.equal(cols![2]!.nutrients.protein, 6);
});

test('stitchColumnStripOcrTexts returns null for a single strip', () => {
  assert.equal(stitchColumnStripOcrTexts([STRIP_A]), null);
});
