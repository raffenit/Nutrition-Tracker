import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../../../domain/ruledTableGridParams.js';
import {
  brightVerticalGutterCentersAbs,
  categoriesFromRuledGrid,
  estimateValueColumnCountFromGutters,
  valueColumnsFromRuledGrid,
} from '../../../integrations/ruledTableGridDetect.js';
import { DEFAULT_SHARED_LABEL_GRID, paintSharedLabelGrid } from '../../fixtures/syntheticVarietyPackGrids.js';

function paintRuledColumns(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelFraction: number,
  columns: number,
): void {
  pixels.fill(245);
  const labelW = Math.round(width * labelFraction);
  const valueW = width - labelW;
  const gutter = Math.round(valueW * 0.02);
  const colW = Math.round((valueW - gutter * (columns - 1)) / columns);
  const ink = 28;
  const rule = 90;
  let x = labelW;
  for (let c = 0; c < columns; c += 1) {
    const x0 = x;
    for (let y = Math.round(height * 0.15); y < height * 0.9; y += 1) {
      for (let cx = x; cx < x + colW; cx += 1) {
        pixels[y * width + cx] = ink;
      }
    }
    for (let r = 0; r < 6; r += 1) {
      const y = Math.round(height * (0.2 + r * 0.1));
      for (let cx = x0 + 1; cx < x0 + colW - 1; cx += 1) {
        pixels[y * width + cx] = rule;
      }
    }
    x += colW + gutter;
  }
}

test('gutter detect ignores isolated specular glare when profiling', () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  const labelStart = 120;
  paintRuledColumns(pixels, width, height, labelStart / width, 5);
  for (let y = 40; y < 160; y += 1) {
    pixels[y * width + 300] = 255;
    pixels[y * width + 301] = 254;
  }
  const segments = valueColumnsFromRuledGrid(
    pixels,
    width,
    height,
    labelStart,
    { ...DEFAULT_RULED_TABLE_GRID_PARAMS, minHorizontalRulesPerColumn: 3 },
    12,
  );
  assert.equal(segments.length, 5);
});

test('valueColumnsFromRuledGrid finds columns from gutters and horizontal rules', () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  const labelStart = 120;
  paintRuledColumns(pixels, width, height, labelStart / width, 5);
  const segments = valueColumnsFromRuledGrid(
    pixels,
    width,
    height,
    labelStart,
    { ...DEFAULT_RULED_TABLE_GRID_PARAMS, minHorizontalRulesPerColumn: 3 },
    12,
  );
  assert.equal(segments.length, 5);
  for (const segment of segments) {
    assert.ok(segment.x0 >= labelStart);
    assert.ok(segment.x1 > segment.x0);
  }
});

test('ink-bounded vertical gutters ignore open bright margin past last column', () => {
  const width = 1200;
  const height = 120;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  const labelStart = Math.round(width * DEFAULT_SHARED_LABEL_GRID.labelFraction);
  const gutterCenters = brightVerticalGutterCentersAbs(
    pixels,
    width,
    height,
    labelStart,
    width,
    { ...DEFAULT_RULED_TABLE_GRID_PARAMS, minHorizontalRulesPerColumn: 3 },
  );
  assert.equal(
    gutterCenters.length,
    DEFAULT_SHARED_LABEL_GRID.count,
    'value scan should see one gutter per column boundary, not open margin',
  );
  assert.equal(
    estimateValueColumnCountFromGutters(pixels, width, height, labelStart, width),
    DEFAULT_SHARED_LABEL_GRID.count,
  );
});

test('ruled categories match value column count on shared-value ruled synthetic', () => {
  const width = 1200;
  const height = 300;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  const labelStart = Math.round(width * DEFAULT_SHARED_LABEL_GRID.labelFraction);
  const cats = categoriesFromRuledGrid(pixels, width, height, labelStart, undefined, 12, {
    requireHorizontalRules: true,
  });
  assert.ok(cats.length >= DEFAULT_SHARED_LABEL_GRID.count);
  assert.ok(cats.length <= DEFAULT_SHARED_LABEL_GRID.count + 1);
});
