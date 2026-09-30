import type { AppDatabase } from '../db/database.js';
import { hydrationTotalsByDate, mealTotalsByDate } from '../db/trends.js';
import { listWeightEntries } from '../db/weight.js';
import { emptyNutrients } from './nutrients.js';
import { shiftLocalDate, weekdayShort } from './time.js';

export type TrendDay = {
  date: string;
  weekday: string;
  calories: number;
  protein: number;
  hydrationMl: number;
};

export type TrendWeightPoint = {
  date: string;
  weight: number;
  unit: 'lb' | 'kg';
};

export type TrendSeries = {
  days: number;
  endDate: string;
  points: TrendDay[];
  weight: TrendWeightPoint[];
};

export function buildTrendSeries(db: AppDatabase, userId: string, endDate: string, days: number): TrendSeries {
  const span = clampDays(days);
  const startDate = shiftLocalDate(endDate, -(span - 1));
  const meals = mealTotalsByDate(db, userId, startDate, endDate);
  const water = hydrationTotalsByDate(db, userId, startDate, endDate);
  const points: TrendDay[] = [];
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const date = shiftLocalDate(endDate, -offset);
    const meal = meals.get(date) ?? emptyNutrients();
    points.push({
      date,
      weekday: weekdayShort(date),
      calories: meal.calories,
      protein: meal.protein,
      hydrationMl: water.get(date) ?? 0,
    });
  }
  const weight = listWeightEntries(db, userId)
    .filter((entry) => entry.localDate >= startDate && entry.localDate <= endDate)
    .map((entry) => ({ date: entry.localDate, weight: entry.weight, unit: entry.unit }))
    .reverse();
  return { days: span, endDate, points, weight };
}

function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.min(14, Math.max(3, Math.round(days)));
}
