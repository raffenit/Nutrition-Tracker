import { hydrationTotal, listHydration, listMeals } from '../db/logs.js';
import { getTargets, listUsers } from '../db/users.js';
import { glassVolumeMl } from '../domain/units.js';
import { dayTotals } from '../domain/day.js';
import { buildMemberInsights } from '../domain/familyInsights.js';
import { toFamilyBoard } from '../domain/familyView.js';
import { DEFAULT_TARGETS } from '../domain/nutrients.js';
import { readLocalDate, todayLocal } from '../domain/time.js';
import { DEFAULT_DATE_FORMAT, type DateFormat } from '../domain/dateFormat.js';
import { requireReader, requireUser } from '../http/access.js';
import type { Auth } from '../http/router.js';
import { sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import { householdZone } from './household.js';
import { personalWeight } from './weightStatus.js';
import { buildTrendSeries } from '../domain/trends.js';
import { finiteNumber } from '../domain/guards.js';

export function boardRoutes(): Route[] {
  return [
    route('GET', '/api/dashboard', async (ctx) => {
      const user = requireUser(ctx.auth);
      const zone = householdZone(ctx);
      const today = todayLocal(zone);
      const date = readLocalDate(ctx.url.searchParams.get('date'), zone);
      const targets = getTargets(ctx.db, user.id) ?? DEFAULT_TARGETS;
      const days = trendDays(ctx.url.searchParams.get('days'));
      sendJson(ctx.res, 200, {
        ...dayFor(ctx, user.id, date, zone),
        today,
        glassMl: glassVolumeMl(targets.units),
        targets,
        weight: personalWeight(ctx.db, user.id, today),
        trends: buildTrendSeries(ctx.db, user.id, date, days),
      });
    }),
    route('GET', '/api/family', familyBoard),
  ];
}

function familyBoard(ctx: Ctx): Promise<void> {
  requireReader(ctx.auth);
  const zone = householdZone(ctx);
  const today = todayLocal(zone);
  const date = readLocalDate(ctx.url.searchParams.get('date'), zone);
  const household = ctx.db.prepare('SELECT name FROM household WHERE id = 1').get() as { name: string } | undefined;
  const board = toFamilyBoard({
    date,
    today,
    householdName: household?.name ?? 'Household',
    dateFormat: readerDateFormat(ctx.auth, ctx.db),
    members: listUsers(ctx.db).map((user) => familyMemberFor(ctx, user.id, date, zone)),
  });
  sendJson(ctx.res, 200, board);
  return Promise.resolve();
}

function trendDays(value: string | null): number {
  const days = finiteNumber(value);
  return days === null ? 7 : days;
}

function familyMemberFor(ctx: Ctx, userId: string, date: string, zone: string) {
  const day = dayFor(ctx, userId, date, zone);
  const targets = getTargets(ctx.db, userId) ?? DEFAULT_TARGETS;
  return {
    ...day,
    insights: buildMemberInsights(ctx.db, userId, targets, date, zone, day.totals),
  };
}

function dayFor(ctx: Ctx, userId: string, date: string, zone: string) {
  const logs = listMeals(ctx.db, userId, date, zone);
  const hydration = listHydration(ctx.db, userId, date, zone);
  const user = listUsers(ctx.db).find((person) => person.id === userId);
  const targets = getTargets(ctx.db, userId) ?? DEFAULT_TARGETS;
  return {
    user: user ?? { id: userId, name: 'Someone', role: 'member' as const },
    units: targets.units,
    targets: {
      calories: targets.calories,
      protein: targets.protein,
      fiber: targets.fiber,
      hydrationMl: targets.hydrationMl,
      units: targets.units,
    },
    date,
    totals: dayTotals(logs, hydrationTotal(hydration)),
    logs,
    hydration,
  };
}

function readerDateFormat(auth: Auth, db: Parameters<typeof getTargets>[0]): DateFormat {
  if (auth.kind !== 'user') return DEFAULT_DATE_FORMAT;
  return getTargets(db, auth.user.id)?.dateFormat ?? DEFAULT_DATE_FORMAT;
}
