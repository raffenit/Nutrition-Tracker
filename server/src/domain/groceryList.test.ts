import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateGroceryLineItems } from './groceryList.js';
import type { Food } from '../types.js';

const yogurt: Food = {
  id: 'y1',
  name: 'Greek yogurt',
  brand: null,
  kind: 'packaged',
  servingLabel: '1 cup',
  nutrients: { calories: 100, protein: 15, fiber: 0, fat: 0, carbs: 8, sodium: 60, extras: [] },
  isFavorite: false,
  isDrink: false,
  drinkMl: null,
  makesServings: 1,
  source: 'manual',
  sourceRef: null,
  ingredients: [],
};

const chili: Food = {
  id: 'r1',
  name: 'Turkey chili',
  brand: null,
  kind: 'custom',
  servingLabel: '1 bowl',
  nutrients: { calories: 300, protein: 30, fiber: 8, fat: 8, carbs: 28, sodium: 400, extras: [] },
  isFavorite: false,
  isDrink: false,
  drinkMl: null,
  makesServings: 4,
  source: 'composed',
  sourceRef: null,
  ingredients: [{ name: 'Greek yogurt', servings: 2, sourceRef: null, childFoodId: 'y1' }],
};

test('aggregateGroceryLineItems scales recipe ingredients by planned servings', () => {
  const map = new Map<string, Food>([
    ['y1', yogurt],
    ['r1', chili],
  ]);
  const items = aggregateGroceryLineItems([{ foodId: 'r1', servings: 8 }], (id) => map.get(id) ?? null);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'Greek yogurt');
  assert.equal(items[0]?.quantity, 4);
});
