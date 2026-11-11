import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COLUMN_STRIP_DETECT_PARAMS } from '../../../domain/columnStripDetectParams.js';
import { bandToAnalysisSize } from '../../../integrations/imageAnalysisResample.js';

test('bandToAnalysisSize preserves geometry across large and small bands', () => {
  const p = DEFAULT_COLUMN_STRIP_DETECT_PARAMS;
  const small = bandToAnalysisSize(320, 120, p.analysisWidth, p.minAnalysisWidthFraction, p.minAnalysisHeightFraction);
  const large = bandToAnalysisSize(2400, 900, p.analysisWidth, p.minAnalysisWidthFraction, p.minAnalysisHeightFraction);
  assert.equal(small.analysisW, 320);
  assert.equal(large.analysisW, p.analysisWidth);
  assert.ok(large.analysisH > small.analysisH);
});
