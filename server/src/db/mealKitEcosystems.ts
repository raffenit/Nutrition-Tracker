import { randomUUID } from 'node:crypto';
import { kitLineKeyFromText } from '../domain/kitLineKey.js';
import type { AppDatabase } from './database.js';

export type MealKitEcosystem = {
  id: string;
  name: string;
  mappingCount: number;
};

export type KitIngredientMapping = {
  id: string;
  ecosystemId: string;
  kitLineName: string;
  nameKey: string;
  shopEquivalentFoodId: string | null;
  shopEquivalentLabel: string | null;
  nutritionFoodId: string | null;
};

export function listMealKitEcosystems(db: AppDatabase): MealKitEcosystem[] {
  const rows = db.prepare(
    `SELECT e.id, e.name,
            (SELECT COUNT(*) FROM meal_kit_ingredient_maps m WHERE m.ecosystem_id = e.id) AS mapping_count
     FROM meal_kit_ecosystems e
     ORDER BY e.name COLLATE NOCASE`,
  ).all() as Array<{ id: string; name: string; mapping_count: number }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    mappingCount: row.mapping_count,
  }));
}

export function getMealKitEcosystem(db: AppDatabase, id: string): MealKitEcosystem | null {
  const row = db.prepare(
    `SELECT e.id, e.name,
            (SELECT COUNT(*) FROM meal_kit_ingredient_maps m WHERE m.ecosystem_id = e.id) AS mapping_count
     FROM meal_kit_ecosystems e WHERE e.id = ?`,
  ).get(id) as { id: string; name: string; mapping_count: number } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, mappingCount: row.mapping_count };
}

export function findMealKitEcosystemByName(db: AppDatabase, name: string): MealKitEcosystem | null {
  const row = db.prepare('SELECT id, name FROM meal_kit_ecosystems WHERE name = ? COLLATE NOCASE').get(name.trim()) as
    | { id: string; name: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, mappingCount: 0 };
}

export function createMealKitEcosystem(db: AppDatabase, name: string): MealKitEcosystem {
  const id = randomUUID();
  const trimmed = name.trim();
  db.prepare('INSERT INTO meal_kit_ecosystems (id, name, created_at) VALUES (?, ?, ?)').run(id, trimmed, new Date().toISOString());
  return { id, name: trimmed, mappingCount: 0 };
}

export function renameMealKitEcosystem(db: AppDatabase, id: string, name: string): MealKitEcosystem | null {
  const trimmed = name.trim();
  const result = db.prepare('UPDATE meal_kit_ecosystems SET name = ? WHERE id = ?').run(trimmed, id);
  if (result.changes === 0) return null;
  return getMealKitEcosystem(db, id);
}

export function deleteMealKitEcosystem(db: AppDatabase, id: string): boolean {
  const run = db.transaction(() => {
    db.prepare('UPDATE foods SET meal_kit_ecosystem_id = NULL WHERE meal_kit_ecosystem_id = ?').run(id);
    return db.prepare('DELETE FROM meal_kit_ecosystems WHERE id = ?').run(id).changes > 0;
  });
  return run();
}

export function listKitMappings(db: AppDatabase, ecosystemId: string): KitIngredientMapping[] {
  const rows = db.prepare(
    `SELECT id, ecosystem_id, kit_line_name, name_key, shop_equivalent_food_id, shop_equivalent_label, nutrition_food_id
     FROM meal_kit_ingredient_maps WHERE ecosystem_id = ? ORDER BY kit_line_name COLLATE NOCASE`,
  ).all(ecosystemId) as Array<{
    id: string;
    ecosystem_id: string;
    kit_line_name: string;
    name_key: string;
    shop_equivalent_food_id: string | null;
    shop_equivalent_label: string | null;
    nutrition_food_id: string | null;
  }>;
  return rows.map(toMapping);
}

export function getKitMappingByKey(db: AppDatabase, ecosystemId: string, nameKey: string): KitIngredientMapping | null {
  const row = db.prepare(
    `SELECT id, ecosystem_id, kit_line_name, name_key, shop_equivalent_food_id, shop_equivalent_label, nutrition_food_id
     FROM meal_kit_ingredient_maps WHERE ecosystem_id = ? AND name_key = ?`,
  ).get(ecosystemId, nameKey) as Parameters<typeof toMapping>[0] | undefined;
  return row ? toMapping(row) : null;
}

export function upsertKitMapping(
  db: AppDatabase,
  ecosystemId: string,
  nameKey: string,
  payload: {
    kitLineName: string;
    shopEquivalentFoodId: string | null;
    shopEquivalentLabel: string | null;
    nutritionFoodId: string | null;
  },
): KitIngredientMapping {
  const existing = getKitMappingByKey(db, ecosystemId, nameKey);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE meal_kit_ingredient_maps SET
        kit_line_name = @kitLineName,
        shop_equivalent_food_id = @shopEquivalentFoodId,
        shop_equivalent_label = @shopEquivalentLabel,
        nutrition_food_id = @nutritionFoodId,
        updated_at = @updatedAt
       WHERE id = @id`,
    ).run({
      id: existing.id,
      kitLineName: payload.kitLineName,
      shopEquivalentFoodId: payload.shopEquivalentFoodId,
      shopEquivalentLabel: payload.shopEquivalentLabel,
      nutritionFoodId: payload.nutritionFoodId,
      updatedAt: now,
    });
    return { ...existing, ...payload, nameKey };
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO meal_kit_ingredient_maps (
      id, ecosystem_id, kit_line_name, name_key,
      shop_equivalent_food_id, shop_equivalent_label, nutrition_food_id, created_at, updated_at
    ) VALUES (
      @id, @ecosystemId, @kitLineName, @nameKey,
      @shopEquivalentFoodId, @shopEquivalentLabel, @nutritionFoodId, @createdAt, @updatedAt
    )`,
  ).run({
    id,
    ecosystemId,
    kitLineName: payload.kitLineName,
    nameKey,
    shopEquivalentFoodId: payload.shopEquivalentFoodId,
    shopEquivalentLabel: payload.shopEquivalentLabel,
    nutritionFoodId: payload.nutritionFoodId,
    createdAt: now,
    updatedAt: now,
  });
  return {
    id,
    ecosystemId,
    nameKey,
    kitLineName: payload.kitLineName,
    shopEquivalentFoodId: payload.shopEquivalentFoodId,
    shopEquivalentLabel: payload.shopEquivalentLabel,
    nutritionFoodId: payload.nutritionFoodId,
  };
}

export function saveKitMappingRow(
  db: AppDatabase,
  ecosystemId: string,
  mapping: {
    id?: string;
    kitLineName: string;
    shopEquivalentFoodId: string | null;
    shopEquivalentLabel: string | null;
    nutritionFoodId: string | null;
  },
): KitIngredientMapping {
  const kitLineName = mapping.kitLineName.trim();
  const nameKey = kitLineKeyForDb(kitLineName);
  if (mapping.id) {
    const result = db.prepare(
      `UPDATE meal_kit_ingredient_maps SET
        kit_line_name = ?, name_key = ?,
        shop_equivalent_food_id = ?, shop_equivalent_label = ?, nutrition_food_id = ?,
        updated_at = ?
       WHERE id = ? AND ecosystem_id = ?`,
    ).run(
      kitLineName,
      nameKey,
      mapping.shopEquivalentFoodId,
      mapping.shopEquivalentLabel,
      mapping.nutritionFoodId,
      new Date().toISOString(),
      mapping.id,
      ecosystemId,
    );
    if (result.changes > 0) {
      const row = db.prepare('SELECT * FROM meal_kit_ingredient_maps WHERE id = ?').get(mapping.id) as Parameters<typeof toMapping>[0];
      return toMapping(row);
    }
  }
  return upsertKitMapping(db, ecosystemId, nameKey, {
    kitLineName,
    shopEquivalentFoodId: mapping.shopEquivalentFoodId,
    shopEquivalentLabel: mapping.shopEquivalentLabel,
    nutritionFoodId: mapping.nutritionFoodId,
  });
}

export function deleteKitMapping(db: AppDatabase, ecosystemId: string, mappingId: string): boolean {
  return db.prepare('DELETE FROM meal_kit_ingredient_maps WHERE id = ? AND ecosystem_id = ?').run(mappingId, ecosystemId).changes > 0;
}

export function syncKitMappingsFromIngredients(
  db: AppDatabase,
  ecosystemId: string,
  lines: Array<{
    name: string;
    childFoodId: string | null;
    shopEquivalentFoodId: string | null;
    shopEquivalentLabel: string | null;
  }>,
): void {
  const save = db.transaction(() => {
    for (const line of lines) {
      const nameKey = kitLineKeyFromText(line.name);
      if (!nameKey) continue;
      const hasShop = Boolean(line.shopEquivalentFoodId || (line.shopEquivalentLabel && line.shopEquivalentLabel.trim()));
      if (!hasShop && !line.childFoodId) continue;
      const existing = getKitMappingByKey(db, ecosystemId, nameKey);
      upsertKitMapping(db, ecosystemId, nameKey, {
        kitLineName: existing?.kitLineName ?? line.name.trim(),
        shopEquivalentFoodId: line.shopEquivalentFoodId,
        shopEquivalentLabel: line.shopEquivalentLabel,
        nutritionFoodId: line.childFoodId ?? existing?.nutritionFoodId ?? null,
      });
    }
  });
  save();
}

function kitLineKeyForDb(kitLineName: string): string {
  return kitLineKeyFromText(kitLineName);
}

function toMapping(row: {
  id: string;
  ecosystem_id: string;
  kit_line_name: string;
  name_key: string;
  shop_equivalent_food_id: string | null;
  shop_equivalent_label: string | null;
  nutrition_food_id: string | null;
}): KitIngredientMapping {
  return {
    id: row.id,
    ecosystemId: row.ecosystem_id,
    kitLineName: row.kit_line_name,
    nameKey: row.name_key,
    shopEquivalentFoodId: row.shop_equivalent_food_id,
    shopEquivalentLabel: row.shop_equivalent_label,
    nutritionFoodId: row.nutrition_food_id,
  };
}
