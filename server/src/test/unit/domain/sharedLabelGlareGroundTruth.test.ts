import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  loadGlareGroundTruthForImage,
  resolveGlareGroundTruthRowTargets,
  valueColumnIndexForAnalysisSegment,
  type GlareGroundTruthFile,
} from '../../../domain/sharedLabelGlareGroundTruth.js';
import { loadLabelNutrientGroundTruthForImage } from '../../../domain/labelNutrientGroundTruth.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const fixturesDir = path.join(repoRoot, 'server/src/test/fixtures');

test('valueColumnIndexForAnalysisSegment picks max overlap (0-based)', () => {
  const cols = [
    { x0: 100, x1: 140 },
    { x0: 140, x1: 180 },
    { x0: 215, x1: 252 },
  ];
  assert.equal(valueColumnIndexForAnalysisSegment({ x0: 138, x1: 176 }, cols), 1);
  assert.equal(valueColumnIndexForAnalysisSegment({ x0: 215, x1: 252 }, cols), 2);
});

test('resolveGlareGroundTruthRowTargets maps rowRole via plan slices', () => {
  const bodyTop = 560;
  const firstRule = 673;
  const pitch = 40;
  const bodySlices = [
    { rowIndex: 0, top: bodyTop, height: firstRule - bodyTop - 30 },
    { rowIndex: 1, top: bodyTop + (firstRule - bodyTop - 30), height: 30 },
    { rowIndex: 2, top: firstRule, height: pitch },
  ];
  const gt: GlareGroundTruthFile = {
    sourceImage: 'synthetic.jpg',
    columns: [
      {
        valueColumnIndex: 2,
        glare: [
          { zone: 'header', headerRowIndex: 1 },
          { zone: 'body', rowRole: 'daily_value', coverage: 'partial' },
          { zone: 'body', rowRole: 'calories' },
        ],
      },
    ],
  };
  const targets = resolveGlareGroundTruthRowTargets({
    groundTruth: gt,
    step3ValueColumns: [{ x0: 0, x1: 50 }, { x0: 50, x1: 100 }, { x0: 100, x1: 140 }],
    planStripColumnIndex: 1,
    valueColumnIndex: 2,
    headerSlices: [
      { rowIndex: 0, top: 360, height: 100 },
      { rowIndex: 1, top: 460, height: 100 },
    ],
    bodySlices,
    bodyTopImage: bodyTop,
    firstInteriorRuleYImage: firstRule,
    rowPitchPx: pitch,
    valueRulesImagePerColumn: [[firstRule], [firstRule], [firstRule]],
  });
  assert.ok(targets.some((t) => t.zone === 'header' && t.rowIndex === 1));
  assert.ok(targets.some((t) => t.zone === 'body' && t.rowIndex === 0 && t.highlightTopFraction === undefined));
  assert.ok(
    targets.some(
      (t) => t.zone === 'body' && t.highlightTopFraction !== undefined && t.highlightTopFraction > 0,
    ),
  );
});

test('loadGlareGroundTruthForImage matches basename', async () => {
  const loaded = await loadGlareGroundTruthForImage('costco-candy.jpg', fixturesDir);
  assert.ok(loaded);
  assert.equal(loaded.columns.length, 2);
  assert.deepEqual(loaded.caloriesKcalPerValueColumn, [140, 80, 90, 80, 130, 80, 160, 130, 170, 170]);
  assert.equal(loaded.caloriesKcalPerValueColumn?.length, loaded.valueColumnCount);
  assert.equal(loaded.productsPerValueColumn?.length, 10);
  const calorieRows = loaded.productsPerValueColumn?.map((p) => p.nutrients.calories) ?? [];
  assert.deepEqual(calorieRows, loaded.caloriesKcalPerValueColumn);
  assert.match(loaded.productsPerValueColumn?.[0]?.productName ?? '', /KIT KAT/i);
  assert.equal(loaded.productsPerValueColumn?.[6]?.nutrients.extras.find((e) => e.key === 'potassium')?.amount, 110);

  const nutrientBundle = await loadLabelNutrientGroundTruthForImage('costco-candy.jpg', fixturesDir);
  assert.ok(nutrientBundle);
  assert.equal(nutrientBundle.products.length, 10);
  assert.equal(nutrientBundle.layout, 'shared_rail');
});

test(
  'Costco glare ground truth resolves row targets for columns 4 and 8',
  { skip: !existsSync(path.join(repoRoot, 'local/test-images/costco-candy.jpg')) && 'missing local/test-images photo fixture (host-specific, gitignored)' },
  async () => {
    const { prepareVarietyPackBandContext, runVarietyPackGridPipeline } = await import(
      '../../../integrations/varietyPackGridPipeline.js'
    );
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(path.join(repoRoot, 'local/test-images/costco-candy.jpg'));
    const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
    const plan = pipeline.plan;
    const step3 = pipeline.steps[3].data;
    assert.ok(plan && step3);
    const gt = await loadGlareGroundTruthForImage('costco-candy.jpg', fixturesDir);
    assert.ok(gt);

    const bodyTop = plan.nutrientBodyTop;
    const pitch = plan.rowPitchPx;
    const firstRule =
      plan.rowBandSlices.find((s) => s.top > bodyTop + pitch * 0.5)?.top ??
      bodyTop + Math.round(pitch * 2.5);

    const rulesPerCol = plan.valueColumns.map((_, i) => {
      const seg = plan.valueColumnAnalysisSegments?.[i] ?? step3.valueColumns[i];
      return seg ? [firstRule] : [];
    });

    for (const colSpec of gt.columns) {
      const planIdx = plan.valueColumns.findIndex((_, i) => {
        const seg = plan.valueColumnAnalysisSegments?.[i];
        return valueColumnIndexForAnalysisSegment(seg, step3.valueColumns) === colSpec.valueColumnIndex;
      });
      assert.ok(planIdx >= 0, `plan strip for value column ${colSpec.valueColumnIndex}`);
      const targets = resolveGlareGroundTruthRowTargets({
        groundTruth: gt,
        step3ValueColumns: step3.valueColumns,
        planStripColumnIndex: planIdx,
        valueColumnIndex: colSpec.valueColumnIndex,
        headerSlices: plan.headerRowBandSlicesPerColumn[planIdx] ?? [],
        bodySlices: plan.valueRowBandSlicesPerColumn[planIdx] ?? [],
        bodyTopImage: bodyTop,
        firstInteriorRuleYImage: firstRule,
        rowPitchPx: pitch,
        valueRulesImagePerColumn: rulesPerCol,
      });
      assert.ok(targets.length >= colSpec.glare.length, `targets for col ${colSpec.valueColumnIndex}`);
    }
  },
);