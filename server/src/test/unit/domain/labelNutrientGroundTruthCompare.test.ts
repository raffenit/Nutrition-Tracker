import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareNutrientValues,
  compareLabelProductsToGroundTruth,
  inferNutrientRowSpecs,
  ocrPerformanceReportTitle,
  renderGroundTruthCompareHtml,
  resolveParsedProductsFromOcrText,
} from '../../../domain/labelNutrientGroundTruthCompare.js';
import { loadLabelNutrientGroundTruthForImage } from '../../../domain/labelNutrientGroundTruth.js';
import { emptyNutrients } from '../../../domain/nutrients.js';
import { mergeSlotReadingsAcrossCandidates } from '../../../domain/labelSlotExtract.js';
import type { LabelProductGroundTruth } from '../../../domain/labelNutrientGroundTruth.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const fixturesDir = path.join(repoRoot, 'server/src/test/fixtures');

test('compareNutrientValues: calories within tolerance', () => {
  assert.equal(compareNutrientValues({ field: 'calories', unit: 'kcal', expected: 140, got: 138 }), 'ok');
  assert.equal(compareNutrientValues({ field: 'calories', unit: 'kcal', expected: 140, got: 130 }), 'off');
  assert.equal(compareNutrientValues({ field: 'calories', unit: 'kcal', expected: 140, got: 19 }), 'unusable');
});

test('compareNutrientValues: less-than fiber', () => {
  const lt = { field: 'fiber' as const, amount: 1, unit: 'g' };
  assert.equal(compareNutrientValues({ field: 'fiber', unit: 'g', expected: 0, got: 0, lessThan: lt }), 'ok');
  assert.equal(compareNutrientValues({ field: 'fiber', unit: 'g', expected: 0, got: 1, lessThan: lt }), 'off');
});

test('inferNutrientRowSpecs trims rows for sparse single-label GT', () => {
  const products: LabelProductGroundTruth[] = [
    {
      productName: 'Snack',
      nutrients: {
        ...emptyNutrients(),
        calories: 90,
        protein: 3,
        fat: 0,
        carbs: 0,
        fiber: 0,
        sodium: 0,
        extras: [],
      },
    },
  ];
  const rows = inferNutrientRowSpecs(products);
  assert.ok(rows.some((r) => r.field === 'calories'));
  assert.ok(rows.some((r) => r.field === 'protein'));
  assert.equal(rows.some((r) => r.field === 'added_sugars'), false);
});

test('resolveParsedProductsFromOcrText: single layout uses parseNutritionLabel', () => {
  const text = `Nutrition Facts\nServing size 1 bar\nCalories 200\nTotal Fat 8g\nProtein 6g\nSodium 140mg`;
  const parsed = resolveParsedProductsFromOcrText(text, 'single');
  assert.equal(parsed?.length, 1);
  assert.equal(parsed?.[0]?.nutrients.calories, 200);
  assert.equal(parsed?.[0]?.nutrients.protein, 6);
});

test('loadLabelNutrientGroundTruthForImage reads Costco glare fixture', async () => {
  const bundle = await loadLabelNutrientGroundTruthForImage('costco-candy.jpg', fixturesDir);
  assert.ok(bundle);
  assert.equal(bundle.layout, 'shared_rail');
  assert.equal(bundle.products.length, 10);
});

test('compareLabelProductsToGroundTruth aligns by column index', () => {
  const gt: LabelProductGroundTruth[] = [
    {
      productName: 'A',
      servingLabel: '1',
      nutrients: { ...emptyNutrients(), calories: 100, fat: 5, sodium: 50, carbs: 10, protein: 2, fiber: 0, extras: [] },
    },
  ];
  const parsed = [
    {
      name: 'A',
      nutrients: { ...emptyNutrients(), calories: 100, fat: 5, sodium: 50, carbs: 10, protein: 2, fiber: 0, extras: [] },
    },
  ];
  const { summary, rowSpecs } = compareLabelProductsToGroundTruth({
    layout: 'single',
    groundTruth: gt,
    parsed,
  });
  assert.equal(summary.layout, 'single');
  assert.equal(summary.ok, rowSpecs.length);
  assert.equal(summary.unusable, 0);
});

test('resolveParsedProductsFromOcrText applies slot merge like image import (fat from other variant)', () => {
  const primary = 'Calories 150 Sodium 230mg Protein 30g';
  const fatRich = 'Tolal Fat2.Sg Calories 150 Protein 30g';
  const slotMerged = mergeSlotReadingsAcrossCandidates([primary, fatRich]);
  const parsed = resolveParsedProductsFromOcrText(primary, 'single', slotMerged);
  assert.equal(parsed?.[0]?.nutrients.fat, 2.5);
});

test('ocrPerformanceReportTitle and HTML include runtime', () => {
  assert.equal(ocrPerformanceReportTitle('protein-shake.jpg'), 'OCR Performance Report — protein-shake.jpg');
  const gt: LabelProductGroundTruth[] = [
    {
      productName: 'A',
      nutrients: { ...emptyNutrients(), calories: 100, fat: 0, sodium: 0, carbs: 0, protein: 0, fiber: 0, extras: [] },
    },
  ];
  const compare = compareLabelProductsToGroundTruth({
    layout: 'single',
    groundTruth: gt,
    parsed: [{ name: 'A', nutrients: { ...emptyNutrients(), calories: 100, fat: 0, sodium: 0, carbs: 0, protein: 0, fiber: 0, extras: [] } }],
  });
  const html = renderGroundTruthCompareHtml({
    title: ocrPerformanceReportTitle('protein-shake.jpg'),
    sourceImage: 'protein-shake.jpg',
    dataSourceNote: 'test',
    compare,
    runtimeSeconds: 28.2,
    generatedAtIso: '2026-11-16T07:00:00.000Z',
  });
  assert.match(html, /OCR Performance Report/);
  assert.match(html, /Runtime: <strong>28\.2s<\/strong>/);
});