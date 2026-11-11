import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  columnWidthCv,
  detectEqualWidthColumnPair,
  firstColumnWideVsSiblings,
  refineUniformProductColumns,
} from '../../../integrations/uniformColumnGeometry.js';
import { categoriesFromRuledGrid } from '../../../integrations/ruledTableGridDetect.js';

test('firstColumnWideVsSiblings detects label rail wider than product stacks', () => {
  assert.ok(firstColumnWideVsSiblings(168, [80, 82, 79, 81], 1.35));
  assert.ok(!firstColumnWideVsSiblings(123, [128, 131, 129], 1.35));
});

test('detectEqualWidthColumnPair finds two equal halves', () => {
  const pair = detectEqualWidthColumnPair(
    [
      { x0: 50, x1: 350 },
      { x0: 370, x1: 670 },
    ],
    700,
  );
  assert.ok(pair);
  assert.ok(pair!.widthRatio > 0.9);
});

test('categoriesFromRuledGrid plus refine on synthetic 5-column tail', () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  pixels.fill(245);
  const boundary = 130;
  const valueW = width - boundary;
  const gutter = 10;
  const colW = Math.round((valueW - gutter * 4) / 5);
  let x = boundary;
  for (let c = 0; c < 5; c += 1) {
    const x0 = x;
    for (let y = 30; y < 180; y += 1) {
      for (let cx = x; cx < x + colW; cx += 1) pixels[y * width + cx] = 28;
    }
    for (let r = 0; r < 6; r += 1) {
      const y = 40 + r * 20;
      for (let cx = x0 + 1; cx < x0 + colW - 1; cx += 1) pixels[y * width + cx] = 90;
    }
    x += colW + gutter;
  }
  const cats = categoriesFromRuledGrid(pixels, width, height, boundary, {}, 14, { requireHorizontalRules: true });
  const refined = refineUniformProductColumns(
    pixels,
    width,
    height,
    cats.map((c) => ({ x0: c.x0, x1: c.x1 })),
    cats.map((c) => ({ horizontalRuleCount: c.horizontalRuleCount })),
    boundary,
    width,
    14,
  );
  assert.equal(refined.length, 5);
});
