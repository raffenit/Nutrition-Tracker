import { assertPassword, hashPassword, hashToken, newToken, verifyPassword } from '../auth/passwords.js';
import { DEFAULT_TARGETS } from '../domain/nutrients.js';
import { assertTimeZone } from '../domain/time.js';
import { isRecord, optionalText, requiredText } from '../domain/guards.js';
import { createSession, deleteSession } from '../db/sessions.js';
import {
  countAdmins,
  countUsers,
  deleteUser,
  findUserById,
  findUserByName,
  getHousehold,
  getTargets,
  insertUser,
  listUsers,
  saveHousehold,
  saveKioskHash,
  saveTargets,
} from '../db/users.js';
import { HttpError } from '../http/errors.js';
import { clearSessionCookie, readCookie, sessionCookie, SESSION_COOKIE } from '../http/cookies.js';
import { requireAdmin, requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Route } from '../http/router.js';
import { applyDietPreset, dietPresetById, listDietPresetsPublic } from '../domain/dietPresets.js';
import { readTargets } from '../domain/nutrients.js';

export function authRoutes(): Route[] {
  return [
    route('GET', '/api/health', async (ctx) => {
      sendJson(ctx.res, 200, { ok: true, setupRequired: countUsers(ctx.db) === 0 });
    }),
    route('GET', '/api/session', async (ctx) => {
      const household = getHousehold(ctx.db);
      sendJson(ctx.res, 200, {
        setupRequired: countUsers(ctx.db) === 0,
        mode: ctx.auth.kind,
        user: ctx.auth.kind === 'user' ? { id: ctx.auth.user.id, name: ctx.auth.user.name, role: ctx.auth.user.role } : null,
        household: publicHousehold(household),
      });
    }),
    route('POST', '/api/setup', setup),
    route('POST', '/api/auth/login', login),
    route('POST', '/api/auth/logout', logout),
    route('GET', '/api/users', async (ctx) => {
      requireUser(ctx.auth);
      sendJson(ctx.res, 200, { users: listUsers(ctx.db) });
    }),
    route('POST', '/api/users', createMember),
    route('DELETE', '/api/users/:id', removeMember),
    route('GET', '/api/targets', async (ctx) => {
      const user = requireUser(ctx.auth);
      sendJson(ctx.res, 200, { targets: getTargets(ctx.db, user.id) ?? DEFAULT_TARGETS });
    }),
    route('PUT', '/api/targets', saveUserTargets),
    route('GET', '/api/diet-presets', async (ctx) => {
      requireUser(ctx.auth);
      sendJson(ctx.res, 200, { presets: listDietPresetsPublic() });
    }),
    route('POST', '/api/targets/apply-preset', applyTargetsPreset),
    route('PUT', '/api/household', saveHouseholdSettings),
    route('POST', '/api/household/kiosk', createKioskLink),
  ];
}

async function setup(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  if (countUsers(ctx.db) > 0) throw new HttpError(409, 'This server already has an account');
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected setup details');
  const name = requiredText(body.name, 'Name');
  const password = assertPassword(requiredText(body.password, 'Password'));
  const householdName = optionalText(body.householdName) ?? 'Household';
  assertTimeZone(ctx.config.timezone);
  const user = ctx.db.transaction(() => {
    const created = insertUser(ctx.db, name, hashPassword(password), 'admin');
    saveHousehold(ctx.db, householdName, ctx.config.timezone);
    saveTargets(ctx.db, created.id, DEFAULT_TARGETS);
    return created;
  })();
  sendSession(ctx, user.id);
}

async function login(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a name and password');
  const user = findUserByName(ctx.db, requiredText(body.name, 'Name'));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!user || !verifyPassword(password, user.passwordHash)) throw new HttpError(401, 'Name or password is wrong');
  sendSession(ctx, user.id);
}

async function logout(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  const sessionId = readCookie(ctx.req, SESSION_COOKIE);
  if (sessionId) deleteSession(ctx.db, sessionId);
  ctx.res.setHeader('Set-Cookie', clearSessionCookie());
  sendJson(ctx.res, 200, { ok: true });
}

async function createMember(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  requireAdmin(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a new person');
  const role = body.role === 'admin' ? 'admin' : 'member';
  const user = insertUser(ctx.db, requiredText(body.name, 'Name'), hashPassword(assertPassword(requiredText(body.password, 'Password'))), role);
  saveTargets(ctx.db, user.id, DEFAULT_TARGETS);
  sendJson(ctx.res, 201, { user: { id: user.id, name: user.name, role: user.role } });
}

async function removeMember(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  const admin = requireAdmin(ctx.auth);
  if (ctx.params.id === admin.id) throw new HttpError(400, 'You cannot remove your own account');
  const users = listUsers(ctx.db);
  const target = users.find((user) => user.id === ctx.params.id);
  if (!target) throw new HttpError(404, 'Person not found');
  if (target.role === 'admin' && countAdmins(ctx.db) <= 1) throw new HttpError(400, 'Keep at least one admin');
  deleteUser(ctx.db, target.id);
  sendJson(ctx.res, 200, { ok: true });
}

async function applyTargetsPreset(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a preset id');
  const preset = dietPresetById(requiredText(body.presetId, 'Preset'));
  if (!preset) throw new HttpError(404, 'Unknown diet preset');
  const current = getTargets(ctx.db, user.id) ?? DEFAULT_TARGETS;
  saveTargets(ctx.db, user.id, applyDietPreset(current, preset));
  sendJson(ctx.res, 200, { targets: getTargets(ctx.db, user.id) });
}

async function saveUserTargets(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  const user = requireUser(ctx.auth);
  saveTargets(ctx.db, user.id, readTargets(await readJson(ctx.req)));
  sendJson(ctx.res, 200, { targets: getTargets(ctx.db, user.id) });
}

async function saveHouseholdSettings(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  requireAdmin(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected household settings');
  const timezone = requiredText(body.timezone, 'Timezone');
  assertTimeZone(timezone);
  saveHousehold(ctx.db, requiredText(body.name, 'Household name'), timezone);
  sendJson(ctx.res, 200, { household: publicHousehold(getHousehold(ctx.db)) });
}

async function createKioskLink(ctx: Parameters<Route['handler']>[0]): Promise<void> {
  requireAdmin(ctx.auth);
  const token = newToken();
  saveKioskHash(ctx.db, hashToken(token));
  const origin = ctx.config.publicUrl ?? `http://${ctx.req.headers.host ?? `localhost:${ctx.config.port}`}`;
  sendJson(ctx.res, 200, { url: `${origin.replace(/\/$/, '')}/family?kiosk=${token}` });
}

function sendSession(ctx: Parameters<Route['handler']>[0], userId: string): void {
  const session = createSession(ctx.db, userId, 'user');
  ctx.res.setHeader('Set-Cookie', sessionCookie(session.id));
  const user = findUserById(ctx.db, userId);
  sendJson(ctx.res, 200, { user: user ? { id: user.id, name: user.name, role: user.role } : null });
}

function publicHousehold(household: ReturnType<typeof getHousehold>): { name: string; timezone: string } | null {
  if (!household) return null;
  return { name: household.name, timezone: household.timezone };
}
