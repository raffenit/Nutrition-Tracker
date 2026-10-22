import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchVariantLabelToken, normalizeOcrLabelToken } from '../../../domain/labelVariants.js';

test('normalizeOcrLabelToken keeps underscore gaps', () => {
  assert.equal(normalizeOcrLabelToken('S_dium'), 's_dium');
});

test('matchVariantLabelToken accepts underscore-gap sodium OCR', () => {
  assert.equal(matchVariantLabelToken('S_dium'), 'sodium');
  assert.equal(matchVariantLabelToken('Sedium'), 'sodium');
  assert.equal(matchVariantLabelToken('sod_um'), 'sodium');
});

test('matchVariantLabelToken accepts split-anchor OCR tokens', () => {
  assert.equal(matchVariantLabelToken('sod_iu'), 'sodium');
  assert.equal(matchVariantLabelToken('prot_in'), 'protein');
});
