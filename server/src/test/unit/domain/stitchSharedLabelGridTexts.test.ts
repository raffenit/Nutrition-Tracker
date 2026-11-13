import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import {
  diagnoseSharedLabelGridStitch,
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
