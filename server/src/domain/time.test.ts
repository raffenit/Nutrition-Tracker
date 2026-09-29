import assert from 'node:assert/strict';
import test from 'node:test';
import { localDate, zonedToUtc } from './time.js';

test('converts Chicago wall time to UTC during daylight saving', () => {
  const iso = zonedToUtc('2026-09-29T18:30', 'America/Chicago');
  assert.equal(iso, '2026-09-29T23:30:00.000Z');
});

test('converts Chicago wall time to UTC in winter', () => {
  const iso = zonedToUtc('2026-01-15T18:30', 'America/Chicago');
  assert.equal(iso, '2026-01-16T00:30:00.000Z');
});

test('keeps the household date when UTC has already rolled over', () => {
  const date = localDate('2026-09-30T03:30:00.000Z', 'America/Chicago');
  assert.equal(date, '2026-09-29');
});
