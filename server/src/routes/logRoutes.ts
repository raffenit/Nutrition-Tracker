import { getFood } from '../db/foods.js';
import { deleteLatestWater, deleteMeal, insertMeal, insertWater } from '../db/logs.js';
import { drinkVolume } from '../domain/drinks.js';
import { isRecord, requiredNumber, requiredText } from '../domain/guards.js';
import { readNutrients, roundNutrients, scaleNutrients } from '../domain/nutrients.js';
import { notifyGoalAlertsAfterLog } from '../domain/pushNotify.js';
import { readLocalDate, zonedToUtc } from '../domain/time.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import type { MealSlot } from '../types.js';
import { householdZone } from './household.js';

const SLOTS = ['meal', 'snack', 'dessert', 'drink'] as const;

export function logRoutes(): Route[] {
  return [
    route('POST', '/api/logs', createLog),
    route('DELETE', '/api/logs/:id', async (ctx) => {
      const user = requireUser(ctx.auth);
      if (!deleteMeal(ctx.db, user.id, ctx.params.id)) throw new HttpError(404, 'Log entry not found');
      sendJson(ctx.res, 200, { ok: true });
    }),
    route('POST', '/api/hydration', addWater),
    route('DELETE', '/api/hydration/latest-water', removeWater),
  ];
}

async function createLog(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a meal log');
  if (body.adHoc === true) {
    const { id, localDate } = createAdHocLog(ctx, user.id, body);
    await notifyGoalAlertsAfterLog(ctx.db, ctx.config, user.id, localDate, householdZone(ctx));
    sendJson(ctx.res, 201, { ok: true, id });
    return;
  }
  const food = getFood(ctx.db, requiredText(body.foodId, 'Food'));
  if (!food) throw new HttpError(404, 'Food not found');
  const slot = oneSlot(body.slot);
  const servings = requiredNumber(body.servings, 'Servings');
  if (servings <= 0) throw new HttpError(400, 'Servings must be greater than zero');
  const eatenAt = zonedToUtc(requiredText(body.eatenAt, 'Time'), householdZone(ctx));
  const override = body.drinkMl === null || body.drinkMl === undefined ? null : requiredNumber(body.drinkMl, 'Drink volume');
  const volume = drinkVolume(food, slot, servings, override);
  const localDate = readLocalDate(requiredText(body.eatenAt, 'Time').slice(0, 10), householdZone(ctx));
  const clientMutationId = optionalMutationId(body.clientMutationId);
  const id = insertMeal(ctx.db, {
    userId: user.id,
    foodId: food.id,
    name: food.name,
    slot,
    eatenAt,
    localDate,
    servings,
    nutrients: roundNutrients(scaleNutrients(food.nutrients, servings)),
    drinkMl: volume,
    clientMutationId,
  });
  await notifyGoalAlertsAfterLog(ctx.db, ctx.config, user.id, localDate, householdZone(ctx));
  sendJson(ctx.res, 201, { ok: true, id });
}

function createAdHocLog(ctx: Ctx, userId: string, body: Record<string, unknown>): { id: string; localDate: string } {
  const name = requiredText(body.name, 'Name');
  const slot = oneSlot(body.slot);
  const servings = requiredNumber(body.servings, 'Servings');
  if (servings <= 0) throw new HttpError(400, 'Servings must be greater than zero');
  const zone = householdZone(ctx);
  const eatenAtLocal = requiredText(body.eatenAt, 'Time');
  const eatenAt = zonedToUtc(eatenAtLocal, zone);
  const localDate = readLocalDate(eatenAtLocal.slice(0, 10), zone);
  const entryTotals = body.entryTotals === true;
  const perServing = readNutrients(body.nutrients);
  const nutrients = entryTotals
    ? roundNutrients(perServing)
    : roundNutrients(scaleNutrients(perServing, servings));
  const storedServings = entryTotals ? 1 : servings;
  const override = body.drinkMl === null || body.drinkMl === undefined ? null : requiredNumber(body.drinkMl, 'Drink volume');
  const drinkMl = slot === 'drink' ? (override ?? 0) : null;
  const clientMutationId = optionalMutationId(body.clientMutationId);
  const id = insertMeal(ctx.db, {
    userId,
    foodId: null,
    name,
    slot,
    eatenAt,
    localDate,
    servings: storedServings,
    nutrients,
    drinkMl: drinkMl && drinkMl > 0 ? drinkMl : null,
    clientMutationId,
  });
  return { id, localDate };
}

async function addWater(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a water entry');
  const amount = requiredNumber(body.amountMl, 'Amount');
  if (amount <= 0) throw new HttpError(400, 'Amount must be greater than zero');
  const zone = householdZone(ctx);
  const loggedAt = body.loggedAt ? zonedToUtc(requiredText(body.loggedAt, 'Time'), zone) : new Date().toISOString();
  const localDate = body.loggedAt ? requiredText(body.loggedAt, 'Time').slice(0, 10) : readLocalDate(null, zone);
  const clientMutationId = optionalMutationId(body.clientMutationId);
  const id = insertWater(ctx.db, user.id, amount, loggedAt, localDate, clientMutationId);
  sendJson(ctx.res, 201, { ok: true, id });
}

async function removeWater(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const date = readLocalDate(ctx.url.searchParams.get('date'), householdZone(ctx));
  if (!deleteLatestWater(ctx.db, user.id, date)) throw new HttpError(404, 'No glass of water to remove');
  sendJson(ctx.res, 200, { ok: true });
}

function oneSlot(value: unknown): MealSlot {
  if (typeof value === 'string' && SLOTS.includes(value as MealSlot)) return value as MealSlot;
  throw new HttpError(400, 'Choose meal, snack, dessert, or drink');
}

function optionalMutationId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new HttpError(400, 'clientMutationId must be text');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) throw new HttpError(400, 'clientMutationId is invalid');
  return trimmed;
}
