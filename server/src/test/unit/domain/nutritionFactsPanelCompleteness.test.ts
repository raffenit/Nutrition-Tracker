import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessNutritionFactsPanelCompleteness } from '../../../domain/nutritionFactsPanelCompleteness.js';

const FULL_PANEL = `Nutrition Facts
1 serving per container
Serving size 1 Bottle (340mL)
Amount per serving
Calories 150
Total Fat 2.5g
Saturated Fat 1.5g
Cholesterol 25mg
Sodium 230mg
Total Carbohydrate 4g
Protein 30g`;

const LAPLACIAN_PARTIAL = `Saturated Fat 1.5g 8%
Trans Fat 0g
Cholesterol 25mg 8%
Sodium 230mg 10%
Total Carbohydrate 4g 1%
Protein 30g 60%`;

test('assessNutritionFactsPanelCompleteness accepts full panel text', () => {
  const r = assessNutritionFactsPanelCompleteness(FULL_PANEL);
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
});

test('assessNutritionFactsPanelCompleteness accepts noisy probe with racts and TotalFat run-on', () => {
  const noisy = `Nutrition racts\nCalories 150\nTotalFat 2.5g\nSodium 230mg\nProtein 30g`;
  const r = assessNutritionFactsPanelCompleteness(noisy);
  assert.equal(r.complete, true);
});

test('assessNutritionFactsPanelCompleteness rejects crop missing header and calories', () => {
  const r = assessNutritionFactsPanelCompleteness(LAPLACIAN_PARTIAL);
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes('heading'));
  assert.ok(r.missing.includes('calories'));
  assert.ok(r.missing.includes('total_fat'));
});