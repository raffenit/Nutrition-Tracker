import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../../../domain/ruledTableGridParams.js';
import { DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS } from '../../../domain/varietyPackGridPipelineParams.js';
import { alignSharedLabelBoundaryToRuledRail } from '../../../integrations/sharedLabelValueGrid.js';
import { paintSharedLabelGrid, DEFAULT_SHARED_LABEL_GRID } from '../../fixtures/syntheticVarietyPackGrids.js';

test('alignSharedLabelBoundaryToRuledRail extends ink boundary to wide left ruled column', () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  const labelStart = Math.round(width * DEFAULT_SHARED_LABEL_GRID.labelFraction);
  const early = Math.round(labelStart * 0.45);
  const aligned = alignSharedLabelBoundaryToRuledRail(
    pixels,
    width,
    height,
    early,
    DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS.sharedRailWidthRatioMin,
    DEFAULT_RULED_TABLE_GRID_PARAMS.minHorizontalRulesPerColumn,
  );
  assert.ok(aligned >= labelStart - 4, `expected ~${labelStart}, got ${aligned}`);
});