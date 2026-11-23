import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCellDigits, parseMultiProductLabelTable, realignShiftedColumns, reconcileAmountWithDailyValue, repairTrailingNineAgainstLabelMath } from '../../../domain/parseMultiProductLabelTable.js';

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

test('calorie ceilings leave amounts that only round past them', () => {
  const n = { calories: 170, fat: 19, carbs: 49, fiber: 0, protein: 9, sodium: 0, extras: [] };
  repairTrailingNineAgainstLabelMath(n);
  assert.equal(n.fat, 19);
  assert.equal(n.carbs, 49);
});

test('protein %DV does not rewrite the gram amount', () => {
  const text = [
    'Nutrition Facts',
    'ALPHA BAR    BETA BAR',
    'Calories',
    '200  210',
    'Total Fat',
    '5g 6%  6g 8%',
    'Protein',
    '15g 3%  10g 20%',
  ].join('\n');
  const columns = parseMultiProductLabelTable(text);
  assert.ok(columns);
  assert.equal(columns[0]!.nutrients.protein, 15);
  assert.equal(columns[1]!.nutrients.protein, 10);
});

test('a "g" read as a trailing 0 is undone when the printed %DV confirms it', () => {
  assert.equal(reconcileAmountWithDailyValue('150 8%', 20), 1.5);
  assert.equal(reconcileAmountWithDailyValue('10g 4%', 275), 10);
  assert.equal(reconcileAmountWithDailyValue('40mg 2%', 2300), 40);
  assert.equal(reconcileAmountWithDailyValue('250 1%', 2300), 25);
});

test('T beside a 1-glyph before a unit reads as 11', () => {
  assert.equal(normalizeCellDigits('Tig 4%'), '11g 4%');
  assert.equal(normalizeCellDigits('Tlg'), '11g');
});

test('%DV restores a lost leading 1 only when the read amount does not fit', () => {
  assert.equal(reconcileAmountWithDailyValue('lg 4%', 275), 11);
  assert.equal(reconcileAmountWithDailyValue('10mg 5%', 2300), 110);
  assert.equal(reconcileAmountWithDailyValue('10mg 0%', 2300), 10);
  assert.equal(reconcileAmountWithDailyValue('1g 4%', 28), 1);
});

test('row realignment does not take a guessed lost 1 as evidence for a row', () => {
  assert.equal(reconcileAmountWithDailyValue('1g 4%', 275, false), null);
  // Carbs were never read, so fiber..protein sit one row high: "1g 4%" under Total Carbohydrate.
  const labels = ['total fat', 'saturated fat', 'cholesterol', 'sodium', 'total carbohydrate', 'dietary fiber', 'total sugars', 'includes added sugars', 'protein'];
  const slidUp = ['9g 12%', '3g 15%', '0mg 0%', '100mg 4%', '1g 4%', '16g', '15g 30%', '3g', ''];
  const rows = labels.map((row, i) => ({ row, values: [slidUp[i]!] }));
  realignShiftedColumns(rows, 1);
  const column = Object.fromEntries(rows.map((row) => [row.row, row.values[0]]));
  assert.equal(column['dietary fiber'], '1g 4%');
  assert.equal(column['includes added sugars'], '15g 30%');
  assert.equal(column.protein, '3g');
});

test('a column read one row low shifts up into the band below Protein', () => {
  const labels = ['total fat', 'saturated fat', 'cholesterol', 'sodium', 'total carbohydrate', 'dietary fiber', 'total sugars', 'includes added sugars', 'protein', 'next band'];
  const slidDown = ['9g 12%', '7g 35%', '0mg 0%', '-', '45mg 2%', '20g 7%', '1g 4%', '16g', '14g 28%', '1g'];
  const aligned = ['4g 5%', '2.5g 13%', '0mg 0%', '55mg 2%', '23g 8%', '0g 0%', '20g', '20g 40%', '1g', ''];
  const rows = labels.map((row, i) => ({ row, values: [slidDown[i]!, aligned[i]!] }));
  realignShiftedColumns(rows, 2);
  const column = (c: number) => Object.fromEntries(rows.map((row) => [row.row, row.values[c]]));
  assert.equal(column(0).sodium, '45mg 2%');
  assert.equal(column(0)['includes added sugars'], '14g 28%');
  assert.equal(column(0).protein, '1g');
  assert.equal(column(1).protein, '1g');
});

test('a Protein amount whose g was read as 9 still shifts up from the band below Protein', () => {
  const labels = ['total fat', 'saturated fat', 'cholesterol', 'sodium', 'total carbohydrate', 'dietary fiber', 'total sugars', 'includes added sugars', 'protein', 'next band'];
  for (const [below, protein] of [['109', '10g'], ['19', '1g']]) {
    const slidDown = ['9g 12%', '7g 35%', '0mg 0%', '-', '45mg 2%', '20g 7%', '1g 4%', '16g', '14g 28%', below];
    const rows = labels.map((row, i) => ({ row, values: [slidDown[i]!] }));
    realignShiftedColumns(rows, 1);
    const column = Object.fromEntries(rows.map((row) => [row.row, row.values[0]]));
    assert.equal(column.sodium, '45mg 2%');
    assert.equal(column.protein, protein, below);
  }
});

test('a stray %DV or micronutrient in the band below Protein never becomes Protein', () => {
  const labels = ['total fat', 'saturated fat', 'cholesterol', 'sodium', 'total carbohydrate', 'dietary fiber', 'total sugars', 'includes added sugars', 'protein', 'next band'];
  for (const below of ['5%', '20mg 0%', '0mcg 0%']) {
    const slidDown = ['9g 12%', '7g 35%', '0mg 0%', '-', '45mg 2%', '20g 7%', '1g 4%', '16g', '14g 28%', below];
    const rows = labels.map((row, i) => ({ row, values: [slidDown[i]!] }));
    realignShiftedColumns(rows, 1);
    const column = Object.fromEntries(rows.map((row) => [row.row, row.values[0]]));
    assert.equal(column.sodium, '45mg 2%');
    assert.equal(column.protein, '', below);
  }
});
