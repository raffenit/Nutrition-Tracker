import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLabelImageCandidates } from '../../../integrations/urlLabelImages.js';

const BASE = 'https://shop.example.com/p/product/123';

test('picks images whose alt or src mentions the nutrition label', () => {
  const html = `
    <div><img src="/static/logo.svg" alt="Store logo"></div>
    <section>
      <h2>Nutrition Facts</h2>
      <img src="/images/panel/nutrition-label.png" alt="Nutrition Facts panel">
    </section>`;
  const candidates = extractLabelImageCandidates(html, BASE);
  assert.deepEqual(candidates, ['https://shop.example.com/images/panel/nutrition-label.png']);
});

test('picks images embedded near nutrition text even without label words in the tag', () => {
  const filler = 'x'.repeat(200);
  const html = `<p>Ingredients: water, salt.</p><div>${filler}<img src="/img/abc123.webp" alt="">${filler}</div><p>Nutrition Facts Calories 100</p>`;
  const candidates = extractLabelImageCandidates(html, BASE);
  assert.deepEqual(candidates, ['https://shop.example.com/img/abc123.webp']);
});

test('skips data URIs, non-http schemes, and unrelated images', () => {
  const html = `
    <img src="data:image/png;base64,AAAA" alt="nutrition label">
    <img src="javascript:void(0)" alt="nutrition label">
    <img src="/icon-cart.svg" alt="cart">`;
  assert.deepEqual(extractLabelImageCandidates(html, BASE), []);
});

test('resolves protocol-relative and root-relative URLs against the page', () => {
  const html = `<img src="//cdn.example.com/labels/facts.jpg" alt="label"><img src="/a/nutrition.png" alt="nutrition">`;
  const candidates = extractLabelImageCandidates(html, BASE);
  assert.deepEqual(candidates.sort(), [
    'https://cdn.example.com/labels/facts.jpg',
    'https://shop.example.com/a/nutrition.png',
  ]);
});

test('dedupes repeated URLs and respects the limit', () => {
  const imgs = Array.from({ length: 6 }, (_, i) => `<img src="/nutrition-${i}.png" alt="nutrition label">`).join('');
  const dup = `<img src="/nutrition-0.png" alt="nutrition label">`;
  const candidates = extractLabelImageCandidates(dup + imgs, BASE, 3);
  assert.equal(candidates.length, 3);
  assert.equal(new Set(candidates).size, 3);
});
