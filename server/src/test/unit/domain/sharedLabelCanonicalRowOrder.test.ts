import assert from 'node:assert/strict';
import test from 'node:test';
import { fillRowLabelsByCanonicalOrder } from '../../../domain/stitchSharedLabelGridTexts.js';

test('unread row labels between two read rows take the canonical rows in between', () => {
  assert.deepEqual(fillRowLabelsByCanonicalOrder(['Trans Fat', null, null, 'Total Carbohydrate']), [
    'Trans Fat',
    'Cholesterol',
    'Sodium',
    'Total Carbohydrate',
  ]);
});

test('gaps whose band count does not match the canonical gap are left alone', () => {
  assert.deepEqual(fillRowLabelsByCanonicalOrder(['Trans Fat', null, 'Total Carbohydrate']), ['Trans Fat', null, 'Total Carbohydrate']);
});

test('unread bands right after the last read row take the remaining canonical rows', () => {
  assert.deepEqual(fillRowLabelsByCanonicalOrder(['Total Sugars', 'Includes Added Sugars', null]), [
    'Total Sugars',
    'Includes Added Sugars',
    'Protein',
  ]);
  assert.deepEqual(fillRowLabelsByCanonicalOrder(['Includes Added Sugars', 'Protein', null]), ['Includes Added Sugars', 'Protein', null]);
  assert.deepEqual(fillRowLabelsByCanonicalOrder(['Includes Added Sugars', 'Vitamin D', null]), ['Includes Added Sugars', 'Vitamin D', null]);
});
