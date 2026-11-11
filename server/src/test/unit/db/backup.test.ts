import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pruneOldBackups, readAutoBackupIntervalHours, resolveBackupDir } from '../../../db/backup.js';

test('readAutoBackupIntervalHours defaults and disables', () => {
  const prev = process.env.DATA_AUTO_BACKUP_HOURS;
  process.env.DATA_AUTO_BACKUP_HOURS = '';
  assert.equal(readAutoBackupIntervalHours(), 0);
  delete process.env.DATA_AUTO_BACKUP_HOURS;
  assert.equal(readAutoBackupIntervalHours(), 24);
  process.env.DATA_AUTO_BACKUP_HOURS = 'off';
  assert.equal(readAutoBackupIntervalHours(), 0);
  if (prev === undefined) delete process.env.DATA_AUTO_BACKUP_HOURS;
  else process.env.DATA_AUTO_BACKUP_HOURS = prev;
});

test('resolveBackupDir uses data/backups by default', () => {
  assert.equal(resolveBackupDir('/data'), path.join('/data', 'backups'));
});

test('pruneOldBackups keeps newest files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nt-backup-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'nutrition-2026-01-01T00-00-00-000Z.sqlite'), 'a');
    writeFileSync(path.join(dir, 'nutrition-2026-01-02T00-00-00-000Z.sqlite'), 'b');
    writeFileSync(path.join(dir, 'nutrition-2026-01-03T00-00-00-000Z.sqlite'), 'c');
    pruneOldBackups(dir, 2);
    const remaining = readdirSync(dir).filter((n) => n.endsWith('.sqlite')).sort();
    assert.deepEqual(remaining, ['nutrition-2026-01-02T00-00-00-000Z.sqlite', 'nutrition-2026-01-03T00-00-00-000Z.sqlite']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
