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
