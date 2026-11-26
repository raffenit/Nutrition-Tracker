import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import { openDatabase } from '../../../db/database.js';

/**
 * DBs created before the 'side' meal slot have a CHECK constraint that rejects
 * it. openDatabase must rebuild those tables in place — this seeds the old
 * schema, then verifies 'side' rows insert and existing rows survive.
 */
test('slot CHECK migration accepts side and preserves rows', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nt-side-slot-'));
  const file = path.join(dir, 'nutrition.sqlite');
  const seed = new Database(file);
  seed.pragma('foreign_keys = OFF');
  seed.exec(`
    CREATE TABLE meal_plan_entries (
      id TEXT PRIMARY KEY,
      week_start TEXT NOT NULL,
      local_date TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('meal', 'snack', 'dessert', 'drink')),
      food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
      servings REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE meal_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      food_id TEXT REFERENCES foods(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('meal', 'snack', 'dessert', 'drink')),
      eaten_at TEXT NOT NULL,
      local_date TEXT NOT NULL,
      servings REAL NOT NULL,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      fiber REAL NOT NULL,
      fat REAL NOT NULL,
      carbs REAL NOT NULL,
      sodium REAL NOT NULL,
      extras_json TEXT NOT NULL,
      drink_ml REAL,
      created_at TEXT NOT NULL,
      client_mutation_id TEXT
    );
    INSERT INTO meal_plan_entries (id, week_start, local_date, slot, food_id, servings)
      VALUES ('e1', '2026-01-05', '2026-01-06', 'meal', 'f1', 1);
    INSERT INTO meal_logs (id, user_id, name, slot, eaten_at, local_date, servings,
      calories, protein, fiber, fat, carbs, sodium, extras_json, created_at)
      VALUES ('l1', 'u1', 'Rice', 'meal', '2026-01-06T12:00:00.000Z', '2026-01-06', 1,
        200, 4, 1, 1, 40, 5, '{}', '2026-01-06T12:00:00.000Z');
  `);
  seed.close();

  const db = openDatabase(file);
  try {
    db.prepare(
      `INSERT INTO users (id, name, password_hash, role, created_at)
       VALUES ('u1', 'Plan Side', 'x', 'member', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO foods (id, created_by, name, kind, serving_label, calories, protein, fiber, fat, carbs, sodium, extras_json, source, created_at)
       VALUES ('f1', 'u1', 'Rice', 'packaged', '1 cup', 200, 4, 1, 1, 40, 5, '{}', 'manual', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO meal_plan_entries (id, week_start, local_date, slot, food_id, servings)
       VALUES ('e2', '2026-01-05', '2026-01-06', 'side', 'f1', 1)`,
    ).run();
    db.prepare(
      `INSERT INTO meal_logs (id, user_id, name, slot, eaten_at, local_date, servings,
        calories, protein, fiber, fat, carbs, sodium, extras_json, created_at)
       VALUES ('l2', 'u1', 'Slaw', 'side', '2026-01-06T12:30:00.000Z', '2026-01-06', 1,
        90, 1, 3, 6, 8, 300, '{}', '2026-01-06T12:30:00.000Z')`,
    ).run();

    const planRows = db.prepare(`SELECT id, slot FROM meal_plan_entries ORDER BY id`).all() as Array<{ id: string; slot: string }>;
    assert.deepEqual(planRows, [
      { id: 'e1', slot: 'meal' },
      { id: 'e2', slot: 'side' },
    ]);
    const logRows = db.prepare(`SELECT id, slot FROM meal_logs ORDER BY id`).all() as Array<{ id: string; slot: string }>;
    assert.deepEqual(logRows, [
      { id: 'l1', slot: 'meal' },
      { id: 'l2', slot: 'side' },
    ]);
    db.close();

    // Re-opening must not rebuild again or lose the new constraint.
    const reopened = openDatabase(file);
    try {
      reopened.prepare(
        `INSERT INTO meal_plan_entries (id, week_start, local_date, slot, food_id, servings)
         VALUES ('e3', '2026-01-05', '2026-01-07', 'side', 'f1', 1)`,
      ).run();
    } finally {
      reopened.close();
    }
  } finally {
    try { db.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
