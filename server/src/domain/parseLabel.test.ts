import assert from 'node:assert/strict';
import test from 'node:test';
import { menuCandidates, parseNutritionLabel } from './parseLabel.js';

const LABEL = `
Nutrition Facts
Serving size 1 cup (240ml)
Amount per serving
Calories 120
Calories from fat 45
Total Fat 5g
Sodium 160mg
Total Carbohydrate 12g
Dietary Fiber 2g
Protein 8g
`;

test('reads a standard nutrition label and ignores calories from fat', () => {
  const parsed = parseNutritionLabel(LABEL);
  assert.equal(parsed.servingLabel, '1 cup (240ml)');
  assert.equal(parsed.nutrients.calories, 120);
  assert.equal(parsed.nutrients.fat, 5);
  assert.equal(parsed.nutrients.sodium, 160);
  assert.equal(parsed.nutrients.carbs, 12);
  assert.equal(parsed.nutrients.fiber, 2);
  assert.equal(parsed.nutrients.protein, 8);
  assert.equal(parsed.looksLikeLabel, true);
});

test('joins values that OCR placed on the following line', () => {
  const parsed = parseNutritionLabel('Calories\n90\nProtein\n3g');
  assert.equal(parsed.nutrients.calories, 90);
  assert.equal(parsed.nutrients.protein, 3);
});

test('treats a restaurant menu as names rather than a label', () => {
  const text = 'Spring Menu\nRoasted chicken\nGarden salad\n';
  const parsed = parseNutritionLabel(text);
  assert.equal(parsed.looksLikeLabel, false);
  assert.deepEqual(menuCandidates(text), ['Spring Menu', 'Roasted chicken', 'Garden salad']);
});
