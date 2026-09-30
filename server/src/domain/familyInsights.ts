import type { AppDatabase } from '../db/database.js';
import { hydrationTotalsByDate } from '../db/trends.js';
import { parseStoredExtras, addNutrients, emptyNutrients } from './nutrients.js';
import { shiftLocalDate } from './time.js';
import type { DayTotals, MealSlot, Nutrients, Targets } from '../types.js';

export type FamilyMemberInsights = {
  hasGoals: boolean;
  goalDays: {
    met: number;
    daysInMonth: number;
    monthLabel: string;
  };
  usualMealTimes: Array<{ slot: MealSlot; timeLabel: string; count: number }>;
  selectedDayMetGoals: boolean;
};

type MealTimeRow = { slot: MealSlot; eaten_at: string };

export function buildMemberInsights(
  db: AppDatabase,
  userId: string,
  targets: Targets,
  anchorDate: string,
  timeZone: string,
  selectedDayTotals: DayTotals,
): FamilyMemberInsights {
  const monthStart = `${anchorDate.slice(0, 7)}-01`;
  const meals = mealNutrientsByDate(db, userId, monthStart, anchorDate);
  const water = hydrationTotalsByDate(db, userId, monthStart, anchorDate);

  let met = 0;
  let day = monthStart;
  while (day <= anchorDate) {
    const meal = meals.get(day) ?? emptyNutrients();
    const hydrationMl = water.get(day) ?? 0;
    if (dayGoalsMet(toDayTotals(meal, hydrationMl), targets)) met += 1;
    day = shiftLocalDate(day, 1);
  }

  const daysInMonth = countDaysInclusive(monthStart, anchorDate);

  const hasGoals = hasActiveGoals(targets);
  return {
    hasGoals,
    goalDays: { met, daysInMonth, monthLabel: monthLabel(anchorDate, timeZone) },
    usualMealTimes: usualMealTimes(db, userId, monthStart, anchorDate, timeZone),
    selectedDayMetGoals: hasGoals && dayGoalsMet(selectedDayTotals, targets),
  };
}

type MealNutrientRow = Nutrients & { local_date: string };

function mealNutrientsByDate(
  db: AppDatabase,
  userId: string,
  fromDate: string,
  toDate: string,
): Map<string, Nutrients> {
  const rows = db.prepare(
    `SELECT local_date, calories, protein, fiber, fat, carbs, sodium, extras_json
     FROM meal_logs
     WHERE user_id = ? AND local_date >= ? AND local_date <= ?`,
  ).all(userId, fromDate, toDate) as Array<MealNutrientRow & { extras_json: string }>;

  const map = new Map<string, Nutrients>();
  for (const row of rows) {
    const piece: Nutrients = {
      calories: row.calories,
      protein: row.protein,
      fiber: row.fiber,
      fat: row.fat,
      carbs: row.carbs,
      sodium: row.sodium,
      extras: parseStoredExtras(row.extras_json),
    };
    const prev = map.get(row.local_date) ?? emptyNutrients();
    map.set(row.local_date, addNutrients(prev, piece));
  }
  return map;
}

function toDayTotals(meal: Nutrients, hydrationMl: number): DayTotals {
  return { ...meal, hydrationMl, shares: { protein: 0, fat: 0, carbs: 0 } };
}

export function hasActiveGoals(targets: Targets): boolean {
  if (targets.calories > 0 || targets.protein > 0 || targets.fiber > 0 || targets.fat > 0 || targets.carbs > 0) {
    return true;
  }
  if (targets.hydrationMl > 0) return true;
  if (targets.sodium !== null && targets.sodium > 0) return true;
  return targets.extras.some((extra) => extra.amount > 0);
}

export function dayGoalsMet(totals: DayTotals, targets: Targets): boolean {
  if (!hasActiveGoals(targets)) return false;
  const rules: Array<[number, number]> = [
    [targets.calories, totals.calories],
    [targets.protein, totals.protein],
    [targets.fiber, totals.fiber],
    [targets.fat, totals.fat],
    [targets.hydrationMl, totals.hydrationMl],
  ];
  if (!targets.carbsIsLimit) rules.push([targets.carbs, totals.carbs]);
  for (const [goal, amount] of rules) {
    if (goal > 0 && amount < goal) return false;
  }
  if (targets.carbs > 0 && targets.carbsIsLimit && totals.carbs > targets.carbs) return false;
  if (targets.sodium !== null && targets.sodium > 0) {
    if (targets.sodiumIsLimit) {
      if (totals.sodium > targets.sodium) return false;
    } else if (totals.sodium < targets.sodium) {
      return false;
    }
  }
  for (const extra of targets.extras) {
    if (extra.amount <= 0) continue;
    const logged = totals.extras.find((item) => item.key === extra.key)?.amount ?? 0;
    if (logged < extra.amount) return false;
  }
  return true;
}

function usualMealTimes(
  db: AppDatabase,
  userId: string,
  fromDate: string,
  toDate: string,
  timeZone: string,
): FamilyMemberInsights['usualMealTimes'] {
  const rows = db.prepare(
    `SELECT slot, eaten_at FROM meal_logs
     WHERE user_id = ? AND local_date >= ? AND local_date <= ?`,
  ).all(userId, fromDate, toDate) as MealTimeRow[];

  const buckets = new Map<MealSlot, number[]>();
  for (const row of rows) {
    const minutes = minutesInZone(row.eaten_at, timeZone);
    if (minutes === null) continue;
    const list = buckets.get(row.slot) ?? [];
    list.push(minutes);
    buckets.set(row.slot, list);
  }

  const order: MealSlot[] = ['meal', 'snack', 'dessert', 'drink'];
  return order
    .filter((slot) => buckets.has(slot))
    .map((slot) => {
      const list = buckets.get(slot) ?? [];
      const avg = list.reduce((sum, value) => sum + value, 0) / list.length;
      return { slot, timeLabel: formatMinutes(avg), count: list.length };
    });
}

function minutesInZone(iso: string, timeZone: string): number | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatMinutes(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = Math.round(totalMinutes % 60);
  const anchor = new Date(2026, 0, 1, hour, minute);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(anchor);
}

function monthLabel(anchorDate: string, timeZone: string): string {
  const [year, month, day] = anchorDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

function countDaysInclusive(start: string, end: string): number {
  let count = 0;
  let day = start;
  while (day <= end) {
    count += 1;
    day = shiftLocalDate(day, 1);
  }
  return count;
}
