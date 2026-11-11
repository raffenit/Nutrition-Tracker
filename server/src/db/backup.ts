import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './database.js';
import { checkpointDatabaseWal } from './persistence.js';
import { countUsers } from './users.js';

export const LAST_BACKUP_META_FILE = '.last-backup.json';

export type LastBackupMeta = {
  at: string;
  path: string;
};

export function readAutoBackupIntervalHours(): number {
  const raw = process.env.DATA_AUTO_BACKUP_HOURS?.trim();
  if (raw === '' || raw === '0' || raw === 'off') return 0;
  const value = Number(raw ?? '24');
  if (!Number.isFinite(value) || value < 0) return 24;
  return value;
}

export function readBackupKeepCount(): number {
  const value = Number(process.env.DATA_BACKUP_KEEP_COUNT ?? '14');
  if (!Number.isFinite(value) || value < 1) return 14;
  return Math.floor(value);
}

export function resolveBackupDir(dataDir: string): string {
  const custom = process.env.DATA_BACKUP_DIR?.trim();
  if (custom) return custom;
  return path.join(dataDir, 'backups');
}

function backupFileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function pruneOldBackups(backupDir: string, keepCount: number): void {
  const files = readdirSync(backupDir)
    .filter((name) => name.startsWith('nutrition-') && name.endsWith('.sqlite'))
    .map((name) => path.join(backupDir, name))
    .sort((a, b) => b.localeCompare(a));
  for (const file of files.slice(keepCount)) {
    unlinkSync(file);
  }
}

export function writeLastBackupMeta(dataDir: string, meta: LastBackupMeta): void {
  writeFileSync(path.join(dataDir, LAST_BACKUP_META_FILE), `${JSON.stringify(meta)}\n`, 'utf8');
}

export function readLastBackupMeta(dataDir: string): LastBackupMeta | null {
  try {
    const raw = readFileSync(path.join(dataDir, LAST_BACKUP_META_FILE), 'utf8');
    const parsed = JSON.parse(raw) as LastBackupMeta;
    if (typeof parsed.at !== 'string' || typeof parsed.path !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function runDatabaseBackup(db: AppDatabase, dataDir: string): Promise<string> {
  const backupDir = resolveBackupDir(dataDir);
  mkdirSync(backupDir, { recursive: true });
  const dest = path.join(backupDir, `nutrition-${backupFileStamp()}.sqlite`);
  checkpointDatabaseWal(db, 'TRUNCATE');
  await db.backup(dest);
  pruneOldBackups(backupDir, readBackupKeepCount());
  writeLastBackupMeta(dataDir, { at: new Date().toISOString(), path: dest });
  return dest;
}

export function scheduleDatabaseBackups(
  db: AppDatabase,
  dataDir: string,
  intervalHours: number,
  onResult: (line: string) => void,
): void {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return;
  const ms = intervalHours * 60 * 60 * 1000;

  const run = (): void => {
    void (async () => {
      try {
        if (countUsers(db) === 0) return;
        const dest = await runDatabaseBackup(db, dataDir);
        onResult(`backup ok ${dest}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onResult(`backup FAILED: ${message}`);
        console.error('Scheduled database backup failed', error);
      }
    })();
  };

  const initialDelayMs = Math.min(5 * 60 * 1000, ms);
  const initial = setTimeout(() => {
    run();
    const timer = setInterval(run, ms);
    timer.unref();
  }, initialDelayMs);
  initial.unref();
}
