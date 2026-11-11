import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../../../db/database.js';
import { householdMarkerPath } from '../../../db/householdState.js';
import { verifyHouseholdPersistence } from '../../../db/persistence.js';

test('verifyHouseholdPersistence flags marker without users', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nt-persist-'));
  const db = openDatabase(path.join(dir, 'nutrition.sqlite'));
  try {
    writeFileSync(householdMarkerPath(dir), JSON.stringify({ establishedAt: '2026-01-01T00:00:00.000Z', userCount: 1 }));
    const issue = verifyHouseholdPersistence(db, dir);
    assert.deepEqual(issue, { kind: 'marker_without_users' });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyHouseholdPersistence ok on empty install without marker', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nt-persist-'));
  const db = openDatabase(path.join(dir, 'nutrition.sqlite'));
  try {
    assert.equal(verifyHouseholdPersistence(db, dir), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
