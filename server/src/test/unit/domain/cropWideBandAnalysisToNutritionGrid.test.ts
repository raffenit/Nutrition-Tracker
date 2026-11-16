import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cropWideBandAnalysisToNutritionGrid,
  sliceAnalysisBandPixels,
} from '../../../domain/cropWideBandAnalysisToNutritionGrid.js';
import { DEFAULT_SHARED_LABEL_GRID } from '../../fixtures/syntheticVarietyPackGrids.js';
import { paintSharedLabelGrid } from '../../fixtures/syntheticVarietyPackGrids.js';

test('sliceAnalysisBandPixels copies horizontal span', () => {
  const w = 100;
  const h = 4;
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 20; x < 80; x += 1) pixels[y * w + x] = 50;
  }
  const slice = sliceAnalysisBandPixels(pixels, w, h, 20, 80);
  assert.equal(slice.length, 60 * h);
  assert.equal(slice[0], 50);
  assert.equal(slice[59], 50);
});

test('cropWideBandAnalysisToNutritionGrid trims open margins on synthetic shared grid', () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  pixels.fill(180);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < 40; x += 1) pixels[y * width + x] = 220;
    for (let x = width - 50; x < width; x += 1) pixels[y * width + x] = 220;
  }
  const band = { left: 0, top: 10, width: 4000, height: 1000 };
  const cropped = cropWideBandAnalysisToNutritionGrid(
    { band, fullWidth: 4000, fullHeight: 1800, analysisW: width, analysisH: height, pixels },
  );
  assert.ok(cropped.analysisW < width - 60, `expected margin trim, got width ${cropped.analysisW}`);
  assert.ok(cropped.band.left > band.left);
  assert.ok(cropped.band.width < band.width);
});