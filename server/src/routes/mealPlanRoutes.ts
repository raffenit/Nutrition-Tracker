import { getFood, listFoodsWithIngredients } from '../db/foods.js';
import { insertMeal } from '../db/logs.js';
import { getMealPlanEntry, listMealPlanEntries, replaceMealPlanEntries } from '../db/mealPlan.js';
import { drinkVolume } from '../domain/drinks.js';
import { getKitMappingByKey } from '../db/mealKitEcosystems.js';
import { aggregateGroceryLineItems, formatGroceryMarkdown, type PlannedMeal } from '../domain/groceryList.js';
import { generateMealPlan, planCandidatesFromFoods } from '../domain/mealPlanGenerate.js';
import { PROTEIN_TAGS, readProteinTags } from '../domain/proteinTags.js';
import { kitLineKeyFromText } from '../domain/kitLineKey.js';
import { isRecord, requiredNumber, requiredText } from '../domain/guards.js';
import { roundNutrients, scaleNutrients } from '../domain/nutrients.js';
import { readLocalDate, todayLocal, weekEndSunday, weekStartMonday, zonedToUtc } from '../domain/time.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import type { MealSlot } from '../types.js';
import { householdZone } from './household.js';

const SLOTS = ['meal', 'snack', 'dessert', 'drink'] as const;

export function mealPlanRoutes(): Route[] {
  return [
    route('GET', '/api/meal-plan', readPlan),
    route('PUT', '/api/meal-plan', savePlan),
    route('GET', '/api/meal-plan/grocery', groceryList),
    route('GET', '/api/meal-plan/generate/options', generateOptions),
    route('POST', '/api/meal-plan/generate', generatePlan),
    route('POST', '/api/meal-plan/entries/:id/log', logFromEntry),
  ];
}

function readPlan(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const zone = householdZone(ctx);
  const anchor = readLocalDate(ctx.url.searchParams.get('week'), zone);
  const weekStart = weekStartMonday(anchor);
  const entries = listMealPlanEntries(ctx.db, weekStart);
  sendJson(ctx.res, 200, {
    weekStart,
    weekEnd: weekEndSunday(weekStart),
    today: todayLocal(zone),
    entries,
  });
  return Promise.resolve();
}

async function savePlan(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body) || !Array.isArray(body.entries)) throw new HttpError(400, 'Expected entries');
  const zone = householdZone(ctx);
  const weekStart = weekStartMonday(readLocalDate(typeof body.weekStart === 'string' ? body.weekStart : null, zone));
  const entries = body.entries.map(readEntryInput);
  const weekEnd = weekEndSunday(weekStart);
  for (const entry of entries) {
    if (entry.servings <= 0) throw new HttpError(400, 'Servings must be greater than zero');
    if (!getFood(ctx.db, entry.foodId)) throw new HttpError(400, 'Each planned item needs a library food or recipe');
    if (entry.localDate < weekStart || entry.localDate > weekEnd) {
      throw new HttpError(400, 'Each entry must fall inside the planned week');
    }
  }
  const saved = replaceMealPlanEntries(ctx.db, weekStart, entries);
  sendJson(ctx.res, 200, { weekStart, weekEnd: weekEndSunday(weekStart), entries: saved });
}

function groceryList(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const zone = householdZone(ctx);
  const weekStart = weekStartMonday(readLocalDate(ctx.url.searchParams.get('week'), zone));
  const weekEnd = weekEndSunday(weekStart);
  const entries = listMealPlanEntries(ctx.db, weekStart);
  const lineItems = aggregateGroceryLineItems(
    entries.map((entry) => ({ foodId: entry.foodId, servings: entry.servings })),
    (id) => getFood(ctx.db, id),
    (ecosystemId, lineName) => {
      const key = kitLineKeyFromText(lineName);
      if (!key) return null;
      return getKitMappingByKey(ctx.db, ecosystemId, key);
    },
  );
  const meals: PlannedMeal[] = entries.map((entry) => ({
    localDate: entry.localDate,
    slot: entry.slot,
    foodId: entry.foodId,
    servings: entry.servings,
    foodName: entry.foodName,
  }));
  sendJson(ctx.res, 200, {
    weekStart,
    weekEnd,
    lineItems,
    markdown: formatGroceryMarkdown(weekStart, weekEnd, lineItems, meals),
  });
  return Promise.resolve();
}

async function logFromEntry(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const entry = getMealPlanEntry(ctx.db, ctx.params.id);
  if (!entry) throw new HttpError(404, 'Planned meal not found');
  const food = getFood(ctx.db, entry.foodId);
  if (!food) throw new HttpError(404, 'Food not found');
  let eatenLocal = `${entry.localDate}T12:00`;
  try {
    const body = await readJson(ctx.req);
    if (isRecord(body) && typeof body.eatenAt === 'string') eatenLocal = body.eatenAt;
  } catch {
    /* empty body is fine */
  }
  const zone = householdZone(ctx);
  const eatenAt = zonedToUtc(eatenLocal, zone);
  const volume = drinkVolume(food, entry.slot, entry.servings, null);
  insertMeal(ctx.db, {
    userId: user.id,
    foodId: food.id,
    name: food.name,
    slot: entry.slot,
    eatenAt,
    localDate: entry.localDate,
    servings: entry.servings,
    nutrients: roundNutrients(scaleNutrients(food.nutrients, entry.servings)),
    drinkMl: volume,
  });
  sendJson(ctx.res, 201, { ok: true, localDate: entry.localDate });
}

function generateOptions(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const { mains, sides } = planCandidatesFromFoods(listFoodsWithIngredients(ctx.db, 'all'));
  sendJson(ctx.res, 200, {
    proteinTags: PROTEIN_TAGS,
    candidates: { mains: mains.length, sides: sides.length },
  });
  return Promise.resolve();
}

async function generatePlan(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected generation options');
  const zone = householdZone(ctx);
  const mealCount = typeof body.mealCount === 'number' ? Math.floor(body.mealCount) : 0;
  if (mealCount <= 0 || mealCount > 31) throw new HttpError(400, 'Meal count must be between 1 and 31');

  const proteins = readProteinTags(body.proteins);
  const slotRaw = typeof body.slot === 'string' ? body.slot : 'meal';
  if (!SLOTS.includes(slotRaw as MealSlot)) throw new HttpError(400, 'Invalid meal slot');

  // Dates: explicit list wins; otherwise the Mon–Sun week containing `week`/today.
  let dates: string[] = [];
  if (Array.isArray(body.dates)) {
    dates = body.dates.map((value) => {
      if (typeof value !== 'string') throw new HttpError(400, 'Dates must be text');
      return readLocalDate(value, zone);
    });
  } else {
    const anchor = readLocalDate(typeof body.week === 'string' ? body.week : null, zone);
    const weekStart = weekStartMonday(anchor);
    const cursor = new Date(`${weekStart}T00:00:00Z`);
    for (let i = 0; i < 7; i += 1) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  if (dates.length === 0) throw new HttpError(400, 'No dates to plan');

  const seed = typeof body.seed === 'number' && Number.isFinite(body.seed) ? Math.floor(body.seed) : Math.floor(Math.random() * 0x7fffffff);
  const avoidFoodIds = Array.isArray(body.avoidFoodIds)
    ? body.avoidFoodIds.filter((value): value is string => typeof value === 'string')
    : [];
  const result = generateMealPlan(listFoodsWithIngredients(ctx.db, 'all'), {
    mealCount,
    proteins,
    dates,
    slot: slotRaw as MealSlot,
    seed,
    avoidFoodIds,
  });
  if (result.meals.length === 0) {
    throw new HttpError(400, proteins.length > 0
      ? 'No mains match the selected proteins — tag foods/recipes or loosen the filter'
      : 'No plannable mains in the library');
  }
  sendJson(ctx.res, 200, {
    seed,
    proteinFilterApplied: result.proteinFilterApplied,
    meals: result.meals.map((meal) => ({
      localDate: meal.localDate,
      slot: meal.slot,
      main: meal.main,
      side: meal.side,
    })),
  });
}

function readEntryInput(value: unknown): { localDate: string; slot: MealSlot; foodId: string; servings: number } {
  if (!isRecord(value)) throw new HttpError(400, 'Invalid plan entry');
  const slot = value.slot;
  if (typeof slot !== 'string' || !SLOTS.includes(slot as MealSlot)) throw new HttpError(400, 'Invalid meal slot');
  return {
    localDate: requiredText(value.localDate, 'Day'),
    slot: slot as MealSlot,
    foodId: requiredText(value.foodId, 'Food'),
    servings: requiredNumber(value.servings, 'Servings'),
  };
}
