import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PersistenceIssue } from '../db/persistence.js';
import { householdMarkerPath, HOUSEHOLD_MARKER_FILE } from '../db/householdState.js';

export const STARTUP_FAILURE_FILE = 'last-startup-failure.txt';
export const RUNTIME_EVENTS_FILE = 'nutrition-events.log';

export type StartupPaths = {
  dataDir: string;
  databasePath: string;
};

function failureFilePath(dataDir: string): string {
  return path.join(dataDir, STARTUP_FAILURE_FILE);
}

function eventsLogPath(dataDir: string): string {
  return path.join(dataDir, RUNTIME_EVENTS_FILE);
}

function stamp(): string {
  return new Date().toISOString();
}

function persistReport(dataDir: string, report: string): void {
  try {
    writeFileSync(failureFilePath(dataDir), `${report}\n`, 'utf8');
  } catch (error) {
    console.error(`Could not write ${failureFilePath(dataDir)}`, error);
  }
}

function appendEvent(dataDir: string, line: string): void {
  try {
    appendFileSync(eventsLogPath(dataDir), `${stamp()} ${line}\n`, 'utf8');
  } catch {
    // dataDir may not exist yet
  }
}

export function appendRuntimeEvent(dataDir: string, message: string): void {
  appendEvent(dataDir, message);
}

export function buildPersistenceRefusalReport(issue: PersistenceIssue, paths: StartupPaths): string {
  const markerPath = householdMarkerPath(paths.dataDir);
  const header = 'NUTRITION TRACKER REFUSED TO START';
  const divider = '='.repeat(header.length);

  if (issue.kind === 'marker_without_users') {
    return [
      header,
      divider,
      '',
      'REASON: Household data appears to be MISSING',
      '',
      'This install previously had accounts (marker file is present) but nutrition.sqlite',
      'currently has zero users. That usually means data/ is empty, pointed at the wrong',
      'folder, or nutrition.sqlite-wal was lost after a crash.',
      '',
      'PATHS ON THIS HOST:',
      `  Database:     ${paths.databasePath}`,
      `  Marker:       ${markerPath}`,
      `  Failure log:  ${failureFilePath(paths.dataDir)}`,
      '',
      'OPTION A — RESTORE FROM BACKUP (recommended)',
      '  1. Stop the app:  docker compose down',
      `  2. Restore files into: ${paths.dataDir}`,
      '     (nutrition.sqlite and siblings from scripts/backup-data.sh or a zip)',
      '  3. Start again:   ./deploy.sh --skip-git',
      '  4. Verify:        curl -s http://127.0.0.1:3010/api/health',
      '     (setupRequired should be false)',
      '',
      'OPTION B — START FRESH (you accept losing this household)',
      `  1. Stop the app:  docker compose down`,
      `  2. Delete or move: ${paths.dataDir}/nutrition.sqlite`,
      `                     ${paths.dataDir}/nutrition.sqlite-wal`,
      `                     ${paths.dataDir}/nutrition.sqlite-shm`,
      `  3. Delete marker:  ${markerPath}`,
      '  4. Start and open the app in the browser to run setup again',
      '',
      'OPTION C — OVERRIDE (only if you intentionally emptied the database)',
      '  Add to .env:  ALLOW_EMPTY_HOUSEHOLD=1',
      '  Redeploy:     ./deploy.sh --skip-git',
      '',
      'DOCKER LOGS:',
      '  docker compose logs nutrition --tail 80',
      '',
      `Doc: docs/playbooks/data-backup-recovery.md  (${HOUSEHOLD_MARKER_FILE})`,
      `Time (UTC): ${stamp()}`,
    ].join('\n');
  }

  return [
    header,
    divider,
    '',
    'REASON: Database integrity check FAILED',
    '',
    `SQLite reported: ${issue.detail}`,
    '',
      'PATHS ON THIS HOST:',
    `  Database:     ${paths.databasePath}`,
    `  Failure log:  ${failureFilePath(paths.dataDir)}`,
    '',
    'OPTION A — RESTORE FROM BACKUP',
    `  1. Stop the app, replace ${paths.databasePath} from backup, start again`,
    '',
    'OPTION B — RECOVERY ATTEMPT (advanced)',
    '  Add to .env:  ALLOW_CORRUPT_DB=1  then redeploy only if you are attempting repair',
    '',
    'DOCKER LOGS:',
    '  docker compose logs nutrition --tail 80',
    '',
    `Time (UTC): ${stamp()}`,
  ].join('\n');
}

export function buildBootFailureReport(title: string, detail: string, paths: StartupPaths): string {
  return [
    'NUTRITION TRACKER REFUSED TO START',
    '==================================',
    '',
    `REASON: ${title}`,
    '',
    detail,
    '',
    `  Database path: ${paths.databasePath}`,
    `  Data directory: ${paths.dataDir}`,
    `  Failure log: ${failureFilePath(paths.dataDir)}`,
    '',
    'DOCKER LOGS:',
    '  docker compose logs nutrition --tail 80',
    '',
    `Time (UTC): ${stamp()}`,
  ].join('\n');
}

export function emitStartupFailure(dataDir: string, report: string, eventSummary: string): void {
  persistReport(dataDir, report);
  appendEvent(dataDir, `REFUSED: ${eventSummary}`);
  console.error('\n' + report + '\n');
}
