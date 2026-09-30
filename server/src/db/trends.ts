import type { AppDatabase } from './database.js';

export type MealDayTotal = {
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number;
};

type MealRow = MealDayTotal & { local_date: string };
type WaterRow = { local_date: string; hydration_ml: number };

export function mealTotalsByDate(
  db: AppDatabase,
  userId: string,
  fromDate: string,
  toDate: string,
): Map<string, MealDayTotal> {
  const rows = db.prepare(
    `SELECT local_date,
      SUM(calories) AS calories,
      SUM(protein) AS protein,
      SUM(fiber) AS fiber,
      SUM(fat) AS fat,
      SUM(carbs) AS carbs,
      SUM(sodium) AS sodium
     FROM meal_logs
     WHERE user_id = ? AND local_date >= ? AND local_date <= ?
     GROUP BY local_date`,
  ).all(userId, fromDate, toDate) as MealRow[];
  return new Map(rows.map((row) => [row.local_date, stripDate(row)]));
}

export function hydrationTotalsByDate(
  db: AppDatabase,
  userId: string,
  fromDate: string,
  toDate: string,
): Map<string, number> {
  const rows = db.prepare(
    `SELECT local_date, SUM(amount_ml) AS hydration_ml
     FROM hydration_logs
     WHERE user_id = ? AND local_date >= ? AND local_date <= ?
     GROUP BY local_date`,
  ).all(userId, fromDate, toDate) as WaterRow[];
  return new Map(rows.map((row) => [row.local_date, row.hydration_ml]));
}

function stripDate(row: MealRow): MealDayTotal {
  return {
    calories: row.calories,
    protein: row.protein,
    fiber: row.fiber,
    fat: row.fat,
    carbs: row.carbs,
    sodium: row.sodium,
  };
}
