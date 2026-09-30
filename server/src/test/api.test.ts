import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TARGETS } from '../domain/nutrients.js';
import { api, withTestServer } from './helpers.js';

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

    const eatenAt = '2026-09-29T12:00';
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
    }>(port, '/api/dashboard?days=7', { cookie: setup.cookie });
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
