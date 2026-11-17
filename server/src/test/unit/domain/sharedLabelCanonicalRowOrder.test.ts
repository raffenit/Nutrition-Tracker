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
