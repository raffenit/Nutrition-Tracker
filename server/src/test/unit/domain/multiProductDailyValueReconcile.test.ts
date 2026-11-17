import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileAmountWithDailyValue, repairTrailingNineAgainstLabelMath } from '../../../domain/parseMultiProductLabelTable.js';

test('a "g" read as a trailing 9 is undone when the printed %DV confirms it', () => {
  assert.equal(reconcileAmountWithDailyValue('459 23%', 20), 4.5);
  assert.equal(reconcileAmountWithDailyValue('29 10%', 20), 2);
  assert.equal(reconcileAmountWithDailyValue('259 13%', 20), 2.5);
  assert.equal(reconcileAmountWithDailyValue('79 35%', 20), 7);
});

test('amounts that already match their %DV are kept', () => {
  assert.equal(reconcileAmountWithDailyValue('19 7%', 275), 19);
  assert.equal(reconcileAmountWithDailyValue('9g 12%', 78), 9);
  assert.equal(reconcileAmountWithDailyValue('140', 78), null);
});

test('rows without %DV drop a trailing 9 only when the label math demands it', () => {
  const n = { calories: 80, fat: 3, carbs: 129, fiber: 99, protein: 1, sodium: 25, extras: [{ key: 'sugar', label: 'Total sugars', amount: 109, unit: 'g' }] };
  repairTrailingNineAgainstLabelMath(n);
  assert.equal(n.carbs, 12);
  assert.equal(n.fiber, 9);
  assert.equal(n.extras[0]!.amount, 10);
  const ok = { calories: 170, fat: 9, carbs: 19, fiber: 1, protein: 3, sodium: 45, extras: [] };
  repairTrailingNineAgainstLabelMath(ok);
  assert.equal(ok.carbs, 19);
});
