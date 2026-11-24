import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../../../db/database.js';
import {
  createMealKitEcosystem,
  getKitMappingByKey,
  listKitMappings,
  saveKitMappingRow,
  syncKitMappingsFromIngredients,
} from '../../../db/mealKitEcosystems.js';

function withDb(run: (db: ReturnType<typeof openDatabase>) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nt-kit-'));
  const db = openDatabase(path.join(dir, 'nutrition.sqlite'));
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('syncKitMappingsFromIngredients creates name-only rows for text ingredients', () => {
  withDb((db) => {
    const eco = createMealKitEcosystem(db, 'Green Chef');
    syncKitMappingsFromIngredients(db, eco.id, [
      { name: '1/2 cup broccoli', childFoodId: null, shopEquivalentFoodId: null, shopEquivalentLabel: null },
      { name: '2 eggs', childFoodId: null, shopEquivalentFoodId: null, shopEquivalentLabel: null },
    ]);
    const mappings = listKitMappings(db, eco.id);
    assert.equal(mappings.length, 2);
    const broccoli = mappings.find((m) => m.nameKey === 'broccoli');
    assert.ok(broccoli);
    assert.equal(broccoli.kitLineName, 'broccoli');
    assert.equal(broccoli.shopEquivalentFoodId, null);
    assert.equal(broccoli.nutritionFoodId, null);
  });
});

test('renaming a canonical name keeps the match key stable', () => {
  withDb((db) => {
    const eco = createMealKitEcosystem(db, 'Green Chef');
    const created = saveKitMappingRow(db, eco.id, {
      kitLineName: 'broccoli',
      shopEquivalentFoodId: null,
      shopEquivalentLabel: null,
      nutritionFoodId: null,
    });
    assert.equal(created.nameKey, 'broccoli');
    const renamed = saveKitMappingRow(db, eco.id, {
      id: created.id,
      kitLineName: 'Broccoli florets',
      shopEquivalentFoodId: null,
      shopEquivalentLabel: null,
      nutritionFoodId: null,
    });
    assert.equal(renamed.kitLineName, 'Broccoli florets');
    assert.equal(renamed.nameKey, 'broccoli');
    // Recipe lines saying "broccoli" still resolve the mapping.
    assert.ok(getKitMappingByKey(db, eco.id, 'broccoli'));
    assert.equal(getKitMappingByKey(db, eco.id, 'broccoli florets'), null);
  });
});

test('saveKitMappingRow strips quantity prefixes from canonical names', () => {
  withDb((db) => {
    const eco = createMealKitEcosystem(db, 'Green Chef');
    const mapping = saveKitMappingRow(db, eco.id, {
      kitLineName: '2 cups rice',
      shopEquivalentFoodId: null,
      shopEquivalentLabel: null,
      nutritionFoodId: null,
    });
    assert.equal(mapping.kitLineName, 'rice');
    assert.equal(mapping.nameKey, 'rice');
  });
});

test('sync preserves existing sheet links when a text-only line matches', () => {
  withDb((db) => {
    db.prepare(
      `INSERT INTO foods (id, name, kind, serving_label, calories, protein, fiber, fat, carbs, sodium, extras_json, source, created_at)
       VALUES ('food-1', 'Broccoli', 'packaged', '1 cup', 0, 0, 0, 0, 0, 0, '[]', 'manual', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const eco = createMealKitEcosystem(db, 'Green Chef');
    saveKitMappingRow(db, eco.id, {
      kitLineName: 'broccoli',
      shopEquivalentFoodId: null,
      shopEquivalentLabel: 'frozen broccoli',
      nutritionFoodId: 'food-1',
    });
    // A later recipe line with the same name but no links must not erase them.
    syncKitMappingsFromIngredients(db, eco.id, [
      { name: '1 cup broccoli', childFoodId: null, shopEquivalentFoodId: null, shopEquivalentLabel: null },
    ]);
    const mapping = getKitMappingByKey(db, eco.id, 'broccoli');
    assert.ok(mapping);
    assert.equal(mapping.shopEquivalentLabel, 'frozen broccoli');
    assert.equal(mapping.nutritionFoodId, 'food-1');
  });
});
