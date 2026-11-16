import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  columnBodyGlareMask,
  columnTrustsRuleAtY,
} from '../../../integrations/bandLuminanceCluster.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../../../domain/sharedLabelGridParams.js';

test('columnBodyGlareMask flags localized bright band only', () => {
  const width = 40;
  const height = 280;
  const pixels = new Uint8Array(width * height).fill(120);
  const x0 = 10;
  const x1 = 30;
  const y0 = 40;
  const y1 = 240;
  for (let y = 110; y < 150; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      pixels[y * width + x] = 252;
    }
  }
  const g = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const mask = columnBodyGlareMask(pixels, width, height, x0, x1, y0, y1, {
    maxGlareMassFraction: g.rowSurfaceWarpMaxGlareMassFraction,
    maxBrightPixelFraction: g.rowSurfaceWarpMaxGlareBrightPixelFraction,
    maxBandBrightPixelFraction: g.rowSurfaceWarpMaxGlareBandBrightPixelFraction,
    bandCount: g.rowSurfaceGlareBodyBandCount,
    glareCapMaxForMassRule: 248,
  });
  assert.equal(columnTrustsRuleAtY(mask, 60), true);
  assert.equal(columnTrustsRuleAtY(mask, 130), false);
  assert.ok(mask.untrusted.some(Boolean));
  assert.ok(!mask.untrusted.every(Boolean));
  assert.ok(mask.peakBandBrightPixelFraction > g.rowSurfaceWarpMaxGlareBandBrightPixelFraction);
});