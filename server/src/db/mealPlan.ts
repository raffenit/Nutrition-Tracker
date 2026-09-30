import { randomUUID } from 'node:crypto';
import type { MealSlot } from '../types.js';
import type { AppDatabase } from './database.js';

export type MealPlanEntryRow = {
  id: string;
  weekStart: string;
  localDate: string;
  slot: MealSlot;
  foodId: string;
  foodName: string;
  servings: number;
};

type EntrySql = {
  id: string;
  week_start: string;
  local_date: string;
  slot: MealSlot;
  food_id: string;
  servings: number;
  name: string;
};

export function listMealPlanEntries(db: AppDatabase, weekStart: string): MealPlanEntryRow[] {
  const rows = db.prepare(
    `SELECT e.id, e.week_start, e.local_date, e.slot, e.food_id, e.servings, f.name
     FROM meal_plan_entries e
     JOIN foods f ON f.id = e.food_id
     WHERE e.week_start = ?
     ORDER BY e.local_date, e.slot, e.sort_order`,
  ).all(weekStart) as EntrySql[];
  return rows.map(toRow);
}

export function replaceMealPlanEntries(
  db: AppDatabase,
  weekStart: string,
  entries: Array<{ localDate: string; slot: MealSlot; foodId: string; servings: number }>,
): MealPlanEntryRow[] {
  const save = db.transaction(() => {
    db.prepare('DELETE FROM meal_plan_entries WHERE week_start = ?').run(weekStart);
    const insert = db.prepare(
      `INSERT INTO meal_plan_entries (id, week_start, local_date, slot, food_id, servings, sort_order)
       VALUES (@id, @weekStart, @localDate, @slot, @foodId, @servings, @sortOrder)`,
    );
    entries.forEach((entry, index) => {
      insert.run({
        id: randomUUID(),
        weekStart,
        localDate: entry.localDate,
        slot: entry.slot,
        foodId: entry.foodId,
        servings: entry.servings,
        sortOrder: index,
      });
    });
  });
  save();
  return listMealPlanEntries(db, weekStart);
}

export function getMealPlanEntry(db: AppDatabase, id: string): MealPlanEntryRow | null {
  const row = db.prepare(
    `SELECT e.id, e.week_start, e.local_date, e.slot, e.food_id, e.servings, f.name
     FROM meal_plan_entries e
     JOIN foods f ON f.id = e.food_id
     WHERE e.id = ?`,
  ).get(id) as EntrySql | undefined;
  return row ? toRow(row) : null;
}

function toRow(row: EntrySql): MealPlanEntryRow {
  return {
    id: row.id,
    weekStart: row.week_start,
    localDate: row.local_date,
    slot: row.slot,
    foodId: row.food_id,
    servings: row.servings,
    foodName: row.name,
  };
}
