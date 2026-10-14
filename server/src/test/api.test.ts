import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TARGETS } from '../domain/nutrients.js';
import { api, withTestServer } from './helpers.js';

async function householdToday(port: number, cookie: string): Promise<string> {
  const dashboard = await api<{ today: string }>(port, '/api/dashboard', { cookie });
  return dashboard.body.today;
}

test('health, setup, dashboard, family privacy, and trends', async () => {
  await withTestServer(async ({ port }) => {
    const health = await api<{ ok: boolean; setupRequired: boolean }>(port, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.setupRequired, true);

    const setup = await api<{ user: { name: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Rachael', password: 'password1', householdName: 'Home' },
    });
    assert.equal(setup.status, 200);
    assert.equal(setup.body.user.name, 'Rachael');

    const ready = await api<{ setupRequired: boolean }>(port, '/api/health', { cookie: setup.cookie });
    assert.equal(ready.body.setupRequired, false);

    await api(port, '/api/targets', {
      method: 'PUT',
      cookie: setup.cookie,
      body: { ...DEFAULT_TARGETS, units: 'imperial', protein: 120 },
    });

    const food = await api<{ food: { id: string } }>(port, '/api/foods', {
      method: 'POST',
      cookie: setup.cookie,
      body: {
        name: 'Greek yogurt',
        brand: null,
        kind: 'packaged',
        servingLabel: '1 cup',
        nutrients: { calories: 150, protein: 15, fiber: 0, fat: 4, carbs: 12, sodium: 80, extras: [] },
        isFavorite: false,
        isDrink: false,
        drinkMl: null,
        source: 'manual',
      },
    });
    assert.equal(food.status, 201);

    const day = await householdToday(port, setup.cookie);
    const eatenAt = `${day}T12:00`;
    const log = await api(port, '/api/logs', {
      method: 'POST',
      cookie: setup.cookie,
      body: { foodId: food.body.food.id, slot: 'meal', servings: 1, eatenAt, drinkMl: null },
    });
    assert.equal(log.status, 201);

    const dashboard = await api<{
      totals: { calories: number; protein: number };
      targets: { units: string; protein: number };
      trends: { points: Array<{ calories: number }> };
    }>(port, `/api/dashboard?days=7&date=${day}`, { cookie: setup.cookie });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.totals.calories, 150);
    assert.equal(dashboard.body.totals.protein, 15);
    assert.equal(dashboard.body.targets.units, 'imperial');
    assert.equal(dashboard.body.targets.protein, 120);
    assert.equal(dashboard.body.trends.points.length, 7);
    assert.equal(dashboard.body.trends.points.at(-1)?.calories, 150);

    const family = await api<{ members: Array<{ user: { name: string } }> }>(port, '/api/family', { cookie: setup.cookie });
    assert.equal(family.status, 200);
    assert.equal(family.body.members[0]?.user.name, 'Rachael');
    assert.equal(JSON.stringify(family.body).toLowerCase().includes('weight'), false);
  });
});

test('ad-hoc log updates dashboard without library food', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { name: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Sam', password: 'password1', householdName: 'Home' },
    });
    await api(port, '/api/targets', {
      method: 'PUT',
      cookie: setup.cookie,
      body: { ...DEFAULT_TARGETS, calories: 2000 },
    });
    const day = await householdToday(port, setup.cookie);
    const eatenAt = `${day}T18:00`;
    const log = await api(port, '/api/logs', {
      method: 'POST',
      cookie: setup.cookie,
      body: {
        adHoc: true,
        name: 'Office pizza slice',
        slot: 'meal',
        servings: 2,
        eatenAt,
        nutrients: { calories: 250, protein: 10, fiber: 1, fat: 12, carbs: 28, sodium: 400, extras: [] },
      },
    });
    assert.equal(log.status, 201);
    const dashboard = await api<{ totals: { calories: number }; logs: Array<{ name: string }> }>(
      port,
      `/api/dashboard?date=${day}`,
      { cookie: setup.cookie },
    );
    assert.equal(dashboard.body.totals.calories, 500);
    assert.equal(dashboard.body.logs.some((row) => row.name === 'Office pizza slice'), true);
    const library = await api<{ foods: Array<{ name: string }> }>(port, '/api/foods', { cookie: setup.cookie });
    assert.equal(library.body.foods.some((row) => row.name === 'Office pizza slice'), false);
  });
});

test('meal log clientMutationId is idempotent', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { name: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Sam', password: 'password1', householdName: 'Home' },
    });
    await api(port, '/api/targets', {
      method: 'PUT',
      cookie: setup.cookie,
      body: { ...DEFAULT_TARGETS, calories: 2000 },
    });
    const day = await householdToday(port, setup.cookie);
    const mutationId = '11111111-1111-4111-8111-111111111111';
    const payload = {
      adHoc: true,
      clientMutationId: mutationId,
      name: 'Trail mix',
      slot: 'snack',
      servings: 1,
      eatenAt: `${day}T15:00`,
      nutrients: { calories: 200, protein: 5, fiber: 3, fat: 10, carbs: 22, sodium: 50, extras: [] },
    };
    const first = await api<{ id: string }>(port, '/api/logs', { method: 'POST', cookie: setup.cookie, body: payload });
    const second = await api<{ id: string }>(port, '/api/logs', { method: 'POST', cookie: setup.cookie, body: payload });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.body.id, second.body.id);
    const dashboard = await api<{ totals: { calories: number } }>(
      port,
      `/api/dashboard?date=${day}`,
      { cookie: setup.cookie },
    );
    assert.equal(dashboard.body.totals.calories, 200);
  });
});

test('dashboard goal alerts and dismissals', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { name: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Sam', password: 'password1', householdName: 'Home' },
    });
    await api(port, '/api/targets', {
      method: 'PUT',
      cookie: setup.cookie,
      body: { ...DEFAULT_TARGETS, calories: 2000 },
    });
    const day = await householdToday(port, setup.cookie);
    const eatenAt = `${day}T12:00`;
    await api(port, '/api/logs', {
      method: 'POST',
      cookie: setup.cookie,
      body: {
        adHoc: true,
        name: 'Big lunch',
        slot: 'meal',
        servings: 1,
        eatenAt,
        entryTotals: true,
        nutrients: { calories: 1900, protein: 50, fiber: 5, fat: 40, carbs: 100, sodium: 1000, extras: [] },
      },
    });
    const dashboard = await api<{ alerts: Array<{ id: string }> }>(port, `/api/dashboard?date=${day}`, { cookie: setup.cookie });
    assert.ok(dashboard.body.alerts.some((alert) => alert.id === 'calories-soft'));
    await api(port, '/api/alerts/dismiss', {
      method: 'POST',
      cookie: setup.cookie,
      body: { alertKey: 'calories-soft', localDate: day },
    });
    const after = await api<{ alerts: Array<{ id: string }> }>(port, `/api/dashboard?date=${day}`, { cookie: setup.cookie });
    assert.equal(after.body.alerts.some((alert) => alert.id === 'calories-soft'), false);
  });
});

test('weight history range and single entry delete', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { id: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Alex', password: 'password1', householdName: 'Home' },
    });
    await api(port, '/api/weight/preference', {
      method: 'PUT',
      cookie: setup.cookie,
      body: { enabled: true, weekday: 1, unit: 'lb' },
    });
    await api(port, '/api/weight', {
      method: 'POST',
      cookie: setup.cookie,
      body: { weight: 180, unit: 'lb', localDate: '2026-09-01' },
    });
    await api(port, '/api/weight', {
      method: 'POST',
      cookie: setup.cookie,
      body: { weight: 178, unit: 'lb', localDate: '2026-09-29' },
    });
    const history = await api<{ weight: { entries: Array<{ id: string; localDate: string }> } }>(
      port,
      '/api/weight?historyDays=90',
      { cookie: setup.cookie },
    );
    assert.equal(history.body.weight.entries.length, 2);
    const removeId = history.body.weight.entries[0]?.id;
    assert.ok(removeId);
    await api(port, `/api/weight/${removeId}?historyDays=90`, { method: 'DELETE', cookie: setup.cookie });
    const after = await api<{ weight: { entries: unknown[] } }>(port, '/api/weight?historyDays=90', { cookie: setup.cookie });
    assert.equal(after.body.weight.entries.length, 1);
  });
});

test('custom recipes return ingredient lines for editing', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { name: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Rachael', password: 'password1', householdName: 'Home' },
    });
    assert.equal(setup.status, 200);

    const yogurt = await api<{ food: { id: string } }>(port, '/api/foods', {
      method: 'POST',
      cookie: setup.cookie,
      body: {
        name: 'Greek yogurt',
        brand: null,
        kind: 'packaged',
        servingLabel: '1 cup',
        nutrients: { calories: 150, protein: 15, fiber: 0, fat: 4, carbs: 12, sodium: 80, extras: [] },
        isFavorite: false,
        isDrink: false,
        drinkMl: null,
        source: 'manual',
      },
    });
    assert.equal(yogurt.status, 201);

    const recipe = await api<{ food: { id: string } }>(port, '/api/foods/compose', {
      method: 'POST',
      cookie: setup.cookie,
      body: {
        name: 'Yogurt bowl',
        makesServings: 2,
        ingredients: [{ foodId: yogurt.body.food.id, servings: 1 }],
      },
    });
    assert.equal(recipe.status, 201);

    const loaded = await api<{
      food: { name: string; makesServings: number; ingredients: Array<{ name: string; servings: number; childFoodId: string | null }> };
    }>(port, `/api/foods/${recipe.body.food.id}`, { cookie: setup.cookie });
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.food.name, 'Yogurt bowl');
    assert.equal(loaded.body.food.makesServings, 2);
    assert.equal(loaded.body.food.ingredients.length, 1);
    assert.equal(loaded.body.food.ingredients[0]?.name, 'Greek yogurt');
    assert.equal(loaded.body.food.ingredients[0]?.childFoodId, yogurt.body.food.id);
  });
});

test('weight stays off the family board when check-ins are enabled', async () => {
  await withTestServer(async ({ port }) => {
    const setup = await api<{ user: { id: string } }>(port, '/api/setup', {
      method: 'POST',
      body: { name: 'Alex', password: 'password1', householdName: 'Home' },
    });
    await api(port, '/api/weight/preference', {
      method: 'PUT',
      cookie: setup.cookie,
      body: { enabled: true, weekday: 1, unit: 'lb' },
    });
    await api(port, '/api/weight', {
      method: 'POST',
      cookie: setup.cookie,
      body: { weight: 180, unit: 'lb', localDate: '2026-09-29' },
    });
    const family = await api<Record<string, unknown>>(port, '/api/family', { cookie: setup.cookie });
    assert.equal(JSON.stringify(family.body).toLowerCase().includes('weight'), false);
    const personal = await api<{ weight: { enabled: boolean; entries: unknown[] } }>(port, '/api/weight', { cookie: setup.cookie });
    assert.equal(personal.body.weight.enabled, true);
    assert.equal(personal.body.weight.entries.length, 1);
  });
});
