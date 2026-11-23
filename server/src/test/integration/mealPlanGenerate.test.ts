import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TARGETS } from '../../domain/nutrients.js';
import { api, withTestServer } from '../helpers.js';

/**
 * End-to-end: recipe composition (the path recipe-card PDF/image imports land
 * in via /api/foods/compose) → protein/component tagging → meal-plan shuffle
 * generation → plan persistence → grocery list aggregation.
 */

async function createFood(
  port: number,
  cookie: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  const result = await api<{ food: { id: string } }>(port, '/api/foods', {
    method: 'POST',
    cookie,
    body: {
      brand: null,
      kind: 'ingredient',
      servingLabel: '1 serving',
      nutrients: { calories: 100, protein: 10, fiber: 1, fat: 5, carbs: 2, sodium: 50, extras: [] },
      isFavorite: false,
      isDrink: false,
      drinkMl: null,
      source: 'manual',
      ...body,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.food;
}

test('compose recipe with component roles → generate plan → grocery list', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { name: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Casey', password: 'password1', householdName: 'Home' },
    });
    const cookie = setup.cookie;
    await api(port, '/api/targets', { method: 'PUT', cookie, body: { ...DEFAULT_TARGETS } });

    // Component foods (what a meal-kit PDF import resolves kit lines to).
    const salmon = await createFood(port, cookie, { name: 'Salmon fillet', proteinTags: ['fish'] });
    const rice = await createFood(port, cookie, { name: 'Jasmine rice' });
    const chicken = await createFood(port, cookie, { name: 'Chicken breast', proteinTags: ['chicken'] });
    const broccoli = await createFood(port, cookie, { name: 'Broccoli' });

    // Two kit-style recipes whose ingredient lines carry main/side roles —
    // the same shape applyRecipeImport produces after a recipe-card import.
    const compose = (name: string, mainId: string, sideId: string, tags: string[]) =>
      api<{ food: { id: string; ingredients: Array<{ componentRole: string | null; childFoodId: string | null }> } }>(
        port,
        '/api/foods/compose',
        {
          method: 'POST',
          cookie,
          body: {
            name,
            brand: 'TestKit',
            kind: 'custom',
            makesServings: 2,
            servingLabel: '1 serving',
            nutrients: { calories: 400, protein: 30, fiber: 4, fat: 14, carbs: 30, sodium: 500, extras: [] },
            instructions: null,
            isFavorite: false,
            isDrink: false,
            drinkMl: null,
            proteinTags: tags,
            source: 'composed',
            ingredients: [
              { name: 'protein', servings: 1, foodId: mainId, componentRole: 'main' },
              { name: 'veg', servings: 1, foodId: sideId, componentRole: 'side' },
            ],
          },
        },
      );
    const kitA = await compose('Salmon kit', salmon.id, rice.id, ['fish']);
    const kitB = await compose('Chicken kit', chicken.id, broccoli.id, ['chicken']);
    assert.equal(kitA.status, 201, JSON.stringify(kitA.body));
    assert.equal(kitB.status, 201, JSON.stringify(kitB.body));
    assert.equal(kitA.body.food.ingredients.find((line) => line.componentRole === 'main')?.childFoodId, salmon.id);

    // Generation options report the candidate pool.
    const options = await api<{ proteinTags: string[]; candidates: { mains: number; sides: number } }>(
      port,
      '/api/meal-plan/generate/options',
      { cookie },
    );
    assert.equal(options.status, 200);
    assert.ok(options.body.candidates.mains >= 4);
    assert.ok(options.body.candidates.sides >= 2);

    // Generate a protein-filtered plan for the current week.
    const plan = await api<{ meals: Array<{ localDate: string; slot: string; main: { foodId: string; proteinTags: string[] }; side: { foodId: string } | null }> }>(
      port,
      '/api/meal-plan/generate',
      {
        method: 'POST',
        cookie,
        body: { mealCount: 4, proteins: ['fish', 'chicken'], slot: 'meal', week: '2026-01-05' },
      },
    );
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.equal(plan.body.meals.length, 4);
    for (const meal of plan.body.meals) {
      assert.ok(meal.main.proteinTags.some((tag) => tag === 'fish' || tag === 'chicken'));
      assert.ok(meal.side, 'kit mains should pair with a side');
    }

    // Persist generated meals as plan entries — main and side share slot+date.
    const entries = plan.body.meals.flatMap((meal) => [
      { localDate: meal.localDate, slot: meal.slot, foodId: meal.main.foodId, servings: 1 },
      ...(meal.side ? [{ localDate: meal.localDate, slot: meal.slot, foodId: meal.side.foodId, servings: 1 }] : []),
    ]);
    const saved = await api<{ entries: unknown[] }>(port, '/api/meal-plan', {
      method: 'PUT',
      cookie,
      body: { weekStart: '2026-01-05', entries },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.entries.length, entries.length);

    // Grocery list aggregates the planned component foods.
    const grocery = await api<{ lineItems: Array<{ name: string; quantity: number }> }>(
      port,
      '/api/meal-plan/grocery?week=2026-01-05',
      { cookie },
    );
    assert.equal(grocery.status, 200);
    const names = grocery.body.lineItems.map((item) => item.name);
    for (const expected of ['Salmon fillet', 'Chicken breast', 'Jasmine rice', 'Broccoli']) {
      assert.ok(names.includes(expected), `grocery list missing ${expected}: ${names.join(', ')}`);
    }
  });
});
