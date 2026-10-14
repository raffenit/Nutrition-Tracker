import {
  deletePushSubscription,
  deletePushSubscriptionsForUser,
  getPushEnabled,
  listPushSubscriptions,
  setPushEnabled,
  upsertPushSubscription,
} from '../db/push.js';
import { pushConfigured } from '../domain/pushNotify.js';
import { isRecord, requiredText } from '../domain/guards.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';

export function pushRoutes(): Route[] {
  return [
    route('GET', '/api/push/status', pushStatus),
    route('PUT', '/api/push/preference', savePushPreference),
    route('POST', '/api/push/subscribe', subscribePush),
    route('DELETE', '/api/push/subscribe', unsubscribePush),
  ];
}

function pushStatus(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const configured = pushConfigured(ctx.config);
  sendJson(ctx.res, 200, {
    configured,
    enabled: configured && getPushEnabled(ctx.db, user.id),
    subscribed: configured && listPushSubscriptions(ctx.db, user.id).length > 0,
    publicKey: configured ? ctx.config.vapid?.publicKey ?? null : null,
  });
  return Promise.resolve();
}

async function savePushPreference(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  if (!pushConfigured(ctx.config)) throw new HttpError(503, 'Push is not configured on this server');
  const body = await readJson(ctx.req);
  if (!isRecord(body) || typeof body.enabled !== 'boolean') throw new HttpError(400, 'Choose whether push is on');
  setPushEnabled(ctx.db, user.id, body.enabled);
  if (!body.enabled) deletePushSubscriptionsForUser(ctx.db, user.id);
  sendJson(ctx.res, 200, { enabled: body.enabled });
}

async function subscribePush(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  if (!pushConfigured(ctx.config)) throw new HttpError(503, 'Push is not configured on this server');
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a push subscription');
  const endpoint = requiredText(body.endpoint, 'Endpoint');
  const keys = body.keys;
  if (!isRecord(keys)) throw new HttpError(400, 'Expected subscription keys');
  const p256dh = requiredText(keys.p256dh, 'Key');
  const auth = requiredText(keys.auth, 'Key');
  setPushEnabled(ctx.db, user.id, true);
  upsertPushSubscription(ctx.db, user.id, { endpoint, p256dh, auth });
  sendJson(ctx.res, 201, { ok: true });
}

async function unsubscribePush(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected an endpoint');
  const endpoint = requiredText(body.endpoint, 'Endpoint');
  deletePushSubscription(ctx.db, user.id, endpoint);
  sendJson(ctx.res, 200, { ok: true });
}
