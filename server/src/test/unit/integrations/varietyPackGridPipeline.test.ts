import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  prepareVarietyPackBandContext,
  runVarietyPackGridStep1,
  runVarietyPackGridStep2,
  runVarietyPackGridStep3,
  runVarietyPackGridStep4,
  runVarietyPackGridPipeline,
} from '../../../integrations/varietyPackGridPipeline.js';

const VALUE_GRID = {
  labelFraction: 0.2,
  count: 5,
  columnFraction: 0.1,
  gutterFraction: 0.025,
} as const;

function paintSharedLabelGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  spec: typeof VALUE_GRID,
  ink = 30,
  background = 250,
): void {
  pixels.fill(background);
  const labelWidth = Math.round(width * spec.labelFraction);
  for (let y = Math.round(height * 0.12); y < height * 0.88; y += 1) {
    for (let x = 0; x < labelWidth; x += 1) {
      pixels[y * width + x] = ink;
    }
  }
  let x = labelWidth + Math.round(width * spec.gutterFraction);
  const colW = Math.round(width * spec.columnFraction);
  const gutterW = Math.round(width * spec.gutterFraction);
  const ruleInk = Math.min(255, ink + 50);
  for (let i = 0; i < spec.count; i += 1) {
    const colX0 = x;
    for (let y = Math.round(height * 0.18); y < height * 0.88; y += 1) {
      for (let cx = x; cx < x + colW && cx < width; cx += 1) {
        pixels[y * width + cx] = ink;
      }
    }
    for (let rule = 0; rule < 8; rule += 1) {
      const ry = Math.round(height * (0.22 + rule * 0.07));
      for (let cx = colX0 + 2; cx < colX0 + colW - 2 && cx < width; cx += 1) {
        pixels[ry * width + cx] = ruleInk;
      }
    }
    x += colW + gutterW;
  }
}

async function syntheticPng(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, VALUE_GRID);
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test('variety pack pipeline steps gate sequentially on synthetic grid', async () => {
  const bytes = await syntheticPng(1200, 300);
  const ctx = await prepareVarietyPackBandContext(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(ctx);

  const step1 = runVarietyPackGridStep1(ctx!);
  assert.equal(step1.validation.ok, true, step1.validation.message);
  assert.ok(step1.data!.productColumns.length >= VALUE_GRID.count);

  const step2 = runVarietyPackGridStep2(ctx!, step1.data!);
  assert.equal(step2.validation.ok, true, step2.validation.message);

  const step3 = runVarietyPackGridStep3(ctx!, step1.data!);
  assert.equal(step3.validation.ok, true, step3.validation.message);
  assert.equal(step3.data!.layout, 'shared_rail');

  const step4 = runVarietyPackGridStep4(ctx!, step3.data!);
  assert.equal(step4.validation.ok, true, step4.validation.message);
  assert.ok(step4.data!.rowBandYs.length >= 4);
});

test('runVarietyPackGridPipeline stopAfterStep halts before OCR plan', async () => {
  const bytes = await syntheticPng(1200, 300);
  const at1 = await runVarietyPackGridPipeline(bytes, { stopAfterStep: 1, requireWideAspect: true });
  assert.equal(at1.lastOkStep, 1);
  assert.equal(at1.plan, null);

  const full = await runVarietyPackGridPipeline(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.equal(full.lastOkStep, 4);
  assert.ok(full.plan);
  assert.equal(full.plan!.valueColumns.length, VALUE_GRID.count);
});
