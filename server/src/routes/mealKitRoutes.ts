import { getFood } from '../db/foods.js';
import type { AppDatabase } from '../db/database.js';
import {
  createMealKitEcosystem,
  deleteKitMapping,
  deleteMealKitEcosystem,
  getMealKitEcosystem,
  listKitMappings,
  listMealKitEcosystems,
  renameMealKitEcosystem,
  saveKitMappingRow,
} from '../db/mealKitEcosystems.js';
import { isRecord, optionalText, requiredText } from '../domain/guards.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';

export function mealKitRoutes(): Route[] {
  return [
    route('GET', '/api/meal-kits', listEcosystems),
    route('POST', '/api/meal-kits', createEcosystem),
    route('PATCH', '/api/meal-kits/:id', patchEcosystem),
    route('DELETE', '/api/meal-kits/:id', removeEcosystem),
    route('GET', '/api/meal-kits/:id/mappings', readMappings),
    route('POST', '/api/meal-kits/:id/mappings', addMapping),
    route('PATCH', '/api/meal-kits/:id/mappings/:mappingId', changeMapping),
    route('DELETE', '/api/meal-kits/:id/mappings/:mappingId', dropMapping),
  ];
}

function listEcosystems(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  sendJson(ctx.res, 200, { ecosystems: listMealKitEcosystems(ctx.db) });
  return Promise.resolve();
}

async function createEcosystem(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a name');
  const name = requiredText(body.name, 'Name');
  const ecosystem = createMealKitEcosystem(ctx.db, name);
  sendJson(ctx.res, 201, { ecosystem });
}

async function patchEcosystem(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a name');
  const name = requiredText(body.name, 'Name');
  const ecosystem = renameMealKitEcosystem(ctx.db, ctx.params.id, name);
  if (!ecosystem) throw new HttpError(404, 'Ecosystem not found');
  sendJson(ctx.res, 200, { ecosystem });
}

function removeEcosystem(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  if (!deleteMealKitEcosystem(ctx.db, ctx.params.id)) throw new HttpError(404, 'Ecosystem not found');
  sendJson(ctx.res, 200, { ok: true });
  return Promise.resolve();
}

function readMappings(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  if (!getMealKitEcosystem(ctx.db, ctx.params.id)) throw new HttpError(404, 'Ecosystem not found');
  sendJson(ctx.res, 200, { mappings: listKitMappings(ctx.db, ctx.params.id) });
  return Promise.resolve();
}

async function addMapping(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  if (!getMealKitEcosystem(ctx.db, ctx.params.id)) throw new HttpError(404, 'Ecosystem not found');
  const body = await readJson(ctx.req);
  const mapping = saveKitMappingRow(ctx.db, ctx.params.id, readMappingBody(ctx.db, body));
  sendJson(ctx.res, 201, { mapping });
}

async function changeMapping(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  if (!getMealKitEcosystem(ctx.db, ctx.params.id)) throw new HttpError(404, 'Ecosystem not found');
  const body = await readJson(ctx.req);
  const mapping = saveKitMappingRow(ctx.db, ctx.params.id, { ...readMappingBody(ctx.db, body), id: ctx.params.mappingId });
  sendJson(ctx.res, 200, { mapping });
}

function dropMapping(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  if (!deleteKitMapping(ctx.db, ctx.params.id, ctx.params.mappingId)) throw new HttpError(404, 'Mapping not found');
  sendJson(ctx.res, 200, { ok: true });
  return Promise.resolve();
}

function readMappingBody(db: AppDatabase, body: unknown): {
  kitLineName: string;
  shopEquivalentFoodId: string | null;
  shopEquivalentLabel: string | null;
  nutritionFoodId: string | null;
} {
  if (!isRecord(body)) throw new HttpError(400, 'Expected mapping fields');
  const kitLineName = requiredText(body.kitLineName, 'Kit ingredient name');
  const shopEquivalentFoodId = optionalText(body.shopEquivalentFoodId);
  if (shopEquivalentFoodId && !getFood(db, shopEquivalentFoodId)) {
    throw new HttpError(400, 'Unknown library food for shopping');
  }
  const nutritionFoodId = optionalText(body.nutritionFoodId);
  if (nutritionFoodId && !getFood(db, nutritionFoodId)) {
    throw new HttpError(400, 'Unknown library food for nutrition');
  }
  return {
    kitLineName,
    shopEquivalentFoodId,
    shopEquivalentLabel: optionalText(body.shopEquivalentLabel),
    nutritionFoodId,
  };
}
