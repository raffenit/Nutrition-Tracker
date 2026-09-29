import { deleteWeightHistory, dismissWeightWeek, getWeightPreference, insertWeightEntry, saveWeightPreference } from '../db/weight.js';
import { isRecord, requiredNumber, requiredText } from '../domain/guards.js';
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
    route('GET', '/api/weight', async (ctx) => {
      const user = requireUser(ctx.auth);
      const today = readLocalDate(null, householdZone(ctx));
      sendJson(ctx.res, 200, { weight: personalWeight(ctx.db, user.id, today) });
    }),
    route('PUT', '/api/weight/preference', savePreference),
    route('POST', '/api/weight', logWeight),
    route('POST', '/api/weight/dismiss', dismissReminder),
    route('DELETE', '/api/weight', eraseWeight),
  ];
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
