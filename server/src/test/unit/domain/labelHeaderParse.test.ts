import assert from 'node:assert/strict';
import test from 'node:test';
import {
  likelyServingsPerContainerHeader,
  likelyServingSizeHeader,
  normalizeOcrVolumeToken,
  parseServingsPerContainerVariant,
  parseServingSizeVariant,
} from '../../../domain/labelHeaderParse.js';

test('normalizeOcrVolumeToken repairs truncated bottle volumes', () => {
  assert.equal(normalizeOcrVolumeToken('4omL'), '340 ml');
  assert.equal(normalizeOcrVolumeToken('340mL'), '340 ml');
  assert.equal(normalizeOcrVolumeToken('34omL'), '340 ml');
});

test('likelyServingSizeHeader matches garbled OCR headers', () => {
  assert.equal(likelyServingSizeHeader('Senvng size 1 bottle'), true);
  assert.equal(likelyServingSizeHeader('random text'), false);
});

test('likelyServingsPerContainerHeader matches garbled per-container phrases', () => {
  assert.equal(likelyServingsPerContainerHeader('Tsering per conlaier Bottle'), true);
});

test('parseServingsPerContainerVariant reads count before garbled serving size', () => {
  const flat =
    'Nutrition Facts Tsering per conlaier Bottle (4omL)] 1 Senvng size calories 150';
  assert.equal(parseServingsPerContainerVariant(flat), 1);
});

test('parseServingSizeVariant reads bottle volume from noisy header', () => {
  const text = `
Nutrition Facts
Tsering per conlaier Bottle (4omL)] 1 Senvng size
Calories 150
`;
  assert.equal(parseServingSizeVariant(text), '1 bottle (340 ml)');
});
