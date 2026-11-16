import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_COLUMN_STRIP_DETECT_PARAMS } from '../../../domain/columnStripDetectParams.js';
import {
  expandImageBandToInkEnvelope,
  inkRowEnvelopeInGreyBand,
} from '../../../domain/wideBandGridEnvelope.js';

test('inkRowEnvelopeInGreyBand finds vertical span of synthetic ink block', () => {
  const w = 160;
  const h = 120;
  const pixels = new Uint8Array(w * h);
  pixels.fill(240);
  for (let y = 40; y < 80; y += 1) {
    for (let x = 20; x < 140; x += 1) pixels[y * w + x] = 30;
  }
  const env = inkRowEnvelopeInGreyBand(pixels, w, h);
  assert.ok(env);
  assert.ok(env!.y0 <= 42);
  assert.ok(env!.y1 >= 78);
});

test('expandImageBandToInkEnvelope grows band to cover envelope with margin', () => {
  const band = { left: 0, top: 100, width: 800, height: 400 };
  const expanded = expandImageBandToInkEnvelope(
    band,
    1000,
    { y0: 10, y1: 90 },
    100,
    DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
  );
  assert.ok(expanded.top < band.top);
  assert.ok(expanded.height >= band.height);
});