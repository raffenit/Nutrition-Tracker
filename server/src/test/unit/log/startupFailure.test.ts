import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPersistenceRefusalReport } from '../../../log/startupFailure.js';

test('buildPersistenceRefusalReport lists restore and override steps', () => {
  const report = buildPersistenceRefusalReport(
    { kind: 'marker_without_users' },
    { dataDir: '/data', databasePath: '/data/nutrition.sqlite' },
  );
  assert.match(report, /REFUSED TO START/);
  assert.match(report, /OPTION A/);
  assert.match(report, /OPTION B/);
  assert.match(report, /ALLOW_EMPTY_HOUSEHOLD=1/);
  assert.match(report, /last-startup-failure\.txt/);
  assert.match(report, /nutrition\.sqlite-wal/);
});
