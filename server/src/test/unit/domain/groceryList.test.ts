import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateGroceryLineItems } from '../../../domain/groceryList.js';
import { kitLineKeyFromText } from '../../../domain/kitLineKey.js';
import type { Food } from '../../../types.js';

const yogurt: Food = {
  id: 'y1',
  name: 'Greek yogurt',
  brand: null,
  kind: 'packaged',
  servingLabel: '1 cup',
  servingsPerContainer: null,
  nutrients: { calories: 100, protein: 15, fiber: 0, fat: 0, carbs: 8, sodium: 60, extras: [] },
  nutrientUnits: { calories: 'kcal', protein: 'g', fiber: 'g', fat: 'g', carbs: 'g', sodium: 'mg' },
  isFavorite: false,
  isDrink: false,
  drinkMl: null,
  makesServings: 1,
  source: 'manual',
  sourceRef: null,
  instructions: null,
  mealKitEcosystemId: null,
  proteinTags: [],
  ingredients: [],
};

const chili: Food = {
  id: 'r1',
  name: 'Turkey chili',
  brand: null,
  kind: 'custom',
  servingLabel: '1 bowl',
  servingsPerContainer: null,
  nutrients: { calories: 300, protein: 30, fiber: 8, fat: 8, carbs: 28, sodium: 400, extras: [] },
  nutrientUnits: { calories: 'kcal', protein: 'g', fiber: 'g', fat: 'g', carbs: 'g', sodium: 'mg' },
  isFavorite: false,
  isDrink: false,
  drinkMl: null,
  makesServings: 4,
  source: 'composed',
  sourceRef: null,
  instructions: null,
  mealKitEcosystemId: null,
  proteinTags: [],
  ingredients: [{
    name: 'Greek yogurt',
    servings: 2,
    sourceRef: null,
    childFoodId: 'y1',
    componentRole: null,
    shopEquivalentFoodId: null,
    shopEquivalentLabel: null,
  }],
};

const kitSauceLine = {
  name: 'Green Chef chimichurri pouch',
  servings: 1,
  sourceRef: null,
  childFoodId: null as string | null,
  componentRole: null as 'main' | 'side' | null,
  shopEquivalentFoodId: 'y1',
  shopEquivalentLabel: null as string | null,
};

const mealKit: Food = {
  ...chili,
  id: 'r2',
  name: 'Steak kit',
  ingredients: [kitSauceLine],
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

test('aggregateGroceryLineItems parses oz quantities from ingredient text', () => {
  const chicken: Food = {
    ...yogurt,
    id: 'chicken',
    name: 'Chicken thighs',
    kind: 'custom',
    makesServings: 2,
    ingredients: [{
      name: '12 oz boneless chicken thighs',
      servings: 1,
      sourceRef: null,
      childFoodId: null,
      componentRole: null,
      shopEquivalentFoodId: null,
      shopEquivalentLabel: null,
    }],
  };
  const map = new Map<string, Food>([['chicken', chicken]]);
  const items = aggregateGroceryLineItems([{ foodId: 'chicken', servings: 4 }], (id) => map.get(id) ?? null);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.quantity, 24);
  assert.equal(items[0]?.unit, 'oz');
});

test('aggregateGroceryLineItems resolves ecosystem sheet without per-recipe equivalents', () => {
  const mealKit: Food = {
    ...chili,
    id: 'r3',
    name: 'Salmon kit',
    mealKitEcosystemId: 'eco1',
    ingredients: [{
      name: 'Garlic & Herb Butter',
      servings: 1,
      sourceRef: null,
      childFoodId: null,
      componentRole: null,
      shopEquivalentFoodId: null,
      shopEquivalentLabel: null,
    }],
  };
  const map = new Map<string, Food>([['y1', yogurt], ['r3', mealKit]]);
  const sheet = new Map([[
    'eco1:garlic & herb butter',
    {
      id: 'm1',
      ecosystemId: 'eco1',
      kitLineName: 'Garlic & Herb Butter',
      nameKey: 'garlic & herb butter',
      shopEquivalentFoodId: 'y1',
      shopEquivalentLabel: null,
      nutritionFoodId: null,
    },
  ]]);
  const items = aggregateGroceryLineItems(
    [{ foodId: 'r3', servings: 2 }],
    (id) => map.get(id) ?? null,
    (ecoId, lineName) => {
      const key = kitLineKeyFromText(lineName);
      return sheet.get(`${ecoId}:${key}`) ?? null;
    },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'Greek yogurt');
  assert.equal(items[0]?.recipeLineName, 'Garlic & Herb Butter');
});

test('aggregateGroceryLineItems uses shop equivalent for kit-specific ingredients', () => {
  const map = new Map<string, Food>([
    ['y1', yogurt],
    ['r2', mealKit],
  ]);
  const items = aggregateGroceryLineItems([{ foodId: 'r2', servings: 2 }], (id) => map.get(id) ?? null);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'Greek yogurt');
  assert.equal(items[0]?.recipeLineName, 'Green Chef chimichurri pouch');
});

function recipeWithLines(id: string, lines: Array<{ name: string; servings?: number }>): Food {
  return {
    ...chili,
    id,
    name: `Recipe ${id}`,
    makesServings: 1,
    ingredients: lines.map((line) => ({
      name: line.name,
      servings: line.servings ?? 1,
      sourceRef: null,
      childFoodId: null,
      componentRole: null,
      shopEquivalentFoodId: null,
      shopEquivalentLabel: null,
    })),
  };
}

test('aggregateGroceryLineItems merges same ingredient across recipes and quantities', () => {
  const map = new Map<string, Food>([
    ['rA', recipeWithLines('rA', [{ name: '1 cup broccoli' }])],
    ['rB', recipeWithLines('rB', [{ name: '2 cups broccoli' }, { name: 'Broccoli, steamed' }])],
  ]);
  // "Broccoli, steamed" normalizes to a different key than "broccoli" — only
  // the two qty-prefixed lines merge here.
  const items = aggregateGroceryLineItems(
    [{ foodId: 'rA', servings: 1 }, { foodId: 'rB', servings: 1 }],
    (id) => map.get(id) ?? null,
  );
  const broccoli = items.filter((item) => item.name.toLowerCase().includes('broccoli'));
  const merged = broccoli.find((item) => item.unit === 'cup');
  assert.ok(merged);
  assert.equal(merged.quantity, 3);
  assert.equal(merged.name, 'broccoli');
});

test('aggregateGroceryLineItems keeps different units on separate lines', () => {
  const map = new Map<string, Food>([
    ['rA', recipeWithLines('rA', [{ name: '1 cup broccoli' }])],
    ['rB', recipeWithLines('rB', [{ name: '8 oz broccoli' }])],
  ]);
  const items = aggregateGroceryLineItems(
    [{ foodId: 'rA', servings: 1 }, { foodId: 'rB', servings: 1 }],
    (id) => map.get(id) ?? null,
  );
  const broccoli = items.filter((item) => item.name.toLowerCase() === 'broccoli');
  assert.equal(broccoli.length, 2);
  assert.deepEqual(broccoli.map((item) => item.unit).sort(), ['cup', 'oz']);
});
