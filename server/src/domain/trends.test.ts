import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { insertUser, saveHousehold, saveTargets } from '../db/users.js';
import { hashPassword } from '../auth/passwords.js';
import { DEFAULT_TARGETS } from './nutrients.js';
import { buildTrendSeries } from './trends.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { insertMeal } from '../db/logs.js';
import { insertFood } from '../db/foods.js';
import { emptyNutrients } from './nutrients.js';

test('buildTrendSeries fills missing days with zero and ends on the anchor date', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nutrition-trend-'));
  const db = openDatabase(path.join(dataDir, 'test.sqlite'));
  try {
    saveHousehold(db, 'Home', 'America/Chicago');
    const user = insertUser(db, 'Tester', hashPassword('password1'), 'admin');
    saveTargets(db, user.id, DEFAULT_TARGETS);
    const food = insertFood(db, {
      createdBy: user.id,
      name: 'Snack',
      brand: null,
      kind: 'packaged',
      servingLabel: '1 serving',
      nutrients: { ...emptyNutrients(), calories: 200, protein: 10 },
      isFavorite: false,
      isDrink: false,
      drinkMl: null,
      makesServings: 1,
      source: 'manual',
      sourceRef: null,
      ingredients: [],
    });
    insertMeal(db, {
      userId: user.id,
      foodId: food.id,
      name: 'Snack',
      slot: 'snack',
      eatenAt: '2026-09-29T18:00:00.000Z',
      localDate: '2026-09-29',
      servings: 1,
      nutrients: { ...emptyNutrients(), calories: 200, protein: 10 },
      drinkMl: null,
    });
    const series = buildTrendSeries(db, user.id, '2026-09-29', 7);
    assert.equal(series.points.length, 7);
    assert.equal(series.points.at(-1)?.date, '2026-09-29');
    assert.equal(series.points.at(-1)?.calories, 200);
    assert.equal(series.points[0]?.calories, 0);
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
