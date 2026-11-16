import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCalorieRowCellsForStitch,
  pickPlausibleCalorieFromHeaderColumnOcr,
  pickPlausibleCalorieFromValueColumnPreamble,
  shouldUseHeaderColumnCalories,
} from '../../../domain/sharedLabelHeaderCalories.js';

test('pickPlausibleCalorieFromHeaderColumnOcr reads display calories from full header stack', () => {
  assert.equal(pickPlausibleCalorieFromHeaderColumnOcr('KIT KAT®\nVaries\n2 Packs (28g)\n170'), '170');
  assert.equal(pickPlausibleCalorieFromHeaderColumnOcr('Product\nAmount per serving\n90'), '90');
  assert.equal(pickPlausibleCalorieFromHeaderColumnOcr('Only words'), '');
});

test('shouldUseHeaderColumnCalories needs two plausible columns', () => {
  assert.equal(shouldUseHeaderColumnCalories(['170', '250']), true);
  assert.equal(shouldUseHeaderColumnCalories(['2 Packs (28g)', '1 Bar (17g)']), false);
});

test('buildCalorieRowCellsForStitch ignores % Daily Value body lines', () => {
  const values = ['% Daily Value*\n19 9%\n4g 5%', '% Daily Value*\n4g 5%\n40mg 2%'];
  assert.equal(pickPlausibleCalorieFromValueColumnPreamble(values[0]!), '');
  const headers = ['KIT KAT\nVaries\n140', 'SNICKERS\nVaries\n80'];
  const row = buildCalorieRowCellsForStitch(values, headers);
  assert.deepEqual(row, ['140', '80']);
});