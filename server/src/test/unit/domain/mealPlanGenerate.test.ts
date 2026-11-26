import assert from 'node:assert/strict';
import test from 'node:test';
import type { Food, IngredientLine } from '../../../types.js';
import { generateMealPlan, planCandidatesFromFoods } from '../../../domain/mealPlanGenerate.js';
import type { ProteinTag } from '../../../domain/proteinTags.js';
import { emptyNutrients } from '../../../domain/nutrients.js';

function line(overrides: Partial<IngredientLine>): IngredientLine {
  return {
    name: 'line',
    servings: 1,
    sourceRef: null,
    childFoodId: null,
    componentRole: null,
    shopEquivalentFoodId: null,
    shopEquivalentLabel: null,
    notes: null,
    altMeasurements: [],
    ...overrides,
  };
}

function food(id: string, name: string, overrides: Partial<Food> = {}): Food {
  return {
    id,
    name,
    brand: null,
    kind: 'custom',
    servingLabel: '1 serving',
    servingsPerContainer: null,
    nutrients: emptyNutrients(),
    nutrientUnits: { calories: 'kcal', protein: 'g', fiber: 'g', fat: 'g', carbs: 'g', sodium: 'mg' },
    isFavorite: false,
    isDrink: false,
    drinkMl: null,
    makesServings: 1,
    source: 'composed',
    sourceRef: null,
    instructions: null,
    mealKitEcosystemId: null,
    proteinTags: [],
    ingredients: [],
    ...overrides,
  };
}

function kitRecipe(id: string, name: string, mainId: string, sideId: string, recipeTags: Food['proteinTags'] = []): Food {
  return food(id, name, {
    proteinTags: recipeTags,
    ingredients: [
      line({ name: 'protein', childFoodId: mainId, componentRole: 'main', servings: 1 }),
      line({ name: 'veg', childFoodId: sideId, componentRole: 'side', servings: 2 }),
      line({ name: 'pantry staple', servings: 1 }),
    ],
  });
}

const salmon = food('f-salmon', 'Salmon fillet', { proteinTags: ['fish'], kind: 'ingredient' });
const chicken = food('f-chicken', 'Chicken breast', { proteinTags: ['chicken'], kind: 'ingredient' });
const rice = food('f-rice', 'Jasmine rice', { kind: 'ingredient' });
const broccoli = food('f-broccoli', 'Broccoli', { kind: 'ingredient' });

const kitA = kitRecipe('r-a', 'Salmon kit', 'f-salmon', 'f-rice', ['fish']);
const kitB = kitRecipe('r-b', 'Chicken kit', 'f-chicken', 'f-broccoli', ['chicken']);

test('planCandidatesFromFoods exposes role-tagged lines as separate candidates', () => {
  const { mains, sides } = planCandidatesFromFoods([salmon, chicken, rice, broccoli, kitA, kitB]);
  const mainIds = mains.map((candidate) => candidate.foodId).sort();
  // Whole foods are mains too; recipe parts add their child foods.
  assert.ok(mainIds.includes('f-salmon'));
  assert.ok(mainIds.includes('f-chicken'));
  assert.ok(mainIds.includes('r-a') === false, 'role-tagged recipe is not a whole candidate');
  assert.deepEqual(sides.map((candidate) => candidate.foodId).sort(), ['f-broccoli', 'f-rice']);
  const salmonPart = mains.find((candidate) => candidate.foodId === 'f-salmon' && candidate.sourceRecipeId === 'r-a');
  assert.equal(salmonPart?.role, 'main');
  assert.deepEqual(salmonPart?.proteinTags, ['fish']);
});

test('component inherits recipe protein tags when child food has none', () => {
  const untaggedFish = food('f-fish2', 'White fish', { kind: 'ingredient' });
  const kit = kitRecipe('r-c', 'Fish kit', 'f-fish2', 'f-rice', ['fish']);
  const { mains } = planCandidatesFromFoods([untaggedFish, rice, kit]);
  const part = mains.find((candidate) => candidate.sourceRecipeId === 'r-c');
  assert.deepEqual(part?.proteinTags, ['fish']);
});

test('generateMealPlan pairs mains with sides on the requested dates', () => {
  const foods = [salmon, chicken, rice, broccoli, kitA, kitB];
  const result = generateMealPlan(foods, {
    mealCount: 4,
    proteins: ['fish', 'chicken'],
    dates: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'],
    slot: 'meal',
    seed: 7,
  });
  assert.equal(result.meals.length, 4);
  for (const [index, meal] of result.meals.entries()) {
    assert.equal(meal.localDate, ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'][index]);
    assert.equal(meal.slot, 'meal');
    assert.ok(meal.main.proteinTags.some((tag) => tag === 'fish' || tag === 'chicken'));
    assert.ok(meal.side, 'expected a side pairing');
    assert.notEqual(meal.side.foodId, meal.main.foodId);
  }
});

test('generateMealPlan is deterministic per seed and varies across seeds', () => {
  const foods = [salmon, chicken, rice, broccoli, kitA, kitB];
  const options = {
    mealCount: 6,
    proteins: [] as ProteinTag[],
    dates: ['2026-01-05', '2026-01-06', '2026-01-07'],
    slot: 'meal' as const,
    seed: 1,
  };
  const a = generateMealPlan(foods, options);
  const b = generateMealPlan(foods, options);
  const c = generateMealPlan(foods, { ...options, seed: 2 });
  assert.deepEqual(
    a.meals.map((meal) => [meal.main.foodId, meal.side?.foodId]),
    b.meals.map((meal) => [meal.main.foodId, meal.side?.foodId]),
  );
  const keysA = a.meals.map((meal) => `${meal.main.foodId}|${meal.side?.foodId}`);
  const keysC = c.meals.map((meal) => `${meal.main.foodId}|${meal.side?.foodId}`);
  assert.notDeepEqual(keysA, keysC, 'different seeds should reshuffle');
});

test('protein filter restricts mains but leaves sides unfiltered', () => {
  const foods = [salmon, chicken, rice, broccoli, kitA, kitB];
  const result = generateMealPlan(foods, {
    mealCount: 3,
    proteins: ['fish'],
    dates: ['2026-01-05', '2026-01-06', '2026-01-07'],
    slot: 'meal',
    seed: 3,
  });
  assert.ok(result.proteinFilterApplied);
  for (const meal of result.meals) {
    assert.ok(meal.main.proteinTags.includes('fish'));
    // Sides are not protein-filtered: broccoli (no tags) is eligible.
  }
});

test('empty protein match yields no meals', () => {
  const result = generateMealPlan([salmon, kitA], {
    mealCount: 2,
    proteins: ['beef'],
    dates: ['2026-01-05', '2026-01-06'],
    slot: 'meal',
    seed: 1,
  });
  assert.equal(result.meals.length, 0);
});

test('duplicate child foods across kits dedupe into one candidate with unioned tags', () => {
  const shared = food('f-shared', 'Shredded chicken', { proteinTags: ['chicken'] });
  const kitX = kitRecipe('r-x', 'Kit X', 'f-shared', 'f-rice');
  const kitY = kitRecipe('r-y', 'Kit Y', 'f-shared', 'f-broccoli', ['chicken']);
  const { mains } = planCandidatesFromFoods([shared, rice, broccoli, kitX, kitY]);
  const parts = mains.filter((candidate) => candidate.foodId === 'f-shared' && candidate.sourceRecipeId);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0]!.proteinTags.sort(), ['chicken']);
});

test('whole recipes default plan servings to their batch size', () => {
  const batch = food('r-batch', 'Two-person chili', { makesServings: 2 });
  const { mains } = planCandidatesFromFoods([batch]);
  const candidate = mains.find((item) => item.foodId === 'r-batch');
  assert.equal(candidate?.servings, 2);
  const single = food('f-single', 'Yogurt cup', { kind: 'packaged', makesServings: 1 });
  const { mains: singles } = planCandidatesFromFoods([single]);
  assert.equal(singles.find((item) => item.foodId === 'f-single')?.servings, 1);
});
