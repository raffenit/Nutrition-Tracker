import assert from 'node:assert/strict';
import test from 'node:test';
import { perServing, sumIngredientNutrients } from '../../../domain/compose.js';
import { emptyNutrients } from '../../../domain/nutrients.js';
import { HttpError } from '../../../http/errors.js';

test('sumIngredientNutrients scales each line by its servings', () => {
  const base = { ...emptyNutrients(), calories: 100, protein: 10 };
  const total = sumIngredientNutrients([
    { servings: 1, nutrients: base },
    { servings: 2, nutrients: { ...emptyNutrients(), calories: 50, protein: 5 } },
  ]);
  assert.equal(total.calories, 200);
  assert.equal(total.protein, 20);
});

test('perServing divides totals by makesServings', () => {
  const total = { ...emptyNutrients(), calories: 600, protein: 40 };
  const one = perServing(total, 4);
  assert.equal(one.calories, 150);
  assert.equal(one.protein, 10);
});

test('perServing rejects non-positive makesServings', () => {
  assert.throws(() => perServing(emptyNutrients(), 0), (error: unknown) => {
    return error instanceof HttpError && error.status === 400;
  });
});
