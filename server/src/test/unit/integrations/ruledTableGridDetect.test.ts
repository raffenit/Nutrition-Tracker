import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../../../domain/ruledTableGridParams.js';
import { valueColumnsFromRuledGrid } from '../../../integrations/ruledTableGridDetect.js';

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
