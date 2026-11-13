import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useRowBandSliceOcrForPlan } from '../../../integrations/sharedLabelValueGrid.js';
import type { SharedLabelValueGridPlan } from '../../../integrations/sharedLabelValueGrid.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../../../domain/sharedLabelGridParams.js';

function minimalPlan(overrides: Partial<SharedLabelValueGridPlan>): SharedLabelValueGridPlan {
  return {
    band: { left: 0, top: 0, width: 1000, height: 400 },
    labelColumn: { index: 0, left: 0, top: 50, width: 200, height: 300 },
    headerBand: { left: 200, top: 0, width: 800, height: 50 },
    valueColumns: [],
    valueGridAnalysisX: 200,
    nutrientBodyTop: 50,
    nutrientBodyHeight: 300,
    rowBandSlices: [],
    rowPitchPx: 40,
    ...overrides,
  };
}

test('useRowBandSliceOcrForPlan rejects slices much taller than row pitch', () => {
  const plan = minimalPlan({
    rowPitchPx: 40,
    rowBandSlices: [
      { rowIndex: 0, top: 50, height: 95 },
      { rowIndex: 1, top: 145, height: 98 },
      { rowIndex: 2, top: 243, height: 92 },
    ],
  });
  assert.equal(useRowBandSliceOcrForPlan(plan), false);
});

test('useRowBandSliceOcrForPlan accepts row-sized slices', () => {
  const pitch = 42;
  const plan = minimalPlan({
    rowPitchPx: pitch,
    rowBandSlices: Array.from({ length: 6 }, (_, i) => ({
      rowIndex: i,
      top: 50 + i * pitch,
      height: pitch,
    })),
  });
  assert.equal(useRowBandSliceOcrForPlan(plan), plan.rowBandSlices.length >= DEFAULT_SHARED_LABEL_GRID_PARAMS.minRowBandSlicesForRowOcr);
});
