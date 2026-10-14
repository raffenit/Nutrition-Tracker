import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database.js';

export type WeightUnit = 'lb' | 'kg';

export type WeightPreference = {
  enabled: boolean;
  weekday: number;
  unit: WeightUnit;
};

export type WeightEntry = {
  id: string;
  localDate: string;
  weight: number;
  unit: WeightUnit;
};

const DISABLED: WeightPreference = { enabled: false, weekday: 1, unit: 'lb' };

export function getWeightPreference(db: AppDatabase, userId: string): WeightPreference {
  const row = db.prepare(
    'SELECT enabled, weekday, unit FROM weight_preferences WHERE user_id = ?',
  ).get(userId) as { enabled: number; weekday: number; unit: WeightUnit } | undefined;
  if (!row) return DISABLED;
  return { enabled: row.enabled === 1, weekday: row.weekday, unit: row.unit };
}

export function saveWeightPreference(db: AppDatabase, userId: string, preference: WeightPreference): void {
  db.prepare(
    `INSERT INTO weight_preferences (user_id, enabled, weekday, unit)
     VALUES (@userId, @enabled, @weekday, @unit)
     ON CONFLICT(user_id) DO UPDATE SET
       enabled = excluded.enabled,
       weekday = excluded.weekday,
       unit = excluded.unit`,
  ).run({
    userId,
    enabled: preference.enabled ? 1 : 0,
    weekday: preference.weekday,
    unit: preference.unit,
  });
}

export function listWeightEntries(db: AppDatabase, userId: string): WeightEntry[] {
  const rows = db.prepare(
    `SELECT id, local_date, weight, unit FROM weight_entries
     WHERE user_id = ? ORDER BY local_date DESC LIMIT 52`,
  ).all(userId) as Array<{ id: string; local_date: string; weight: number; unit: WeightUnit }>;
  return rows.map(toWeightEntry);
}

export function listWeightEntriesInRange(
  db: AppDatabase,
  userId: string,
  fromDate: string,
  toDate: string,
): WeightEntry[] {
  const rows = db.prepare(
    `SELECT id, local_date, weight, unit FROM weight_entries
     WHERE user_id = ? AND local_date >= ? AND local_date <= ?
     ORDER BY local_date ASC`,
  ).all(userId, fromDate, toDate) as Array<{ id: string; local_date: string; weight: number; unit: WeightUnit }>;
  return rows.map(toWeightEntry);
}

export function deleteWeightEntry(db: AppDatabase, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM weight_entries WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function updateWeightEntry(
  db: AppDatabase,
  userId: string,
  id: string,
  patch: { weight?: number; localDate?: string },
): boolean {
  const row = db.prepare(
    'SELECT id FROM weight_entries WHERE id = ? AND user_id = ?',
  ).get(id, userId) as { id: string } | undefined;
  if (!row) return false;
  if (patch.weight !== undefined) {
    if (patch.weight <= 0) return false;
    db.prepare('UPDATE weight_entries SET weight = ? WHERE id = ?').run(patch.weight, id);
  }
  if (patch.localDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.localDate)) return false;
    db.prepare('UPDATE weight_entries SET local_date = ? WHERE id = ?').run(patch.localDate, id);
  }
  return true;
}

function toWeightEntry(row: { id: string; local_date: string; weight: number; unit: WeightUnit }): WeightEntry {
  return {
    id: row.id,
    localDate: row.local_date,
    weight: row.weight,
    unit: row.unit,
  };
}

export function latestWeightDate(db: AppDatabase, userId: string): string | null {
  const row = db.prepare(
    'SELECT local_date FROM weight_entries WHERE user_id = ? ORDER BY local_date DESC LIMIT 1',
  ).get(userId) as { local_date: string } | undefined;
  return row?.local_date ?? null;
}

export function insertWeightEntry(
  db: AppDatabase,
  userId: string,
  entry: { localDate: string; weight: number; unit: WeightUnit },
): void {
  db.prepare(
    `INSERT INTO weight_entries (id, user_id, local_date, weight, unit, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), userId, entry.localDate, entry.weight, entry.unit, new Date().toISOString());
}

export function deleteWeightHistory(db: AppDatabase, userId: string): void {
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM weight_entries WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM weight_dismissals WHERE user_id = ?').run(userId);
  });
  remove();
}

export function dismissWeightWeek(db: AppDatabase, userId: string, weekKey: string): void {
  db.prepare(
    `INSERT INTO weight_dismissals (user_id, week_key) VALUES (?, ?)
     ON CONFLICT(user_id, week_key) DO NOTHING`,
  ).run(userId, weekKey);
}

export function dismissedWeek(db: AppDatabase, userId: string, weekKey: string): boolean {
  const row = db.prepare(
    'SELECT 1 AS found FROM weight_dismissals WHERE user_id = ? AND week_key = ?',
  ).get(userId, weekKey) as { found: number } | undefined;
  return Boolean(row);
}
