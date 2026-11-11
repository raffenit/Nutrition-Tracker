import type { AppDatabase } from './database.js';
import { readHouseholdMarker } from './householdState.js';
import { countUsers } from './users.js';

export type PersistenceIssue =
  | { kind: 'integrity'; detail: string }
  | { kind: 'marker_without_users' };

export function verifyHouseholdPersistence(db: AppDatabase, dataDir: string): PersistenceIssue | null {
  const integrity = db.pragma('integrity_check', { simple: true }) as string;
  if (integrity !== 'ok') {
    return { kind: 'integrity', detail: integrity };
  }
  if (readHouseholdMarker(dataDir) && countUsers(db) === 0) {
    return { kind: 'marker_without_users' };
  }
  return null;
}

/** Merge WAL into the main DB file when possible (helps after unclean shutdown). */
export function checkpointDatabaseWal(db: AppDatabase, mode: 'PASSIVE' | 'RESTART' | 'TRUNCATE' = 'RESTART'): void {
  db.pragma(`wal_checkpoint(${mode})`);
}

export function persistenceIssueAllowsStart(issue: PersistenceIssue): boolean {
  if (issue.kind === 'marker_without_users') {
    return process.env.ALLOW_EMPTY_HOUSEHOLD === '1';
  }
  return process.env.ALLOW_CORRUPT_DB === '1';
}

export function scheduleWalCheckpoints(db: AppDatabase, intervalMinutes: number): void {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return;
  const ms = intervalMinutes * 60_000;
  const timer = setInterval(() => {
    try {
      checkpointDatabaseWal(db, 'PASSIVE');
    } catch (error) {
      console.error('Periodic WAL checkpoint failed', error);
    }
  }, ms);
  timer.unref();
}

export function readWalCheckpointIntervalMinutes(): number {
  const raw = process.env.DATA_WAL_CHECKPOINT_MINUTES?.trim();
  if (raw === '' || raw === '0' || raw === 'off') return 0;
  const value = Number(raw ?? '5');
  if (!Number.isFinite(value) || value < 0) return 5;
  return value;
}
