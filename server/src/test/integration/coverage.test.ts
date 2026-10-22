import assert from 'node:assert/strict';
import test from 'node:test';
import { weekStartMonday } from '../../domain/time.js';
import { api, setupTestHousehold, withTestServer } from '../helpers.js';

test('composed recipe stores per-serving nutrients and logging doubles dashboard totals', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie, day } = await setupTestHousehold(port);
    const yogurt = await api<{ food: { id: string } }>(port, '/api/foods', {
      method: 'POST',
      cookie,
      body: {
        name: 'Greek yogurt',
        brand: null,
        kind: 'packaged',
        servingLabel: '1 cup',
        nutrients: { calories: 200, protein: 20, fiber: 0, fat: 0, carbs: 12, sodium: 80, extras: [] },
        isFavorite: false,
        isDrink: false,
        drinkMl: null,
        source: 'manual',
      },
    });
    assert.equal(yogurt.status, 201);

    const recipe = await api<{ food: { id: string; nutrients: { calories: number } } }>(port, '/api/foods/compose', {
      method: 'POST',
      cookie,
      body: {
        name: 'Yogurt bowl',
        makesServings: 4,
        ingredients: [{ foodId: yogurt.body.food.id, servings: 1 }],
      },
    });
    assert.equal(recipe.status, 201);
    assert.equal(recipe.body.food.nutrients.calories, 50);

    const eatenAt = `${day}T12:00`;
    const log = await api(port, '/api/logs', {
      method: 'POST',
      cookie,
      body: { foodId: recipe.body.food.id, slot: 'meal', servings: 2, eatenAt, drinkMl: null },
    });
    assert.equal(log.status, 201);

    const dashboard = await api<{ totals: { calories: number } }>(port, `/api/dashboard?date=${day}`, { cookie });
    assert.equal(dashboard.body.totals.calories, 100);
  });
});

test('hydration add and remove by id updates dashboard', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie, day } = await setupTestHousehold(port);
    const add = await api<{ id: string }>(port, '/api/hydration', {
      method: 'POST',
      cookie,
      body: { amountMl: 250, loggedAt: `${day}T10:00` },
    });
    assert.equal(add.status, 201);
    const withWater = await api<{ totals: { hydrationMl: number }; hydration: unknown[] }>(
      port,
      `/api/dashboard?date=${day}`,
      { cookie },
    );
    assert.equal(withWater.body.totals.hydrationMl, 250);
    assert.equal(withWater.body.hydration.length, 1);

    const removed = await api(port, `/api/hydration/${add.body.id}`, { method: 'DELETE', cookie });
    assert.equal(removed.status, 200);
    const after = await api<{ totals: { hydrationMl: number } }>(port, `/api/dashboard?date=${day}`, { cookie });
    assert.equal(after.body.totals.hydrationMl, 0);
  });
});

test('DELETE /api/logs/:id removes meal from dashboard totals', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie, day } = await setupTestHousehold(port);
    const log = await api<{ id: string }>(port, '/api/logs', {
      method: 'POST',
      cookie,
      body: {
        adHoc: true,
        name: 'Snack',
        slot: 'snack',
        servings: 1,
        eatenAt: `${day}T14:00`,
        nutrients: { calories: 300, protein: 5, fiber: 0, fat: 10, carbs: 30, sodium: 100, extras: [] },
      },
    });
    assert.equal(log.status, 201);
    const before = await api<{ totals: { calories: number } }>(port, `/api/dashboard?date=${day}`, { cookie });
    assert.equal(before.body.totals.calories, 300);

    const del = await api(port, `/api/logs/${log.body.id}`, { method: 'DELETE', cookie });
    assert.equal(del.status, 200);
    const after = await api<{ totals: { calories: number } }>(port, `/api/dashboard?date=${day}`, { cookie });
    assert.equal(after.body.totals.calories, 0);
  });
});

test('login after logout restores session', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie } = await setupTestHousehold(port, 'Rachael');
    const logout = await api(port, '/api/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 200);
    const denied = await api(port, '/api/dashboard', { cookie });
    assert.equal(denied.status, 401);

    const login = await api(port, '/api/auth/login', {
      method: 'POST',
      body: { name: 'Rachael', password: 'password1' },
    });
    assert.equal(login.status, 200);
    const dashboard = await api(port, '/api/dashboard', { cookie: login.cookie });
    assert.equal(dashboard.status, 200);
  });
});

test('admin can add a household member visible on family board', async () => {
  await withTestServer(async ({ port }) => {
    const admin = await setupTestHousehold(port, 'Admin');
    const member = await api<{ user: { name: string } }>(port, '/api/users', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Partner', password: 'password2', role: 'member' },
    });
    assert.equal(member.status, 201);

    const family = await api<{ members: Array<{ user: { name: string } }> }>(port, '/api/family', {
      cookie: admin.cookie,
    });
    assert.equal(family.status, 200);
    const names = family.body.members.map((row) => row.user.name).sort();
    assert.deepEqual(names, ['Admin', 'Partner']);
  });
});

test('meal plan save, grocery list, and log-from-entry', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie, day } = await setupTestHousehold(port);
    const weekStart = weekStartMonday(day);
    const food = await api<{ food: { id: string; name: string } }>(port, '/api/foods', {
      method: 'POST',
      cookie,
      body: {
        name: 'Planned oats',
        brand: null,
        kind: 'packaged',
        servingLabel: '1 bowl',
        nutrients: { calories: 180, protein: 6, fiber: 4, fat: 3, carbs: 32, sodium: 120, extras: [] },
        isFavorite: false,
        isDrink: false,
        drinkMl: null,
        source: 'manual',
      },
    });
    assert.equal(food.status, 201);

    const saved = await api<{ entries: Array<{ id: string }> }>(port, '/api/meal-plan', {
      method: 'PUT',
      cookie,
      body: {
        weekStart,
        entries: [{ localDate: day, slot: 'meal', foodId: food.body.food.id, servings: 1 }],
      },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.entries.length, 1);
    const entryId = saved.body.entries[0]?.id;
    assert.ok(entryId);

    const grocery = await api<{ lineItems: unknown[]; markdown: string }>(
      port,
      `/api/meal-plan/grocery?week=${weekStart}`,
      { cookie },
    );
    assert.equal(grocery.status, 200);
    assert.ok(grocery.body.lineItems.length >= 1);
    assert.match(grocery.body.markdown, /Planned oats/i);

    const logged = await api(port, `/api/meal-plan/entries/${entryId}/log`, {
      method: 'POST',
      cookie,
      body: { eatenAt: `${day}T08:00` },
    });
    assert.equal(logged.status, 201);
    const dashboard = await api<{ totals: { calories: number } }>(port, `/api/dashboard?date=${day}`, { cookie });
    assert.equal(dashboard.body.totals.calories, 180);
  });
});

test('GET /api/push/status when VAPID is not configured', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie } = await setupTestHousehold(port);
    const status = await api<{ configured: boolean; enabled: boolean; subscribed: boolean }>(
      port,
      '/api/push/status',
      { cookie },
    );
    assert.equal(status.status, 200);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.enabled, false);
    assert.equal(status.body.subscribed, false);
  });
});

test('POST /api/import-url blocks loopback URLs', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie } = await setupTestHousehold(port);
    const res = await api<{ error?: string }>(port, '/api/import-url', {
      method: 'POST',
      cookie,
      body: { url: 'http://127.0.0.1/menu.html' },
    });
    assert.equal(res.status, 400);
  });
});

test('GET /api/ingredients/search returns library hits without USDA key', async () => {
  await withTestServer(async ({ port }) => {
    const { cookie } = await setupTestHousehold(port);
    await api(port, '/api/foods', {
      method: 'POST',
      cookie,
      body: {
        name: 'UniqueTestHoney',
        brand: null,
        kind: 'packaged',
        servingLabel: '1 tbsp',
        nutrients: { calories: 60, protein: 0, fiber: 0, fat: 0, carbs: 17, sodium: 0, extras: [] },
        isFavorite: false,
        isDrink: false,
        drinkMl: null,
        source: 'manual',
      },
    });
    const search = await api<{ results: Array<{ name: string }>; usda: string }>(
      port,
      '/api/ingredients/search?q=UniqueTestHoney',
      { cookie },
    );
    assert.equal(search.status, 200);
    assert.equal(search.body.usda, 'missing_key');
    assert.ok(search.body.results.some((hit) => hit.name === 'UniqueTestHoney'));
  });
});
