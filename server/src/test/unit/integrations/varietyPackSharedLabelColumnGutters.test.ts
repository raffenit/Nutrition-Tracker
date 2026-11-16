import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DEFAULT_LABEL_TABLE_LAYOUT_PARAMS } from '../../../domain/labelTableLayoutParams.js';
import { countInteriorVerticalGutters } from '../../../integrations/labelTableLayoutFit.js';
import { prepareVarietyPackBandContext, runVarietyPackGridPipeline } from '../../../integrations/varietyPackGridPipeline.js';
import { brightVerticalGutterCentersAbs } from '../../../integrations/ruledTableGridDetect.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const costcoPath = path.join(repoRoot, 'local/test-images/costco-candy.jpg');

test('shared-rail plan columns have no interior vertical gutters (costco fan)', async (t) => {
  if (!existsSync(costcoPath)) {
    t.skip('local costco-candy.jpg not present');
    return;
  }
  const bytes = await readFile(costcoPath);
  const ctx = await prepareVarietyPackBandContext(bytes, { maxColumns: 14 });
  assert.ok(ctx);
  const pipe = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
  const plan = pipe.plan;
  assert.ok(plan);
  const { pixels, analysisW, analysisH } = ctx.bandAnalysis;
  const gutters = brightVerticalGutterCentersAbs(pixels, analysisW, analysisH, 0, analysisW);
  const segments = plan.valueColumnAnalysisSegments ?? [];
  const insetFrac = DEFAULT_LABEL_TABLE_LAYOUT_PARAMS.interiorGutterInsetFraction;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const w = seg.x1 - seg.x0;
    const inset = Math.max(2, Math.round(w * insetFrac));
    const local = brightVerticalGutterCentersAbs(pixels, analysisW, analysisH, seg.x0, seg.x1);
    const interior = local.filter((g) => g > seg.x0 + inset && g < seg.x1 - inset);
    assert.equal(
      interior.length,
      0,
      `column index ${i} ${seg.x0}-${seg.x1} has interior vertical gutter(s) ${interior.join(',')}`,
    );
  }
  const hits = countInteriorVerticalGutters(gutters, segments);
  assert.equal(hits, 0, `plan has ${hits} interior vertical gutter hit(s) vs full-band gutters`);
});