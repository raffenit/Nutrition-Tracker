import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildPerColumnVarietyPackPlanFromPipeline,
  buildSharedLabelPlanFromPipeline,
  productColumnsForUniformityWidthCheck,
  sharedRailProductValueColumns,
  prepareVarietyPackBandContext,
  runVarietyPackGridStep1,
  runVarietyPackGridStep2,
  runVarietyPackGridStep3,
  runVarietyPackGridStep4,
  runVarietyPackGridPipeline,
  dropWideSparseBodyRuledProductStacks,
  inkValueColumnsNeedRuledBounds,
} from '../../../integrations/varietyPackGridPipeline.js';
import { DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS } from '../../../domain/varietyPackGridPipelineParams.js';
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

  const step4 = runVarietyPackGridStep4(ctx!, step2.data!, step3.data!);
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
  assert.ok(full.plan!.nutrientBodyTop > full.plan!.band.top);
  assert.ok(full.plan!.rowBandSlices.length >= 3);
  assert.equal(full.plan!.labelColumn.top, full.plan!.band.top);
  assert.ok(
    full.plan!.labelColumn.height >= full.plan!.nutrientBodyHeight,
    'label rail OCR crop spans header + nutrient body',
  );
  const labelRight = full.plan!.labelColumn.left + full.plan!.labelColumn.width;
  for (const col of full.plan!.valueColumns) {
    assert.equal(col.top, full.plan!.nutrientBodyTop);
    assert.equal(col.height, full.plan!.nutrientBodyHeight);
    assert.ok(col.left >= labelRight - 1, 'value strips must not overlap label rail');
  }
});

test('sharedRailProductValueColumns drops the label rail from product stacks', () => {
  const label = { index: 0, x0: 0, x1: 120, horizontalRuleCount: 2 };
  const products = [
    label,
    { index: 1, x0: 120, x1: 220, horizontalRuleCount: 10 },
    { index: 2, x0: 220, x1: 320, horizontalRuleCount: 10 },
  ];
  const valueOnly = sharedRailProductValueColumns(products, label);
  assert.equal(valueOnly.length, 2);
  assert.equal(valueOnly[0]!.x0, 120);
});

test('productColumnsForUniformityWidthCheck ignores wide left label rail', () => {
  const categories = [
    { index: 0, x0: 0, x1: 200, horizontalRuleCount: 12 },
    { index: 1, x0: 200, x1: 300, horizontalRuleCount: 12 },
    { index: 2, x0: 300, x1: 400, horizontalRuleCount: 12 },
  ];
  const productColumns = [...categories];
  const widths = productColumnsForUniformityWidthCheck(categories, productColumns, 1.35).map(
    (c) => c.x1 - c.x0,
  );
  assert.deepEqual(widths, [100, 100]);
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

  const step4 = runVarietyPackGridStep4(ctx!, step2.data!, step3.data!);
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
  const step2 = runVarietyPackGridStep2(ctx!, step1.data!);
  const step4 = runVarietyPackGridStep4(ctx!, step2.data!, step3.data!);
  assert.equal(buildSharedLabelPlanFromPipeline(ctx!, step2.data!, step3.data!, step4.data!), null);
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

test('dropWideSparseBodyRuledProductStacks keeps wide columns with a nutrient body table', () => {
  const pipeline = DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS;
  const w = 120;
  const h = 160;
  const pixels = new Uint8Array(w * h).fill(230);
  const bodyTop = Math.round(h * pipeline.wideRuledSpanBodyRuleProbeTopFraction);
  for (let y = bodyTop + 8; y < h - 8; y += 12) {
    for (let x = 40; x < 98; x += 1) pixels[y * w + x] = 30;
  }
  const columns = [
    { x0: 38, x1: 98, index: 0, horizontalRuleCount: 6 },
    { x0: 10, x1: 30, index: 1, horizontalRuleCount: 18 },
  ];
  const kept = dropWideSparseBodyRuledProductStacks(columns, pipeline, pixels, w, h);
  assert.equal(kept.length, 2);
  assert.equal(kept[0]!.x0, 38);
});

test('dropWideSparseBodyRuledProductStacks keeps wide spans when label has no horizontal-rule signal', () => {
  const pipeline = DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS;
  const columns = [
    { x0: 8, x1: 80, index: 0, horizontalRuleCount: 0 },
    { x0: 90, x1: 118, index: 1, horizontalRuleCount: 0 },
  ];
  const kept = dropWideSparseBodyRuledProductStacks(columns, pipeline);
  assert.equal(kept.length, 2);
});

test('dropWideSparseBodyRuledProductStacks drops wide empty ruled spans', () => {
  const pipeline = DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS;
  const columns = [
    { x0: 90, x1: 128, index: 0, horizontalRuleCount: 18 },
    { x0: 138, x1: 240, index: 1, horizontalRuleCount: 2 },
    { x0: 250, x1: 288, index: 2, horizontalRuleCount: 18 },
  ];
  const kept = dropWideSparseBodyRuledProductStacks(columns, pipeline);
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.map((c) => c.x0),
    [90, 250],
  );
});

test('inkValueColumnsNeedRuledBounds detects interior gap between ink product columns', () => {
  const ratio = DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS.valueColumnInkInteriorGapToMedianProductRatio;
  const tight = [
    { x0: 100, x1: 138 },
    { x0: 138, x1: 176 },
  ];
  assert.equal(inkValueColumnsNeedRuledBounds(tight, ratio), false);
  const gapped = [
    { x0: 290, x1: 328 },
    { x0: 385, x1: 425 },
  ];
  assert.equal(inkValueColumnsNeedRuledBounds(gapped, ratio), true);
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
