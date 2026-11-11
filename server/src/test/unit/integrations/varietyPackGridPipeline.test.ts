import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPerColumnVarietyPackPlanFromPipeline,
  buildSharedLabelPlanFromPipeline,
  prepareVarietyPackBandContext,
  runVarietyPackGridStep1,
  runVarietyPackGridStep2,
  runVarietyPackGridStep3,
  runVarietyPackGridStep4,
  runVarietyPackGridPipeline,
} from '../../../integrations/varietyPackGridPipeline.js';
import { stitchColumnStripOcrTexts } from '../../../domain/stitchColumnStripTexts.js';
import {
  DEFAULT_PER_COLUMN_LABEL_GRID,
  DEFAULT_SHARED_LABEL_GRID,
  syntheticPerColumnLabelGridPng,
  syntheticSharedLabelGridPng,
} from '../../fixtures/syntheticVarietyPackGrids.js';

test('variety pack pipeline steps gate sequentially on synthetic grid', async () => {
  const bytes = await syntheticSharedLabelGridPng(1200, 300);
  const ctx = await prepareVarietyPackBandContext(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(ctx);

  const step1 = runVarietyPackGridStep1(ctx!);
  assert.equal(step1.validation.ok, true, step1.validation.message);
  assert.ok(step1.data!.productColumns.length >= DEFAULT_SHARED_LABEL_GRID.count);

  const step2 = runVarietyPackGridStep2(ctx!, step1.data!);
  assert.equal(step2.validation.ok, true, step2.validation.message);

  const step3 = runVarietyPackGridStep3(ctx!, step1.data!);
  assert.equal(step3.validation.ok, true, step3.validation.message);
  assert.equal(step3.data!.layout, 'shared_rail');

  const step4 = runVarietyPackGridStep4(ctx!, step3.data!);
  assert.equal(step4.validation.ok, true, step4.validation.message);
  assert.ok(step4.data!.rowBandYs.length >= 4);
});

test('runVarietyPackGridPipeline stopAfterStep halts before OCR plan', async () => {
  const bytes = await syntheticSharedLabelGridPng(1200, 300);
  const at1 = await runVarietyPackGridPipeline(bytes, { stopAfterStep: 1, requireWideAspect: true });
  assert.equal(at1.lastOkStep, 1);
  assert.equal(at1.plan, null);

  const full = await runVarietyPackGridPipeline(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.equal(full.lastOkStep, 4);
  assert.ok(full.plan);
  assert.equal(full.plan!.valueColumns.length, DEFAULT_SHARED_LABEL_GRID.count);
});

test('synthetic per-column variety pack classifies per_column_labels', async () => {
  const bytes = await syntheticPerColumnLabelGridPng(1200, 300);
  const ctx = await prepareVarietyPackBandContext(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(ctx);

  const step1 = runVarietyPackGridStep1(ctx!);
  assert.equal(step1.validation.ok, true, step1.validation.message);
  assert.ok(step1.data!.productColumns.length >= DEFAULT_PER_COLUMN_LABEL_GRID.count);

  const step2 = runVarietyPackGridStep2(ctx!, step1.data!);
  assert.equal(step2.validation.ok, true, step2.validation.message);

  const step3 = runVarietyPackGridStep3(ctx!, step1.data!);
  assert.equal(step3.validation.ok, true, step3.validation.message);
  assert.equal(step3.data!.layout, 'per_column_labels');
  assert.equal(step3.data!.labelColumn, null);

  const step4 = runVarietyPackGridStep4(ctx!, step3.data!);
  assert.equal(step4.validation.ok, true, step4.validation.message);
});

test('per_column_labels builds multi-product column strip OCR plan', async () => {
  const bytes = await syntheticPerColumnLabelGridPng(1200, 300);
  const full = await runVarietyPackGridPipeline(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.equal(full.steps[3].data?.layout, 'per_column_labels');
  assert.equal(full.lastOkStep, 4);
  assert.equal(full.plan, null);
  assert.ok(full.perColumnStripPlan);
  assert.equal(full.perColumnStripPlan!.strips.length, full.steps[3].data!.valueColumns.length);
  assert.ok(full.perColumnStripPlan!.strips.length >= DEFAULT_PER_COLUMN_LABEL_GRID.count);
});

test('buildPerColumnVarietyPackPlanFromPipeline maps ruled columns to strips', async () => {
  const bytes = await syntheticPerColumnLabelGridPng(1200, 300);
  const ctx = await prepareVarietyPackBandContext(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(ctx);
  const step1 = runVarietyPackGridStep1(ctx!);
  const step3 = runVarietyPackGridStep3(ctx!, step1.data!);
  assert.equal(step3.data!.layout, 'per_column_labels');
  const stripPlan = buildPerColumnVarietyPackPlanFromPipeline(ctx!, step3.data!);
  assert.ok(stripPlan);
  assert.equal(stripPlan!.strips.length, step3.data!.valueColumns.length);
  assert.equal(buildSharedLabelPlanFromPipeline(ctx!, runVarietyPackGridStep2(ctx!, step1.data!).data!, step3.data!), null);
});

test('step 3 routing: shared-label synthetic commits to shared_rail', async () => {
  const bytes = await syntheticSharedLabelGridPng(1200, 300);
  const ctx = await prepareVarietyPackBandContext(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(ctx);
  const step1 = runVarietyPackGridStep1(ctx!);
  const step3 = runVarietyPackGridStep3(ctx!, step1.data!);
  assert.equal(step3.validation.ok, true, step3.validation.message);
  assert.equal(step3.data!.layout, 'shared_rail');
  assert.ok(step3.data!.labelColumn);
});

test('step 3 routing: per-column synthetic commits before ink-rail short circuit', async () => {
  const bytes = await syntheticPerColumnLabelGridPng(1200, 300);
  const ctx = await prepareVarietyPackBandContext(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(ctx);
  const step1 = runVarietyPackGridStep1(ctx!);
  const step3 = runVarietyPackGridStep3(ctx!, step1.data!);
  assert.equal(step3.validation.ok, true, step3.validation.message);
  assert.equal(step3.data!.layout, 'per_column_labels');
  assert.equal(step3.data!.labelColumn, null);
  assert.equal(step3.validation.metrics?.varietySubtype, 'per_column_labels');
});

test('per-column strip stitch parses as multi-product table', () => {
  const columns = [
    'Nutrition Facts\nSnack A\nCalories\n140\nTotal Fat\n5g\nProtein\n2g',
    'Nutrition Facts\nSnack B\nCalories\n150\nTotal Fat\n6g\nProtein\n3g',
    'Nutrition Facts\nSnack C\nCalories\n160\nTotal Fat\n7g\nProtein\n4g',
  ];
  const stitched = stitchColumnStripOcrTexts(columns);
  assert.ok(stitched);
  assert.ok(/Snack A/i.test(stitched!));
  assert.ok(/140/.test(stitched!));
});
