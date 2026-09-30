import { randomUUID } from 'node:crypto';
import type { Role, Targets, UserPublic } from '../types.js';
import { parseDateFormat } from '../domain/dateFormat.js';
import { parseStoredExtras } from '../domain/nutrients.js';
import type { AppDatabase } from './database.js';

export type UserRecord = UserPublic & { passwordHash: string };

type UserSql = {
  id: string;
  name: string;
  password_hash: string;
  role: Role;
};

type TargetSql = {
  calories: number;
  protein: number;
  fiber: number;
  fat: number;
  carbs: number;
  sodium: number | null;
  sodium_is_limit: number;
  carbs_is_limit: number;
  hydration_ml: number;
  units: 'metric' | 'imperial' | null;
  date_format: string | null;
  extras_json: string;
};

export type HouseholdRecord = {
  name: string;
  timezone: string;
  kioskTokenHash: string | null;
};

export function countUsers(db: AppDatabase): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

export function insertUser(db: AppDatabase, name: string, passwordHash: string, role: Role): UserRecord {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, name, password_hash, role, created_at)
     VALUES (@id, @name, @passwordHash, @role, @createdAt)`,
  ).run({ id, name, passwordHash, role, createdAt: new Date().toISOString() });
  return { id, name, role, passwordHash };
}

export function findUserByName(db: AppDatabase, name: string): UserRecord | null {
  const row = db.prepare('SELECT id, name, password_hash, role FROM users WHERE name = ?').get(name) as UserSql | undefined;
  return row ? toUser(row) : null;
}

export function findUserById(db: AppDatabase, id: string): UserRecord | null {
  const row = db.prepare('SELECT id, name, password_hash, role FROM users WHERE id = ?').get(id) as UserSql | undefined;
  return row ? toUser(row) : null;
}

export function listUsers(db: AppDatabase): UserPublic[] {
  const rows = db.prepare('SELECT id, name, password_hash, role FROM users ORDER BY name COLLATE NOCASE').all() as UserSql[];
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
}

export function deleteUser(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function countAdmins(db: AppDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin'`).get() as { count: number };
  return row.count;
}

export function saveHousehold(db: AppDatabase, name: string, timezone: string): void {
  db.prepare(
    `INSERT INTO household (id, name, timezone, kiosk_token_hash)
     VALUES (1, @name, @timezone, NULL)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, timezone = excluded.timezone`,
  ).run({ name, timezone });
}

export function getHousehold(db: AppDatabase): HouseholdRecord | null {
  const row = db.prepare('SELECT name, timezone, kiosk_token_hash FROM household WHERE id = 1').get() as
    | { name: string; timezone: string; kiosk_token_hash: string | null }
    | undefined;
  if (!row) return null;
  return { name: row.name, timezone: row.timezone, kioskTokenHash: row.kiosk_token_hash };
}

export function saveKioskHash(db: AppDatabase, hash: string): void {
  db.prepare('UPDATE household SET kiosk_token_hash = ? WHERE id = 1').run(hash);
}

export function saveTargets(db: AppDatabase, userId: string, targets: Targets): void {
  db.prepare(
    `INSERT INTO targets (user_id, calories, protein, fiber, fat, carbs, sodium, sodium_is_limit, carbs_is_limit, hydration_ml, units, date_format, extras_json)
     VALUES (@userId, @calories, @protein, @fiber, @fat, @carbs, @sodium, @sodiumIsLimit, @carbsIsLimit, @hydrationMl, @units, @dateFormat, @extras)
     ON CONFLICT(user_id) DO UPDATE SET
       calories = excluded.calories,
       protein = excluded.protein,
       fiber = excluded.fiber,
       fat = excluded.fat,
       carbs = excluded.carbs,
       sodium = excluded.sodium,
       sodium_is_limit = excluded.sodium_is_limit,
       carbs_is_limit = excluded.carbs_is_limit,
       hydration_ml = excluded.hydration_ml,
       units = excluded.units,
       date_format = excluded.date_format,
       extras_json = excluded.extras_json`,
  ).run({ userId, ...targetParams(targets) });
}

export function getTargets(db: AppDatabase, userId: string): Targets | null {
  const row = db.prepare(
    `SELECT calories, protein, fiber, fat, carbs, sodium, sodium_is_limit, carbs_is_limit, hydration_ml, units, date_format, extras_json
     FROM targets WHERE user_id = ?`,
  ).get(userId) as TargetSql | undefined;
  if (!row) return null;
  return {
    calories: row.calories,
    protein: row.protein,
    fiber: row.fiber,
    fat: row.fat,
    carbs: row.carbs,
    sodium: row.sodium,
    sodiumIsLimit: (row.sodium_is_limit ?? 0) === 1,
    carbsIsLimit: (row.carbs_is_limit ?? 0) === 1,
    hydrationMl: row.hydration_ml,
    units: row.units === 'metric' ? 'metric' : 'imperial',
    dateFormat: parseDateFormat(row.date_format ?? undefined),
    extras: parseStoredExtras(row.extras_json),
  };
}

function targetParams(targets: Targets): Record<string, string | number | null> {
  return {
    calories: targets.calories,
    protein: targets.protein,
    fiber: targets.fiber,
    fat: targets.fat,
    carbs: targets.carbs,
    sodium: targets.sodium,
    sodiumIsLimit: targets.sodiumIsLimit ? 1 : 0,
    carbsIsLimit: targets.carbsIsLimit ? 1 : 0,
    hydrationMl: targets.hydrationMl,
    units: targets.units,
    dateFormat: targets.dateFormat,
    extras: JSON.stringify(targets.extras),
  };
}

function toUser(row: UserSql): UserRecord {
  return { id: row.id, name: row.name, role: row.role, passwordHash: row.password_hash };
}
