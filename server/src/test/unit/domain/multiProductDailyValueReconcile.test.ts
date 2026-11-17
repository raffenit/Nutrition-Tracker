import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCellDigits, realignShiftedColumns, reconcileAmountWithDailyValue, repairTrailingNineAgainstLabelMath } from '../../../domain/parseMultiProductLabelTable.js';

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

test('I / l read for 1 next to digits or a unit', () => {
  assert.equal(normalizeCellDigits('Ilg 4%'), '11g 4%');
  assert.equal(normalizeCellDigits('<lg 3%'), '<1g 3%');
  assert.equal(normalizeCellDigits('Ig 4%'), '1g 4%');
  assert.equal(normalizeCellDigits('Iron'), 'Iron');
});

test('a lost half-gram decimal is restored only when the label math rules out the literal read', () => {
  const n = { calories: 80, fat: 35, carbs: 11, fiber: 0, protein: 0, sodium: 30, extras: [{ key: 'saturated_fat', label: 'Saturated fat', amount: 259, unit: 'g' }] };
  repairTrailingNineAgainstLabelMath(n);
  assert.equal(n.fat, 3.5);
  assert.equal(n.extras[0]!.amount, 2.5);
  const ok = { calories: 450, fat: 35, carbs: 10, fiber: 0, protein: 5, sodium: 0, extras: [] };
  repairTrailingNineAgainstLabelMath(ok);
  assert.equal(ok.fat, 35);
  const no = { calories: 80, fat: 34, carbs: 11, fiber: 0, protein: 0, sodium: 0, extras: [] };
  repairTrailingNineAgainstLabelMath(no);
  assert.equal(no.fat, 34);
});

test('added sugars cannot exceed total sugars', () => {
  const n = { calories: 170, fat: 7, carbs: 25, fiber: 0, protein: 1, sodium: 0, extras: [
    { key: 'sugar', label: 'Total sugars', amount: 15, unit: 'g' },
    { key: 'added_sugars', label: 'Added sugars', amount: 149, unit: 'g' },
  ] };
  repairTrailingNineAgainstLabelMath(n);
  assert.equal(n.extras[1]!.amount, 14);
});

test('O read for 0 next to digits or a mass unit', () => {
  assert.equal(normalizeCellDigits('10Omg 4%'), '100mg 4%');
  assert.equal(normalizeCellDigits('Omg 0%'), '0mg 0%');
  assert.equal(normalizeCellDigits('Oc 0%'), 'Oc 0%');
});

test('a column whose lower rows slid by one row is realigned by units and %DV', () => {
  const labels = ['total fat', 'saturated fat', 'cholesterol', 'sodium', 'total carbohydrate', 'dietary fiber', 'total sugars', 'includes added sugars'];
  const slidUp = ['9g 12%', '3g 15%', '100mg 4%', '18g 7%', '1g 4%', '16g', '15g 30%', '3g'];
  const slidDown = ['9g 12%', '7g 35%', '0mg 0%', '-', '45mg 2%', '20g 7%', '1g 4%', '16g'];
  const aligned = ['4g 5%', '2.5g 13%', '0mg 0%', '55mg 2%', '23g 8%', '0g 0%', '20g', '20g 40%'];
  const rows = labels.map((row, i) => ({ row, values: [slidUp[i]!, slidDown[i]!, aligned[i]!] }));
  realignShiftedColumns(rows, 3);
  const column = (c: number) => Object.fromEntries(rows.map((row) => [row.row, row.values[c]]));
  assert.deepEqual(column(0), {
    'total fat': '9g 12%', 'saturated fat': '3g 15%', cholesterol: '', sodium: '100mg 4%', 'total carbohydrate': '18g 7%',
    'dietary fiber': '1g 4%', 'total sugars': '16g', 'includes added sugars': '15g 30%', protein: '3g',
  });
  assert.equal(column(1).sodium, '45mg 2%');
  assert.equal(column(1)['total carbohydrate'], '20g 7%');
  assert.equal(column(1)['dietary fiber'], '1g 4%');
  assert.deepEqual(column(2), Object.fromEntries([...labels.map((row, i) => [row, aligned[i]]), ['protein', '']]));
});
