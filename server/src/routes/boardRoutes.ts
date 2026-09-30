import { hydrationTotal, listHydration, listMeals } from '../db/logs.js';
import { getTargets, listUsers } from '../db/users.js';
import { glassVolumeMl } from '../domain/units.js';
import { dayTotals } from '../domain/day.js';
import { toFamilyBoard } from '../domain/familyView.js';
import { DEFAULT_TARGETS } from '../domain/nutrients.js';
import { readLocalDate, todayLocal } from '../domain/time.js';
import { requireReader, requireUser } from '../http/access.js';
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
    members: listUsers(ctx.db).map((user) => dayFor(ctx, user.id, date, zone)),
  });
  sendJson(ctx.res, 200, board);
  return Promise.resolve();
}

function trendDays(value: string | null): number {
  const days = finiteNumber(value);
  return days === null ? 7 : days;
}

function dayFor(ctx: Ctx, userId: string, date: string, zone: string) {
  const logs = listMeals(ctx.db, userId, date, zone);
  const hydration = listHydration(ctx.db, userId, date, zone);
  const user = listUsers(ctx.db).find((person) => person.id === userId);
  const targets = getTargets(ctx.db, userId) ?? DEFAULT_TARGETS;
  return {
    user: user ?? { id: userId, name: 'Someone', role: 'member' as const },
    units: targets.units,
    date,
    totals: dayTotals(logs, hydrationTotal(hydration)),
    logs,
    hydration,
  };
}
