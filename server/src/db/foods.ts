import { randomUUID } from 'node:crypto';
import type { Food, FoodKind, FoodSource, IngredientLine, Nutrients } from '../types.js';
import { parseStoredExtras } from '../domain/nutrients.js';
import type { AppDatabase } from './database.js';

export type NewFood = {
  createdBy: string;
  name: string;
  brand: string | null;
  kind: FoodKind;
  servingLabel: string;
  nutrients: Nutrients;
  isFavorite: boolean;
  isDrink: boolean;
  drinkMl: number | null;
  makesServings: number;
  source: FoodSource;
  sourceRef: string | null;
  ingredients: IngredientLine[];
};

type FoodSql = {
  id: string;
  name: string;
  brand: string | null;
  kind: FoodKind;
  serving_label: string;
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number;
  extras_json: string;
  is_favorite: number;
  is_drink: number;
  drink_ml: number | null;
  makes_servings: number;
  source: FoodSource;
  source_ref: string | null;
};

export function insertFood(db: AppDatabase, food: NewFood): Food {
  const id = randomUUID();
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO foods (
        id, created_by, name, brand, kind, serving_label, calories, protein, fiber, fat, carbs, sodium,
        extras_json, is_favorite, is_drink, drink_ml, makes_servings, source, source_ref, created_at
      ) VALUES (
        @id, @createdBy, @name, @brand, @kind, @servingLabel, @calories, @protein, @fiber, @fat, @carbs, @sodium,
        @extras, @isFavorite, @isDrink, @drinkMl, @makesServings, @source, @sourceRef, @createdAt
      )`,
    ).run({ id, ...foodParams(food), createdAt: new Date().toISOString() });
    replaceIngredients(db, id, food.ingredients);
  });
  save();
  return mustFood(db, id);
}

export function updateFood(db: AppDatabase, id: string, food: NewFood): Food | null {
  if (!getFood(db, id)) return null;
  const save = db.transaction(() => {
    db.prepare(
      `UPDATE foods SET
        name = @name, brand = @brand, kind = @kind, serving_label = @servingLabel,
        calories = @calories, protein = @protein, fiber = @fiber, fat = @fat, carbs = @carbs, sodium = @sodium,
        extras_json = @extras, is_favorite = @isFavorite, is_drink = @isDrink, drink_ml = @drinkMl,
        makes_servings = @makesServings, source = @source, source_ref = @sourceRef
       WHERE id = @id`,
    ).run({ id, ...foodParams(food) });
    replaceIngredients(db, id, food.ingredients);
  });
  save();
  return getFood(db, id);
}

export function setFavorite(db: AppDatabase, id: string, isFavorite: boolean): Food | null {
  const result = db.prepare('UPDATE foods SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, id);
  if (result.changes === 0) return null;
  return getFood(db, id);
}

export function deleteFood(db: AppDatabase, id: string): boolean {
  return db.prepare('DELETE FROM foods WHERE id = ?').run(id).changes > 0;
}

export function getFood(db: AppDatabase, id: string): Food | null {
  const row = db.prepare(`${FOOD_COLUMNS} FROM foods WHERE id = ?`).get(id) as FoodSql | undefined;
  return row ? toFood(row, ingredientsFor(db, id)) : null;
}

export type FoodShelf = 'all' | 'foods' | 'recipes';

export function listFoods(db: AppDatabase, query: string, shelf: FoodShelf = 'all'): Food[] {
  const shelfSql = shelf === 'foods'
    ? " AND kind != 'custom'"
    : shelf === 'recipes'
      ? " AND kind = 'custom'"
      : '';
  const rows = query
    ? db.prepare(
        `${FOOD_COLUMNS} FROM foods
         WHERE (name LIKE ? ESCAPE '\\' OR IFNULL(brand, '') LIKE ? ESCAPE '\\')${shelfSql}
         ORDER BY is_favorite DESC, name COLLATE NOCASE LIMIT 200`,
      ).all(likeTerm(query), likeTerm(query)) as FoodSql[]
    : db.prepare(`${FOOD_COLUMNS} FROM foods WHERE 1=1${shelfSql} ORDER BY is_favorite DESC, name COLLATE NOCASE LIMIT 200`).all() as FoodSql[];
  return rows.map((row) => toFood(row, []));
}

function mustFood(db: AppDatabase, id: string): Food {
  const food = getFood(db, id);
  if (!food) throw new Error('Saved food could not be read back');
  return food;
}

function replaceIngredients(db: AppDatabase, parentId: string, lines: IngredientLine[]): void {
  db.prepare('DELETE FROM food_ingredients WHERE parent_id = ?').run(parentId);
  const insert = db.prepare(
    `INSERT INTO food_ingredients (id, parent_id, name, servings, source_ref, child_food_id)
     VALUES (@id, @parentId, @name, @servings, @sourceRef, @childFoodId)`,
  );
  for (const line of lines) {
    insert.run({ id: randomUUID(), parentId, ...line });
  }
}

function ingredientsFor(db: AppDatabase, parentId: string): IngredientLine[] {
  const rows = db.prepare(
    `SELECT name, servings, source_ref, child_food_id FROM food_ingredients WHERE parent_id = ?`,
  ).all(parentId) as Array<{ name: string; servings: number; source_ref: string | null; child_food_id: string | null }>;
  return rows.map((row) => ({
    name: row.name,
    servings: row.servings,
    sourceRef: row.source_ref,
    childFoodId: row.child_food_id,
  }));
}

function toFood(row: FoodSql, ingredients: IngredientLine[]): Food {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    kind: row.kind,
    servingLabel: row.serving_label,
    nutrients: {
      calories: row.calories,
      protein: row.protein,
      fiber: row.fiber,
      fat: row.fat,
      carbs: row.carbs,
      sodium: row.sodium,
      extras: parseStoredExtras(row.extras_json),
    },
    isFavorite: row.is_favorite === 1,
    isDrink: row.is_drink === 1,
    drinkMl: row.drink_ml,
    makesServings: row.makes_servings,
    source: row.source,
    sourceRef: row.source_ref,
    ingredients,
  };
}

function foodParams(food: NewFood): Record<string, string | number | null> {
  return {
    createdBy: food.createdBy,
    name: food.name,
    brand: food.brand,
    kind: food.kind,
    servingLabel: food.servingLabel,
    calories: food.nutrients.calories,
    protein: food.nutrients.protein,
    fiber: food.nutrients.fiber,
    fat: food.nutrients.fat,
    carbs: food.nutrients.carbs,
    sodium: food.nutrients.sodium,
    extras: JSON.stringify(food.nutrients.extras),
    isFavorite: food.isFavorite ? 1 : 0,
    isDrink: food.isDrink ? 1 : 0,
    drinkMl: food.drinkMl,
    makesServings: food.makesServings,
    source: food.source,
    sourceRef: food.sourceRef,
  };
}

function likeTerm(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const FOOD_COLUMNS = `SELECT id, name, brand, kind, serving_label, calories, protein, fiber, fat, carbs, sodium,
  extras_json, is_favorite, is_drink, drink_ml, makes_servings, source, source_ref`;
