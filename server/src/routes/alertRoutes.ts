import { dismissAlert } from '../db/alerts.js';
import { isRecord, requiredText } from '../domain/guards.js';
import { readLocalDate } from '../domain/time.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import { householdZone } from './household.js';

export function alertRoutes(): Route[] {
  return [route('POST', '/api/alerts/dismiss', dismissGoalAlert)];
}

async function dismissGoalAlert(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected an alert dismissal');
  const alertKey = requiredText(body.alertKey, 'Alert');
  const zone = householdZone(ctx);
  const localDate = body.localDate
    ? readLocalDate(requiredText(body.localDate, 'Date'), zone)
    : readLocalDate(null, zone);
  dismissAlert(ctx.db, user.id, localDate, alertKey);
  sendJson(ctx.res, 200, { ok: true });
}
