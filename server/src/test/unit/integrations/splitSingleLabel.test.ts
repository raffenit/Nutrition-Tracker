import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { detectSplitSingleLabel } from '../../../integrations/splitSingleLabel.js';
import { runVarietyPackGridPipeline } from '../../../integrations/varietyPackGridPipeline.js';
import { detectSharedLabelValueGrid } from '../../../integrations/sharedLabelValueGrid.js';

async function twoHalvesPng(width: number, height: number, gutterFraction = 0.04): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  pixels.fill(250);
  const gutter = Math.round(width * gutterFraction);
  const half = Math.round((width - gutter) / 2);
  const ink = 40;
  for (let y = Math.round(height * 0.1); y < Math.round(height * 0.9); y += 1) {
    for (let x = Math.round(width * 0.05); x < half; x += 1) pixels[y * width + x] = ink;
    for (let x = half + gutter; x < width * 0.95; x += 1) pixels[y * width + x] = ink;
  }
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test('detectSplitSingleLabel finds two equal halves when single-subject hint', async () => {
  const bytes = await twoHalvesPng(1100, 400);
  const hint = { singleSubjectInFocus: true, sharpPeakCount: 5 };
  const pipeline = await runVarietyPackGridPipeline(bytes, {
    requireWideAspect: false,
    layoutHint: hint,
  });
  assert.equal(pipeline.steps[3].data?.layout, 'split_single');
  assert.equal(pipeline.plan, null);
  const plan = await detectSplitSingleLabel(bytes, hint);
  assert.ok(plan);
  assert.equal(plan!.strips.length, 2);
  const ratio = plan!.strips[0]!.width / plan!.strips[1]!.width;
  assert.ok(ratio > 0.8 && ratio < 1.25);
});

test('detectSplitSingleLabel skips shared label grid layouts', async () => {
  const width = 1200;
  const height = 300;
  const pixels = new Uint8Array(width * height);
  pixels.fill(250);
  const labelW = Math.round(width * 0.2);
  for (let y = 40; y < 260; y += 1) {
    for (let x = 0; x < labelW; x += 1) pixels[y * width + x] = 35;
  }
  let x = labelW + 20;
  const ruleInk = 85;
  for (let col = 0; col < 5; col += 1) {
    const colX0 = x;
    for (let y = 50; y < 250; y += 1) {
      for (let cx = x; cx < x + 80; cx += 1) pixels[y * width + cx] = 35;
    }
    for (let rule = 0; rule < 6; rule += 1) {
      const ry = Math.round(height * (0.22 + rule * 0.07));
      for (let cx = colX0 + 2; cx < colX0 + 78; cx += 1) pixels[ry * width + cx] = ruleInk;
    }
    x += 100;
  }
  const bytes = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  assert.ok(await detectSharedLabelValueGrid(bytes));
  const split = await detectSplitSingleLabel(bytes, { singleSubjectInFocus: true, sharpPeakCount: 5 });
  assert.equal(split, null);
});
