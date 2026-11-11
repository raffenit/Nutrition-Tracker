import assert from 'node:assert/strict';
import test from 'node:test';
import { blocksLookLikeSeparateLabels, splitNutritionLabelTexts } from '../../../domain/labelTextBlocks.js';

const PANEL_A = `Nutrition Facts
Serving Size 1 cup (240ml)
Calories 90
Protein 8g`;

const PANEL_B = `Nutrition Facts
Serving Size 2 tbsp (30g)
Calories 210
Protein 2g`;

test('splitNutritionLabelTexts splits on repeated Nutrition Facts headings', () => {
  const combined = `${PANEL_A}\n\nProduct B\n${PANEL_B}`;
  const blocks = splitNutritionLabelTexts(combined);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0]!, /90/);
  assert.match(blocks[1]!, /210/);
});

test('blocksLookLikeSeparateLabels needs two label-like blocks', () => {
  assert.equal(blocksLookLikeSeparateLabels(splitNutritionLabelTexts(`${PANEL_A}\n${PANEL_B}`)), true);
  assert.equal(blocksLookLikeSeparateLabels(['only one block']), false);
});
