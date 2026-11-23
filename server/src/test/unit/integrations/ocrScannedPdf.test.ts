import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyPdfPages,
  pagesPerRecipeCard,
  pdfOcrWorkerCount,
  recipeImportProgressMessage,
  stripPdfPageMarkers,
} from '../../../integrations/ocrScannedPdf.js';
import type { RecipePageLayout } from '../../../domain/recipeCardLayout.js';

test('stripPdfPageMarkers removes pdf-parse page markers from image-only PDFs', () => {
  const raw = '\n-- 1 of 18 --\n\n-- 2 of 18 --\n';
  assert.equal(stripPdfPageMarkers(raw).trim(), '');
  assert.equal(stripPdfPageMarkers('Serves 2\n-- 3 of 4 --\nIngredients').split('\n').length, 2);
});

test('classifyPdfPages routes recipe cards to text mode and labels to label mode', () => {
  assert.equal(classifyPdfPages(['2 SERVINGS | 4 SERVINGS INGREDIENTS', 'PREP Trim carrot', '']), 'text');
  assert.equal(classifyPdfPages(['Nutrition Facts Calories 120 % Daily Value', 'Nutrition Facts Total Fat 3g']), 'label');
  assert.equal(classifyPdfPages(['', '']), 'label');
  // Labels say "servings per container" and often list ingredients — still label mode.
  assert.equal(classifyPdfPages([
    'Nutrition Facts 8 servings per container Serving size 2/3 cup Calories 230 Ingredients: oats, sugar',
    'Nutrition Facts 4 servings per container Calories 190',
  ]), 'label');
  assert.equal(classifyPdfPages(['Serves 2 INGREDIENTS 12 oz chicken INSTRUCTIONS 1. Preheat oven']), 'text');
});

test('pdfOcrWorkerCount never exceeds the page count or the pool cap', () => {
  assert.equal(pdfOcrWorkerCount(1), 1);
  assert.ok(pdfOcrWorkerCount(18) >= 1 && pdfOcrWorkerCount(18) <= 3);
});

const FRONT_LAYOUT: RecipePageLayout = {
  title: 'CARD',
  servings: [2, 4],
  ingredients: [{ quantities: ['1 oz', '2 oz'], name: 'Capers' }, { quantities: ['1 whole', '2 whole'], name: 'Lemon' }],
};

test('pagesPerRecipeCard reads the front/back pattern from the probe pages', () => {
  assert.equal(pagesPerRecipeCard([{ layout: FRONT_LAYOUT }, { layout: null }, { layout: FRONT_LAYOUT }]), 2);
  assert.equal(pagesPerRecipeCard([{ layout: null }, { layout: null }, { layout: null }]), null);
});

test('recipeImportProgressMessage counts recipes from pages read', () => {
  assert.equal(recipeImportProgressMessage(1, 18, 2), 'Importing recipe 1/9');
  assert.equal(recipeImportProgressMessage(2, 18, 2), 'Importing recipe 1/9');
  assert.equal(recipeImportProgressMessage(3, 18, 2), 'Importing recipe 2/9');
  assert.equal(recipeImportProgressMessage(18, 18, 2), 'Importing recipe 9/9');
  assert.equal(recipeImportProgressMessage(4, 10, null), 'Reading PDF pages… 4/10');
});
