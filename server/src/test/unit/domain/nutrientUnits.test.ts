import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeCoreNutrients, displayCoreNutrients } from '../../../domain/nutrientUnits.js';

test('canonicalizes mass units for storage', () => {
  const canonical = canonicalizeCoreNutrients(
    { calories: 150, protein: 500, fiber: 0, fat: 0, carbs: 0, sodium: 230 },
    { calories: 'kcal', protein: 'mg', fiber: 'g', fat: 'g', carbs: 'g', sodium: 'mg' },
  );
  assert.equal(canonical.protein, 0.5);
  assert.equal(canonical.sodium, 230);
});

test('displays canonical values in chosen units', () => {
  const display = displayCoreNutrients(
    { calories: 150, protein: 0.5, fiber: 1, fat: 2.5, carbs: 4, sodium: 230 },
    { calories: 'kcal', protein: 'mg', fiber: 'g', fat: 'g', carbs: 'g', sodium: 'mg' },
  );
  assert.equal(display.protein, 500);
  assert.equal(display.fat, 2.5);
});
