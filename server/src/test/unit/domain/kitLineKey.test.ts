import assert from 'node:assert/strict';
import test from 'node:test';
import { kitLineKeyFromText } from '../../../domain/kitLineKey.js';

test('kitLineKeyFromText strips quantity and normalizes casing', () => {
  assert.equal(kitLineKeyFromText('2 oz Garlic & Herb Butter'), 'garlic & herb butter');
  assert.equal(kitLineKeyFromText('Garlic & Herb Butter'), 'garlic & herb butter');
});

test('kitLineKeyFromText collapses OCR punctuation variants', () => {
  assert.equal(kitLineKeyFromText('creamy tomato sauce!!!'), 'creamy tomato sauce');
});
