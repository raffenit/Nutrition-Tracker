import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  correctAmountIfUnitMisreadAsSuffix,
  findEmbeddedCanonicalSpan,
  hasExplicitMassUnitInFragment,
  parseAmountWithFuzzyUnit,
  parseConfusableAmountToken,
  parseFuzzyMassUnit,
} from '../../../domain/ocrConfusables.js';
import { matchVariantLabelToken } from '../../../domain/labelVariants.js';

test('parseConfusableAmountToken maps I/l to 1', () => {
  assert.equal(parseConfusableAmountToken('I'), 1);
  assert.equal(parseConfusableAmountToken('l'), 1);
});

test('parseFuzzyMassUnit accepts noisy mg suffixes', () => {
  assert.equal(parseFuzzyMassUnit('mng'), 'mg');
  assert.equal(parseFuzzyMassUnit('m9'), 'mg');
});

test('parseAmountWithFuzzyUnit reads glued amount and unit', () => {
  assert.deepEqual(parseAmountWithFuzzyUnit('25mng'), { amount: 25, unit: 'mg' });
  assert.deepEqual(parseAmountWithFuzzyUnit('Ig'), { amount: 1, unit: 'g' });
});

test('correctAmountIfUnitMisreadAsSuffix strips confusable unit glyphs merged into grams', () => {
  const ctx = 'Fat 2.59 8';
  assert.equal(correctAmountIfUnitMisreadAsSuffix('2.59', 'g', ctx), 2.5);
  assert.equal(correctAmountIfUnitMisreadAsSuffix('2.5q', 'g', ctx), 2.5);
  assert.equal(correctAmountIfUnitMisreadAsSuffix('309', 'g', 'Protein 309 60'), 30);
  assert.equal(correctAmountIfUnitMisreadAsSuffix('2.59', 'g', 'Fat 2.59g 8'), 2.59);
  assert.equal(correctAmountIfUnitMisreadAsSuffix('2.59', 'g', 'Fat 2.59 8 (Protein 30g'), 2.5);
  assert.ok(hasExplicitMassUnitInFragment('Protein 30g', 'g'));
});

test('embedded canonical label inside noisy blob', () => {
  const blob = 'Icholesterol25mng';
  const span = findEmbeddedCanonicalSpan(blob, 'cholesterol');
  assert.ok(span);
  assert.equal(matchVariantLabelToken(blob), 'cholesterol');
  assert.deepEqual(parseAmountWithFuzzyUnit(blob.slice(span!.end)), { amount: 25, unit: 'mg' });
});
