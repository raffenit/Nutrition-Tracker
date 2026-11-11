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

test('diagnoseSharedLabelGridStitch reports row_count_zero', () => {
  const diag = diagnoseSharedLabelGridStitch('Nutrition Facts\nCalories', ['footnote only', '90'], '');
  assert.equal(diag.failure, 'too_few_product_columns');
});
