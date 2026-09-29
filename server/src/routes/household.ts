import type { AppConfig } from '../config.js';
import { getHousehold } from '../db/users.js';
import type { AppDatabase } from '../db/database.js';
import type { Ctx } from '../http/router.js';

export function householdZone(ctx: Ctx): string {
  return zoneFor(ctx.db, ctx.config);
}

export function zoneFor(db: AppDatabase, config: AppConfig): string {
  return getHousehold(db)?.timezone ?? config.timezone;
}
