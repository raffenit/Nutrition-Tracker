import type { DayTotals, MealLog } from '../types';
import { listCachedFoods } from './db';
import { addNutrients, nutrientsFromMealBody } from './nutrients';
import type { OutboxEntry, PendingLogPreview } from './types';

export function localDateFromBody(body: Record<string, unknown>): string {
  const eatenAt = String(body.eatenAt ?? body.loggedAt ?? '');
  return eatenAt.slice(0, 10);
}

export function formatPendingTime(isoLocal: string): string {
  if (isoLocal.length < 16) return 'Pending';
  const hours = Number(isoLocal.slice(11, 13));
  const minutes = isoLocal.slice(14, 16);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes} ${suffix}`;
}

export async function pendingPreviewsForDate(localDate: string): Promise<PendingLogPreview[]> {
  const { listOutboxEntries } = await import('./db');
  const entries = await listOutboxEntries();
  const foods = await listCachedFoods();
  const foodById = new Map(foods.map((food) => [food.id, food]));
  const previews: PendingLogPreview[] = [];

  for (const entry of entries) {
    if (entry.kind === 'meal') {
      const date = localDateFromBody(entry.body);
      if (date !== localDate) continue;
      const foodId = typeof entry.body.foodId === 'string' ? entry.body.foodId : null;
      const food = foodId ? foodById.get(foodId) ?? null : null;
      const name =
        typeof entry.body.name === 'string'
          ? entry.body.name
          : food?.name ?? 'Meal';
      const slot = entry.body.slot as MealLog['slot'];
      const nutrients = nutrientsFromMealBody(entry.body, food);
      previews.push({
        clientMutationId: entry.clientMutationId,
        localDate: date,
        nutrients,
        hydrationMl: 0,
        log: {
          id: `pending:${entry.clientMutationId}`,
          name,
          slot,
          timeLabel: `${formatPendingTime(String(entry.body.eatenAt ?? ''))} · pending`,
          servings: Number(entry.body.servings ?? 1),
          nutrients,
          drinkMl: entry.body.drinkMl === null || entry.body.drinkMl === undefined ? null : Number(entry.body.drinkMl),
        },
      });
    }
  }
  return previews;
}

export function pendingHydrationMl(entries: OutboxEntry[], localDate: string): number {
  return entries.reduce((total, entry) => {
    if (entry.kind !== 'hydration') return total;
    const date = localDateFromBody(entry.body);
    if (date !== localDate) return total;
    return total + entry.body.amountMl;
  }, 0);
}

export function applyPendingToTotals(totals: DayTotals, previews: PendingLogPreview[], extraHydrationMl: number): DayTotals {
  let nutrients = {
    calories: totals.calories,
    protein: totals.protein,
    fiber: totals.fiber,
    fat: totals.fat,
    carbs: totals.carbs,
    sodium: totals.sodium,
    extras: totals.extras.map((extra) => ({ ...extra })),
  };
  for (const preview of previews) {
    nutrients = addNutrients(nutrients, preview.nutrients);
  }
  return {
    ...totals,
    calories: nutrients.calories,
    protein: nutrients.protein,
    fiber: nutrients.fiber,
    fat: nutrients.fat,
    carbs: nutrients.carbs,
    sodium: nutrients.sodium,
    extras: nutrients.extras,
    hydrationMl: totals.hydrationMl + extraHydrationMl,
  };
}
