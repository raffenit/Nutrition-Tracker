import {
  deleteWeightEntry,
  deleteWeightHistory,
  dismissWeightWeek,
  getWeightPreference,
  insertWeightEntry,
  saveWeightPreference,
  updateWeightEntry,
} from '../db/weight.js';
import { finiteNumber, isRecord, requiredNumber, requiredText } from '../domain/guards.js';
import { readLocalDate } from '../domain/time.js';
import { weekKey } from '../domain/weight.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import { householdZone } from './household.js';
import { personalWeight } from './weightStatus.js';

export function weightRoutes(): Route[] {
  return [
    route('GET', '/api/weight', readWeight),
    route('PUT', '/api/weight/preference', savePreference),
    route('POST', '/api/weight', logWeight),
    route('POST', '/api/weight/dismiss', dismissReminder),
    route('PATCH', '/api/weight/:id', patchWeightEntry),
    route('DELETE', '/api/weight/:id', removeWeightEntry),
    route('DELETE', '/api/weight', eraseWeight),
  ];
}

async function readWeight(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const today = readLocalDate(null, householdZone(ctx));
  const historyDays = weightHistoryDays(ctx.url.searchParams.get('historyDays'));
  sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, today, historyDays ? { historyDays } : undefined) });
}

async function savePreference(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body) || typeof body.enabled !== 'boolean') throw new HttpError(400, 'Choose whether check-ins are on');
  const weekday = body.weekday === undefined ? 1 : requiredNumber(body.weekday, 'Weekday');
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new HttpError(400, 'Choose a day of the week');
  const unit = body.unit === 'kg' ? 'kg' : 'lb';
  saveWeightPreference(ctx.db, user.id, { enabled: body.enabled, weekday, unit });
  sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, readLocalDate(null, householdZone(ctx))) });
}

async function logWeight(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  if (!getWeightPreference(ctx.db, user.id).enabled) throw new HttpError(403, 'Turn on weight check-ins first');
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a weight entry');
  const weight = requiredNumber(body.weight, 'Weight');
  if (weight <= 0) throw new HttpError(400, 'Weight must be greater than zero');
  const unit = body.unit === 'kg' ? 'kg' : 'lb';
  const localDate = requiredText(body.localDate, 'Date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new HttpError(400, 'Choose a date');
  insertWeightEntry(ctx.db, user.id, { localDate, weight, unit });
  sendJson(ctx.res, 201, { weight: personalWeight(ctx.db, user.id, readLocalDate(null, householdZone(ctx))) });
}

async function dismissReminder(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const today = readLocalDate(null, householdZone(ctx));
  dismissWeightWeek(ctx.db, user.id, weekKey(today));
  sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, today) });
}

async function eraseWeight(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  deleteWeightHistory(ctx.db, user.id);
  sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, readLocalDate(null, householdZone(ctx))) });
}

async function removeWeightEntry(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  if (!deleteWeightEntry(ctx.db, user.id, ctx.params.id)) throw new HttpError(404, 'Weight entry not found');
  const today = readLocalDate(null, householdZone(ctx));
  const historyDays = weightHistoryDays(ctx.url.searchParams.get('historyDays'));
  sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, today, historyDays ? { historyDays } : undefined) });
}

async function patchWeightEntry(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a weight update');
  const patch: { weight?: number; localDate?: string } = {};
  if (body.weight !== undefined) {
    const weight = requiredNumber(body.weight, 'Weight');
    if (weight <= 0) throw new HttpError(400, 'Weight must be greater than zero');
    patch.weight = weight;
  }
  if (body.localDate !== undefined) patch.localDate = requiredText(body.localDate, 'Date');
  if (patch.weight === undefined && patch.localDate === undefined) throw new HttpError(400, 'Nothing to update');
  if (!updateWeightEntry(ctx.db, user.id, ctx.params.id, patch)) throw new HttpError(404, 'Weight entry not found');
  const today = readLocalDate(null, householdZone(ctx));
  const historyDays = weightHistoryDays(ctx.url.searchParams.get('historyDays'));
  sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, today, historyDays ? { historyDays } : undefined) });
}

function weightHistoryDays(value: string | null): number | null {
  const days = finiteNumber(value);
  if (days === null) return null;
  return Math.min(365, Math.max(7, Math.round(days)));
}
