import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { DEFAULT_FOCUS_CROP_PARAMS } from '../../../domain/focusCropParams.js';
import { IMAGE_MIN_SIDE_FRACTION, IMAGE_ANALYSIS_WIDTH, minSideLengthPx } from '../../../domain/imageAnalysisGeometry.js';
import { focusCropVariants, laplacianFocusRectForTest } from '../../../integrations/focusCrop.js';

function paintSharpBand(
  pixels: Uint8Array,
  width: number,
  height: number,
  bandTopFraction: number,
  bandHeightFraction: number,
): void {
  pixels.fill(220);
  const y0 = Math.round(height * bandTopFraction);
  const y1 = Math.min(height, y0 + Math.round(height * bandHeightFraction));
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const stripe = x % 8 < 4 ? 40 : 200;
      pixels[y * width + x] = stripe;
    }
  }
}

async function syntheticLabelPng(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  paintSharpBand(pixels, width, height, 0.38, 0.22);
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test('focus crop params avoid raw pixel gates', () => {
  const p = DEFAULT_FOCUS_CROP_PARAMS;
  assert.equal(p.analysisWidth, IMAGE_ANALYSIS_WIDTH);
  assert.equal(p.minImageSideFraction, IMAGE_MIN_SIDE_FRACTION);
  assert.ok(p.minCropSideFraction > 0 && p.minCropSideFraction < 0.1);
});

test('focusCropVariants skips images below min side fraction', async () => {
  const minSide = minSideLengthPx() - 1;
  const bytes = await sharp({
    create: { width: minSide, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  assert.equal((await focusCropVariants(sharp(bytes).rotate())).length, 0);
});

test('laplacian focus rect tracks high-frequency band across scales', async () => {
  const referenceHeight = 600;
  const referenceWidth = 800;
  const refPixels = new Uint8Array(referenceWidth * referenceHeight);
  paintSharpBand(refPixels, referenceWidth, referenceHeight, 0.38, 0.22);
  const reference = laplacianFocusRectForTest(refPixels, referenceWidth, referenceHeight);
  assert.ok(reference);
  const refCenterY = (reference!.top + reference!.height / 2) / referenceHeight;

  for (const scale of [0.5, 2]) {
    const width = Math.round(referenceWidth * scale);
    const height = Math.round(referenceHeight * scale);
    const pixels = new Uint8Array(width * height);
    paintSharpBand(pixels, width, height, 0.38, 0.22);
    const rect = laplacianFocusRectForTest(pixels, width, height);
    assert.ok(rect, `scale=${scale}`);
    const centerY = (rect!.top + rect!.height / 2) / height;
    assert.ok(Math.abs(centerY - refCenterY) < 0.06, `vertical center drift at scale ${scale}`);
  }
});

test('focusCropVariants returns crops for a valid label photo', async () => {
  const bytes = await syntheticLabelPng(800, 600);
  const crops = await focusCropVariants(sharp(bytes).rotate());
  assert.ok(crops.length >= 1);
});
