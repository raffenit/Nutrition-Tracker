import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase } from '../../../db/database.js';
import { householdMarkerPath, readHouseholdMarker, syncHouseholdMarker } from '../../../db/householdState.js';
import { insertUser } from '../../../db/users.js';
import { hashPassword } from '../../../auth/passwords.js';

test('syncHouseholdMarker writes marker when users exist', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nt-marker-'));
  const db = openDatabase(path.join(dir, 'nutrition.sqlite'));
  try {
    assert.equal(readHouseholdMarker(dir), null);
    insertUser(db, 'Rachael', hashPassword('pw-test-12'), 'admin');
    const marker = syncHouseholdMarker(dir, db);
    assert.ok(marker);
    assert.equal(marker?.userCount, 1);
    const onDisk = JSON.parse(readFileSync(householdMarkerPath(dir), 'utf8')) as { userCount: number };
    assert.equal(onDisk.userCount, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
