import assert from 'node:assert/strict';
import test from 'node:test';
import { dayGoalsMet, hasActiveGoals } from './familyInsights.js';
import { DEFAULT_TARGETS } from './nutrients.js';
import type { DayTotals, Targets } from '../types.js';

const emptyDay: DayTotals = {
  calories: 0,
  protein: 0,
  fiber: 0,
  fat: 0,
  carbs: 0,
  sodium: 0,
  extras: [],
  hydrationMl: 0,
  shares: { protein: 0, fat: 0, carbs: 0 },
};

test('dayGoalsMet requires every active target to be reached', () => {
  const targets = sparseTargets({ calories: 2000, protein: 100, hydrationMl: 2000 });
  assert.equal(hasActiveGoals(targets), true);
  assert.equal(dayGoalsMet({ ...emptyDay, calories: 2000, protein: 99, hydrationMl: 2000 }, targets), false);
  assert.equal(dayGoalsMet({ ...emptyDay, calories: 2000, protein: 100, hydrationMl: 2000 }, targets), true);
});

test('dayGoalsMet ignores unset targets', () => {
  const targets = sparseTargets({ protein: 80 });
  assert.equal(dayGoalsMet({ ...emptyDay, protein: 80 }, targets), true);
});

test('dayGoalsMet honors sodium and carb limits', () => {
  const limits = sparseTargets({
    carbs: 175,
    carbsIsLimit: true,
    sodium: 1500,
    sodiumIsLimit: true,
  });
  assert.equal(dayGoalsMet({ ...emptyDay, carbs: 176, sodium: 1400 }, limits), false);
  assert.equal(dayGoalsMet({ ...emptyDay, carbs: 170, sodium: 1600 }, limits), false);
  assert.equal(dayGoalsMet({ ...emptyDay, carbs: 170, sodium: 1400 }, limits), true);
});

test('dayGoalsMet is false when no goals are configured', () => {
  const unset = sparseTargets({});
  assert.equal(hasActiveGoals(unset), false);
  assert.equal(dayGoalsMet({ ...emptyDay, calories: 5000 }, unset), false);
});

function sparseTargets(patch: Partial<Targets>): Targets {
  return {
    ...DEFAULT_TARGETS,
    calories: 0,
    protein: 0,
    fiber: 0,
    fat: 0,
    carbs: 0,
    sodium: null,
    sodiumIsLimit: false,
    carbsIsLimit: false,
    hydrationMl: 0,
    extras: [],
    ...patch,
  };
}
