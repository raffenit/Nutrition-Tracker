import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessLabelFieldReview, caloriesMergedWithDailyValueColumn } from '../../../domain/labelFieldReview.js';
import { parseNutritionLabel } from '../../../domain/parseLabel.js';
test('flags calories when OCR merges kcal with daily-value slash', () => {
  assert.equal(caloriesMergedWithDailyValueColumn('Amount calories 152/22 Daily Value'), true);
  const text = `
Nutrition Facts
Amount calories 152/22
Total Fat 2.5g
Protein 30g
`;
  const parsed = parseNutritionLabel(text);
  assert.equal(parsed.nutrients.calories, 150);
  const review = assessLabelFieldReview(text, parsed);
  assert.equal(review.calories?.status, 'review');
});

test('marks missing core field when label word appears but value is zero', () => {
  const text = 'Nutrition Facts\nSodium\nTotal Fat 2g\nProtein 3g';
  const parsed = parseNutritionLabel(text);
  const review = assessLabelFieldReview(text, parsed);
  assert.equal(review.sodium?.status, 'missing');
});
