import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from './database.js';
import { countUsers } from './users.js';

export const HOUSEHOLD_MARKER_FILE = '.household-established.json';

export type HouseholdMarker = {
  establishedAt: string;
  userCount: number;
};

export function householdMarkerPath(dataDir: string): string {
  return path.join(dataDir, HOUSEHOLD_MARKER_FILE);
}

export function readHouseholdMarker(dataDir: string): HouseholdMarker | null {
  try {
    const raw = readFileSync(householdMarkerPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as HouseholdMarker;
    if (typeof parsed.establishedAt !== 'string' || typeof parsed.userCount !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function syncHouseholdMarker(dataDir: string, db: AppDatabase): HouseholdMarker | null {
  const userCount = countUsers(db);
  if (userCount === 0) return null;
  const marker: HouseholdMarker = { establishedAt: new Date().toISOString(), userCount };
  const target = householdMarkerPath(dataDir);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(marker)}\n`, 'utf8');
  renameSync(temp, target);
  return marker;
}
