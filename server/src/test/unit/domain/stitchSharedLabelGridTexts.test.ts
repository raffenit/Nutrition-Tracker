import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import {
  diagnoseSharedLabelGridStitch,
  fillUnreadSlicesFromAlternateRead,
  splitMergedDailyValueHeaderSlices,
  stitchSharedLabelGridFromRowBandSlices,
  stitchSharedLabelGridTexts,
} from '../../../domain/stitchSharedLabelGridTexts.js';

const LABEL_COLUMN = `
Nutrition Facts
Serving Size 1 piece
Calories
Total Fat
Sodium
Protein
`;

const HEADER = 'Crunchy Wafer    Cocoa Bar    Peanut Mix';

test('stitchSharedLabelGridFromRowBandSlices aligns per-column row bands', () => {
  const labelSlices = [
    'Nutrition Facts',
    '% Daily Value*',
    'Calories',
    'Total Fat',
    'Sodium',
  ];
  const valueSlices = [
    ['SNICKERS', '% Daily Value*', '90', '5g', '120mg'],
    ['TWIX', '% Daily Value*', '110', '6g', '140mg'],
  ];
  const stitched = stitchSharedLabelGridFromRowBandSlices(labelSlices, valueSlices, 'Snack A    Snack B');
  assert.ok(stitched);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.equal(cols?.length, 2);
  assert.equal(cols![0]!.nutrients.calories, 90);
  assert.equal(cols![1]!.nutrients.calories, 110);
  const lineStitch = stitchSharedLabelGridTexts(
    labelSlices.join('\n'),
    valueSlices.map((col) => col.join('\n')),
    'Snack A    Snack B',
  );
  assert.ok(lineStitch);
  const lineCols = parseMultiProductLabelTable(lineStitch!);
  assert.equal(lineCols?.[0]!.nutrients.calories, 90);
});

test('stitchSharedLabelGridFromRowBandSlices keeps % Daily Value row when label slice is empty', () => {
  const labelSlices = ['', 'Calories', 'Total Fat'];
  const valueSlices = [
    ['% Daily Value*', '90', '5g'],
    ['% Daily Value*', '110', '6g'],
  ];
  const stitched = stitchSharedLabelGridFromRowBandSlices(labelSlices, valueSlices, 'Snack A    Snack B');
  assert.ok(stitched);
  assert.match(stitched!, /% Daily Value/i);
  assert.match(stitched!, /Snack A {4}Snack B/);
});

test('stitchSharedLabelGridFromRowBandSlices maps value slices when counts differ', () => {
  const labelSlices = ['Amount per serving', 'Calories', 'Total Fat', 'Sodium', 'Protein'];
  const valueSlices = [
    ['90', '5g', '120mg', '3g'],
    ['110', '6g', '140mg', '4g'],
  ];
  const stitched = stitchSharedLabelGridFromRowBandSlices(labelSlices, valueSlices);
  assert.ok(stitched);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.equal(cols?.[0]!.nutrients.calories, 90);
  assert.equal(cols?.[1]!.nutrients.calories, 110);
});

test('stitch uses display calories from per-column header OCR', () => {
  const stitched = stitchSharedLabelGridTexts(
    'Nutrition Facts\nCalories\nTotal Fat',
    [
      'SNICKERS\n% Daily Value*\n2 Packs (28g)\n45g',
      'TWIX\n% Daily Value*\n1 Bar (17g)\n35g',
    ],
    '',
    {
      headerColumnTexts: ['KIT KAT®\nVaries\n170', 'SNICKERS®\nVaries\n250'],
    },
  );
  assert.ok(stitched);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.equal(cols?.[0]!.nutrients.calories, 170);
  assert.equal(cols?.[1]!.nutrients.calories, 250);
});

test('stitchSharedLabelGridTexts builds table from label + value columns', () => {
  const stitched = stitchSharedLabelGridTexts(
    LABEL_COLUMN,
    ['140\n5g\n120mg\n2g', '150\n6g\n140mg\n8g', '160\n7g\n100mg\n6g'],
    HEADER,
  );
  assert.ok(stitched);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.ok(cols && cols.length === 3);
  assert.equal(cols![1]!.name, 'Cocoa Bar');
  assert.equal(cols![1]!.nutrients.calories, 150);
});

test('stitchSharedLabelGridTexts returns null without enough value columns', () => {
  assert.equal(stitchSharedLabelGridTexts(LABEL_COLUMN, ['140'], HEADER), null);
});

test('stitchSharedLabelGridTexts accepts word values like Varies and units', () => {
  const stitched = stitchSharedLabelGridTexts(
    'Nutrition Facts\nCalories\nTotal Fat',
    [
      'SNICKERS\n% Daily Value*\nVaries\n90',
      'TWIX\n% Daily Value*\nVaries\n110',
    ],
    'Snack A    Snack B',
  );
  assert.ok(stitched);
  const diag = diagnoseSharedLabelGridStitch(
    'Nutrition Facts\nCalories\nTotal Fat',
    [
      'SNICKERS\n% Daily Value*\nVaries\n90',
      'TWIX\n% Daily Value*\nVaries\n110',
    ],
    'Snack A    Snack B',
  );
  assert.equal(diag.ok, true);
});

test('diagnoseSharedLabelGridStitch reports when output lacks calories row', () => {
  const diag = diagnoseSharedLabelGridStitch('Nutrition Facts\nCalories', ['footnote only', '90'], '');
  assert.equal(diag.failure, 'missing_calories_in_output');
});

test('stitchSharedLabelGridTexts keeps weak columns as blank cells', () => {
  const stitched = stitchSharedLabelGridTexts(
    'Nutrition Facts\nCalories\nTotal Fat',
    [
      '% Daily Value*\n90\n5g',
      '% Daily Value*\n110\n6g',
      'INGREDIENTS: SUGAR, FLOUR, MILK',
    ],
    'Snack A    Snack B    Snack C',
  );
  assert.ok(stitched);
  assert.match(stitched!, /Snack A  Snack B  Snack C/);
  assert.match(stitched!, /90 {2}110 {2}$/m);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.equal(cols?.length, 3);
  assert.equal(cols![0]!.nutrients.calories, 90);
  assert.equal(cols![2]!.nutrients.calories, 0);
});

test('extractRowLabels finds nutrients when OCR prefixes garbage on the line', () => {
  const garbled = `
5, hl = Calories
i "| Saturated Fat
: j wl Trans Fat
ly ). Cholesterol
; 1 [Sodium
LY (J Total Carbohyd
» J Dietary Fiber
i Total Sugars
Protein
`;
  const diag = diagnoseSharedLabelGridStitch(
    garbled,
    [
      'SNICKERS\n% Daily Value*\nVaries\n90\n5g\n120mg',
      'TWIX\n% Daily Value*\nVaries\n110\n6g\n140mg',
    ],
    'Snack A    Snack B',
  );
  assert.ok(diag.rowLabelCount >= 4, `expected row labels, got ${diag.rowLabelCount}`);
  assert.equal(diag.failure, null);
});

test('stitchSharedLabelGridFromRowBandSlices keeps column positions when a middle cell is blank', () => {
  const labelSlices = ['Calories', 'Total Fat', 'Protein'];
  const valueSlices = [
    ['90', '5g', '3g'],
    ['110', '', '4g'],
    ['130', '7g', '5g'],
  ];
  const stitched = stitchSharedLabelGridFromRowBandSlices(labelSlices, valueSlices, 'Snack A    Snack B    Snack C');
  assert.ok(stitched);
  const cols = parseMultiProductLabelTable(stitched!);
  assert.equal(cols?.length, 3);
  assert.equal(cols![1]!.nutrients.fat, 0);
  assert.equal(cols![2]!.nutrients.fat, 7);
  assert.equal(cols![2]!.nutrients.protein, 5);
});

test('alternate row read fills only digitless slices next to an agreeing neighbour', () => {
  const primary = ['80', 'oz Daily Value', 'A', '29 10%', '0g', 'Omg 0%'];
  const alternate = ['80', '% Dally Walue:', '39 4%', '29 10%', '9g', 'Omg 0%'];
  assert.deepEqual(fillUnreadSlicesFromAlternateRead(primary, alternate), [
    '80', 'oz Daily Value', '39 4%', '29 10%', '0g', 'Omg 0%',
  ]);
});

test('alternate row read keeps 1-glyph amounts and never fills a bare percent', () => {
  assert.deepEqual(fillUnreadSlicesFromAlternateRead(['3g 4%', 'Ig', '0g'], ['3g 4%', '7g', '0g']), ['3g 4%', 'Ig', '0g']);
  assert.deepEqual(fillUnreadSlicesFromAlternateRead(['3g 4%', 'A', '0g'], ['3g 4%', '2%', '0g']), ['3g 4%', 'A', '0g']);
});

test('alternate row read is ignored where neighbours disagree or it is shorter', () => {
  const primary = ['A', '3g 15%', '0g'];
  assert.deepEqual(fillUnreadSlicesFromAlternateRead(primary, ['9g 12%', '0g', '<5mg 0%']), primary);
  assert.deepEqual(fillUnreadSlicesFromAlternateRead(primary, ['9g 12%']), primary);
});

test('a Fat amount merged into the % Daily Value band moves down and shifts its column', () => {
  const columns = [
    ['80', '% Daily Value*', '3g 4%', '2g 10%', '0g'],
    ['160', '9g %Dally Value _ 12%', '3g 15%', '0g', '<5mg 0%'],
    ['130', '% Daily Valuer', '4g 5%', '2.5g 13%', '0g'],
  ];
  const out = splitMergedDailyValueHeaderSlices(columns);
  assert.deepEqual(out[0], columns[0]);
  assert.deepEqual(out[1], ['160', '%Dally Value _ 12%', '9g 12%', '3g 15%', '0g']);
  assert.deepEqual(out[2], columns[2]);
});

test('header split needs most columns to agree on the header band', () => {
  const columns = [
    ['80', '3g 4%'],
    ['160', '9g %Dally Value _ 12%'],
    ['130', '4g 5%'],
  ];
  assert.deepEqual(splitMergedDailyValueHeaderSlices(columns), columns);
});
