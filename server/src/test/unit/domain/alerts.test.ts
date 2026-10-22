import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGoalAlerts } from '../../../domain/alerts.js';
import { DEFAULT_TARGETS } from '../../../domain/nutrients.js';
import type { DayTotals } from '../../../types.js';

const baseTotals = (): DayTotals => ({
  calories: 0,
  protein: 0,
  fiber: 0,
  fat: 0,
  carbs: 0,
  sodium: 0,
  extras: [],
  hydrationMl: 0,
  shares: { protein: 0, fat: 0, carbs: 0 },
});

test('buildGoalAlerts warns near calories and hard over', () => {
  const targets = { ...DEFAULT_TARGETS, calories: 2000 };
  const near = buildGoalAlerts({ ...baseTotals(), calories: 1850 }, targets, new Set());
  assert.ok(near.some((alert) => alert.id === 'calories-soft'));
  const over = buildGoalAlerts({ ...baseTotals(), calories: 2100 }, targets, new Set());
  assert.ok(over.some((alert) => alert.id === 'calories-hard'));
  assert.equal(over.find((alert) => alert.id === 'calories-hard')?.dismissible, false);
});

test('buildGoalAlerts respects dismissals for soft alerts', () => {
  const targets = { ...DEFAULT_TARGETS, calories: 2000 };
  const alerts = buildGoalAlerts({ ...baseTotals(), calories: 1850 }, targets, new Set(['calories-soft']));
  assert.equal(alerts.some((alert) => alert.id === 'calories-soft'), false);
});

test('buildGoalAlerts celebrates protein goal', () => {
  const targets = { ...DEFAULT_TARGETS, protein: 100 };
  const alerts = buildGoalAlerts({ ...baseTotals(), protein: 100 }, targets, new Set());
  assert.ok(alerts.some((alert) => alert.id === 'protein-celebration'));
});
