import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyNutrients, macroShares } from './nutrients.js';
import { assertFamilyBoardIsPublic, toFamilyBoard } from './familyView.js';
import { weightReminderDue } from './weight.js';

const totals = { ...emptyNutrients(), hydrationMl: 0, shares: macroShares(emptyNutrients()) };

test('family view drops weight even if a personal record is passed in', () => {
  const board = toFamilyBoard({
    date: '2026-09-29',
    today: '2026-09-29',
    householdName: 'Home',
    dateFormat: 'mdy_long',
    members: [
      {
        user: { id: 'u1', name: 'Rachael', role: 'admin' },
        units: 'imperial' as const,
        targets: { calories: 2000, protein: 100, fiber: 25, hydrationMl: 2000, units: 'imperial' as const },
        totals,
        logs: [],
        hydration: [],
        insights: {
          hasGoals: true,
          goalDays: { met: 0, daysInMonth: 29, monthLabel: 'September 2026' },
          usualMealTimes: [],
          selectedDayMetGoals: false,
        },
        weight: { entries: [{ weight: 187.4, unit: 'lb' }] },
      },
    ],
  });

  assert.equal('weight' in board.members[0], false);
  assert.equal(JSON.stringify(board).includes('187.4'), false);
});

test('family view rejects a payload that still has a weight field', () => {
  assert.throws(() => assertFamilyBoardIsPublic({ members: [], weight: 150 }), /weight/);
});

test('weekly weight reminder stays off unless that person opted in', () => {
  const today = '2026-09-28';
  assert.equal(weightReminderDue({
    enabled: false,
    weekday: 1,
    today,
    loggedWeekKey: null,
    dismissedWeekKey: null,
  }), false);
});

test('weekly weight reminder shows only on the chosen day for that person', () => {
  assert.equal(weightReminderDue({
    enabled: true,
    weekday: 1,
    today: '2026-09-28',
    loggedWeekKey: null,
    dismissedWeekKey: null,
  }), true);
  assert.equal(weightReminderDue({
    enabled: true,
    weekday: 1,
    today: '2026-09-29',
    loggedWeekKey: null,
    dismissedWeekKey: null,
  }), false);
});
