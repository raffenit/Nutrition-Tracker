import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { DEFAULT_COLUMN_STRIP_DETECT_PARAMS } from '../../../domain/columnStripDetectParams.js';
import { prepareWideBandAnalysis } from '../../../integrations/labelColumnStrips.js';
import {
  collectColumnGeometryWitnesses,
  columnSegmentsForLayout,
  fitSplitSingleColumns,
  fitUniformValueColumns,
  countInteriorVerticalGutters,
  interiorVerticalGutterPenalty,
  pickLeadingLayoutHypothesis,
  pickVarietyPackSubtype,
  scoreLayoutHypotheses,
} from '../../../integrations/labelTableLayoutFit.js';
import {
  DEFAULT_PER_COLUMN_LABEL_GRID,
  DEFAULT_SHARED_LABEL_GRID,
  paintPerColumnLabelGrid,
  paintSharedLabelGrid,
} from '../../fixtures/syntheticVarietyPackGrids.js';

async function twoHalvesGrey(width: number, height: number): Promise<{ pixels: Uint8Array; w: number; h: number }> {
  const pixels = new Uint8Array(width * height);
  pixels.fill(250);
  const gutter = Math.round(width * 0.04);
  const half = Math.round((width - gutter) / 2);
  const ink = 40;
  for (let y = Math.round(height * 0.1); y < Math.round(height * 0.9); y += 1) {
    for (let x = Math.round(width * 0.05); x < half; x += 1) pixels[y * width + x] = ink;
    for (let x = half + gutter; x < width * 0.95; x += 1) pixels[y * width + x] = ink;
  }
  return { pixels, w: width, h: height };
}

test('layout hypothesis picks split_single when focus hint and equal-half fit align', async () => {
  const { pixels, w, h } = await twoHalvesGrey(1100, 400);
  const bytes = await sharp(pixels, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  const band = await prepareWideBandAnalysis(bytes, DEFAULT_COLUMN_STRIP_DETECT_PARAMS, 'detection');
  assert.ok(band);

  const witnesses = collectColumnGeometryWitnesses(
    band.pixels,
    band.analysisW,
    band.analysisH,
    DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    8,
  );
  const hint = { singleSubjectInFocus: true, sharpPeakCount: 5 };
  const scores = scoreLayoutHypotheses(witnesses, hint);
  assert.equal(pickLeadingLayoutHypothesis(scores), 'split_single');

  const segments = fitSplitSingleColumns(witnesses);
  assert.ok(segments);
  assert.equal(segments!.length, 2);
  const wl = segments![0]!.x1 - segments![0]!.x0;
  const wr = segments![1]!.x1 - segments![1]!.x0;
  const ratio = wl < wr ? wl / wr : wr / wl;
  assert.ok(ratio > 0.85, `expected equal halves, ratio=${ratio}`);
});

test('interior vertical gutter penalty hits gutters inside wide column segments', () => {
  const segments = [{ x0: 0, x1: 200 }];
  const gutters = [100];
  const penalty = interiorVerticalGutterPenalty(gutters, segments);
  assert.ok(penalty >= 0.09, `expected dock for mid-column gutter, got ${penalty}`);
  const edgeOnly = interiorVerticalGutterPenalty([5, 195], segments);
  assert.ok(edgeOnly < penalty, 'gutters near edges should dock less than interior');
});

test('per_column hypothesis docks when ruled columns swallow label/value gutter', async () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height);

  const witnesses = collectColumnGeometryWitnesses(
    pixels,
    width,
    height,
    DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    14,
  );
  const scores = scoreLayoutHypotheses(witnesses);
  const perCol = scores.find((s) => s.layout === 'per_column_labels')!;
  const shared = scores.find((s) => s.layout === 'shared_rail')!;
  assert.ok(perCol.score < shared.score, `shared ${shared.score} should beat per-column ${perCol.score}`);
  assert.equal(pickVarietyPackSubtype(scores), 'shared_rail');
});

test('fitUniformValueColumns snaps noisy witness counts to equal value grid', async () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  pixels.fill(248);
  const labelW = 120;
  const valueStart = labelW;
  for (let y = 40; y < 160; y += 1) {
    for (let x = 0; x < labelW; x += 1) pixels[y * width + x] = 35;
  }
  let x = valueStart + 8;
  for (let col = 0; col < 5; col += 1) {
    for (let y = 50; y < 150; y += 1) {
      for (let cx = x; cx < x + 88; cx += 1) pixels[y * width + cx] = 35;
    }
    for (let rule = 0; rule < 6; rule += 1) {
      const ry = Math.round(height * (0.22 + rule * 0.07));
      for (let cx = x + 2; cx < x + 86; cx += 1) pixels[ry * width + cx] = 90;
    }
    x += 96;
  }

  const witnesses = collectColumnGeometryWitnesses(
    pixels,
    width,
    height,
    DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    14,
  );
  const fitted = fitUniformValueColumns(witnesses, valueStart, width, 14, 4);
  assert.ok(fitted.length >= 4 && fitted.length <= 6);
  const widths = fitted.map((s) => s.x1 - s.x0);
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  const cv = Math.sqrt(widths.reduce((s, w) => s + (w - mean) ** 2, 0) / widths.length) / mean;
  assert.ok(cv < 0.05, `uniform snap cv=${cv}`);
});

test('split_single segments place gutter at band center not inside half columns', async () => {
  const { pixels, w, h } = await twoHalvesGrey(1100, 400);
  const witnesses = collectColumnGeometryWitnesses(pixels, w, h, DEFAULT_COLUMN_STRIP_DETECT_PARAMS, 8);
  const segs = columnSegmentsForLayout('split_single', witnesses);
  assert.equal(segs.length, 2);
  const hits = countInteriorVerticalGutters(witnesses.verticalGutterCenters, segs);
  assert.ok(hits <= 1, `split-single should have at most one stray interior gutter, got ${hits}`);
});

test('pickVarietyPackSubtype prefers per_column on uniform full-width ruled stacks', () => {
  const width = 1200;
  const height = 300;
  const pixels = new Uint8Array(width * height);
  paintPerColumnLabelGrid(pixels, width, height, DEFAULT_PER_COLUMN_LABEL_GRID);
  const witnesses = collectColumnGeometryWitnesses(
    pixels,
    width,
    height,
    DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    12,
  );
  const scores = scoreLayoutHypotheses(witnesses);
  assert.equal(pickVarietyPackSubtype(scores), 'per_column_labels');
  const perCol = scores.find((s) => s.layout === 'per_column_labels')!.score;
  const shared = scores.find((s) => s.layout === 'shared_rail')!.score;
  assert.ok(perCol > shared, `per_column ${perCol} vs shared ${shared}`);
});

test('pickVarietyPackSubtype prefers shared_rail when first ruled segment is wide label rail', () => {
  const width = 1200;
  const height = 300;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  const witnesses = collectColumnGeometryWitnesses(
    pixels,
    width,
    height,
    DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    12,
  );
  const scores = scoreLayoutHypotheses(witnesses);
  assert.equal(pickVarietyPackSubtype(scores), 'shared_rail');
});
