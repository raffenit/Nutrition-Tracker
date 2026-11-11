import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNutritionImportWithPanels } from '../../../domain/nutritionImport.js';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import {
  MULTI_PRODUCT_FIXTURE_INLINE_ROWS,
  MULTI_PRODUCT_FIXTURE_LABEL_THEN_VALUES,
  MULTI_PRODUCT_FIXTURE_SINGLE_PANEL,
  MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS,
  MULTI_PRODUCT_FIXTURE_TAB_COLUMNS,
  MULTI_PRODUCT_FIXTURE_TWO_PRODUCTS,
  MULTI_PRODUCT_FIXTURE_WITH_PERCENT_NOISE,
} from '../../fixtures/multiProductLabelTables.js';

test('parseMultiProductLabelTable reads spaced column headers', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS);
  assert.ok(cols && cols.length === 3);
  assert.equal(cols[0]?.name, 'Crunchy Wafer');
  assert.equal(cols[1]?.nutrients.calories, 150);
  assert.equal(cols[2]?.nutrients.protein, 6);
});

test('parseMultiProductLabelTable reads tab-separated columns', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_TAB_COLUMNS);
  assert.ok(cols && cols.length === 3);
  assert.equal(cols[0]?.name, 'Product One');
  assert.equal(cols[1]?.nutrients.calories, 110);
  assert.equal(cols[2]?.nutrients.fat, 3.5);
});

test('parseMultiProductLabelTable reads label line then value rows', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_LABEL_THEN_VALUES);
  assert.ok(cols && cols.length === 2);
  assert.equal(cols[0]?.nutrients.calories, 80);
  assert.equal(cols[1]?.nutrients.sodium, 110);
});

test('parseMultiProductLabelTable supports two-product minimum', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_TWO_PRODUCTS);
  assert.ok(cols && cols.length === 2);
  assert.equal(cols[0]?.nutrients.calories, 200);
  assert.equal(cols[1]?.nutrients.calories, 180);
});

test('parseMultiProductLabelTable reads inline nutrient rows', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_INLINE_ROWS);
  assert.ok(cols && cols.length === 3);
  assert.equal(cols[0]?.nutrients.protein, 5);
  assert.equal(cols[2]?.nutrients.calories, 90);
});

test('parseMultiProductLabelTable tolerates bare percent lines between macros', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_WITH_PERCENT_NOISE);
  assert.ok(cols && cols.length === 3);
  assert.equal(cols[1]?.nutrients.calories, 130);
  assert.equal(cols[0]?.nutrients.sodium, 210);
});

test('parseMultiProductLabelTable ignores single-product panels', () => {
  const cols = parseMultiProductLabelTable(MULTI_PRODUCT_FIXTURE_SINGLE_PANEL);
  assert.equal(cols, null);
});

test('buildNutritionImportWithPanels exposes multi-product columns as labelPanels', () => {
  const built = buildNutritionImportWithPanels(MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS, 'image');
  assert.equal(built.labelPanels.length, 3);
  assert.equal(built.labelPanels[1]?.draft.name, 'Cocoa Bar');
  assert.equal(built.labelPanels[1]?.draft.nutrients.calories, 150);
});
