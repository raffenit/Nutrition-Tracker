import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileAmountWithDailyValue } from '../../../domain/parseMultiProductLabelTable.js';

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
