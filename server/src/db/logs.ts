import { randomUUID } from 'node:crypto';
import type { HydrationEntry, MealLog, MealSlot, Nutrients } from '../types.js';
import { parseStoredExtras } from '../domain/nutrients.js';
import { formatTime } from '../domain/time.js';
import type { AppDatabase } from './database.js';

export type NewMeal = {
  userId: string;
  foodId: string;
  name: string;
  slot: MealSlot;
  eatenAt: string;
  localDate: string;
  servings: number;
  nutrients: Nutrients;
  drinkMl: number | null;
};

type MealSql = {
  id: string;
  name: string;
  slot: MealSlot;
  eaten_at: string;
  servings: number;
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number;
  extras_json: string;
  drink_ml: number | null;
};

type HydrationSql = {
  id: string;
  amount_ml: number;
  source: 'water' | 'drink';
  logged_at: string;
  meal_log_id: string | null;
};

export function insertMeal(db: AppDatabase, meal: NewMeal): string {
  const id = randomUUID();
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO meal_logs (
        id, user_id, food_id, name, slot, eaten_at, local_date, servings,
        calories, protein, fiber, fat, carbs, sodium, extras_json, drink_ml, created_at
      ) VALUES (
        @id, @userId, @foodId, @name, @slot, @eatenAt, @localDate, @servings,
        @calories, @protein, @fiber, @fat, @carbs, @sodium, @extras, @drinkMl, @createdAt
      )`,
    ).run({
      id,
      userId: meal.userId,
      foodId: meal.foodId,
      name: meal.name,
      slot: meal.slot,
      eatenAt: meal.eatenAt,
      localDate: meal.localDate,
      servings: meal.servings,
      calories: meal.nutrients.calories,
      protein: meal.nutrients.protein,
      fiber: meal.nutrients.fiber,
      fat: meal.nutrients.fat,
      carbs: meal.nutrients.carbs,
      sodium: meal.nutrients.sodium,
      extras: JSON.stringify(meal.nutrients.extras),
      drinkMl: meal.drinkMl,
      createdAt: new Date().toISOString(),
    });
    if (meal.drinkMl && meal.drinkMl > 0) insertHydrationRow(db, meal, id);
  });
  save();
  return id;
}

export function listMeals(db: AppDatabase, userId: string, localDate: string, timeZone: string): MealLog[] {
  const rows = db.prepare(
    `SELECT id, name, slot, eaten_at, servings, calories, protein, fiber, fat, carbs, sodium, extras_json, drink_ml
     FROM meal_logs WHERE user_id = ? AND local_date = ? ORDER BY eaten_at`,
  ).all(userId, localDate) as MealSql[];
  return rows.map((row) => toMeal(row, timeZone));
}

export function deleteMeal(db: AppDatabase, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM meal_logs WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function insertWater(db: AppDatabase, userId: string, amountMl: number, loggedAt: string, localDate: string): void {
  db.prepare(
    `INSERT INTO hydration_logs (id, user_id, logged_at, local_date, amount_ml, source, meal_log_id)
     VALUES (?, ?, ?, ?, ?, 'water', NULL)`,
  ).run(randomUUID(), userId, loggedAt, localDate, amountMl);
}

export function listHydration(db: AppDatabase, userId: string, localDate: string, timeZone: string): HydrationEntry[] {
  const rows = db.prepare(
    `SELECT id, amount_ml, source, logged_at, meal_log_id
     FROM hydration_logs WHERE user_id = ? AND local_date = ? ORDER BY logged_at`,
  ).all(userId, localDate) as HydrationSql[];
  return rows.map((row) => ({
    id: row.id,
    amountMl: row.amount_ml,
    source: row.source,
    timeLabel: formatTime(row.logged_at, timeZone),
    mealLogId: row.meal_log_id,
  }));
}

export function deleteLatestWater(db: AppDatabase, userId: string, localDate: string): boolean {
  const row = db.prepare(
    `SELECT id FROM hydration_logs
     WHERE user_id = ? AND local_date = ? AND source = 'water'
     ORDER BY logged_at DESC LIMIT 1`,
  ).get(userId, localDate) as { id: string } | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM hydration_logs WHERE id = ?').run(row.id);
  return true;
}

export function hydrationTotal(entries: HydrationEntry[]): number {
  return entries.reduce((total, entry) => total + entry.amountMl, 0);
}

function insertHydrationRow(db: AppDatabase, meal: NewMeal, mealLogId: string): void {
  db.prepare(
    `INSERT INTO hydration_logs (id, user_id, logged_at, local_date, amount_ml, source, meal_log_id)
     VALUES (?, ?, ?, ?, ?, 'drink', ?)`,
  ).run(randomUUID(), meal.userId, meal.eatenAt, meal.localDate, meal.drinkMl, mealLogId);
}

function toMeal(row: MealSql, timeZone: string): MealLog {
  return {
    id: row.id,
    name: row.name,
    slot: row.slot,
    eatenAt: row.eaten_at,
    timeLabel: formatTime(row.eaten_at, timeZone),
    servings: row.servings,
    nutrients: {
      calories: row.calories,
      protein: row.protein,
      fiber: row.fiber,
      fat: row.fat,
      carbs: row.carbs,
      sodium: row.sodium,
      extras: parseStoredExtras(row.extras_json),
    },
    drinkMl: row.drink_ml,
  };
}
