import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stitchSplitLabelHalves } from '../../../domain/stitchSplitLabelHalves.js';

const LEFT = `Nutrition Facts
Serving Size 2/3 cup
Calories 230
Total Fat 8g`;

const RIGHT = `Saturated Fat 1g
Sodium 140mg
Protein 3g`;

test('stitchSplitLabelHalves merges two halves into one parseable label', () => {
  const merged = stitchSplitLabelHalves(LEFT, RIGHT);
  assert.ok(merged);
  assert.match(merged!, /Calories\s+230/i);
  assert.match(merged!, /Sodium\s+140mg/i);
});

test('stitchSplitLabelHalves accepts halves without a heading when nutrient rows are strong', () => {
  const merged = stitchSplitLabelHalves(
    'Total Fat 4.5g 6%\nSaturated Fat 3.5g 18%\nCholesterol 10mg 3%\nSodium 90mg 4%',
    'Total Carb. 32g 12%\nDietary Fiber 6g 21%\nTotal Sugars 20g\nProtein 5g',
  );
  assert.ok(merged);
});

test('stitchSplitLabelHalves rejects headingless noise', () => {
  assert.equal(stitchSplitLabelHalves('ata wr - p\nIR HON % ON', 'eo -\nee — a'), null);
});
