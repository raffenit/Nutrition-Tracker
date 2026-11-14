import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../../../domain/sharedLabelGridParams.js';
import {
  consolidateRowBandRuleYs,
  mergeSmallRowBandSlices,
  nutrientBodyExtents,
  prepareRowBandSlicesForOcr,
  rowBandSlicesBetweenRules,
  splitOversizedRowBandSlices,
} from '../../../domain/sharedLabelGridLayout.js';

test('rowBandSlicesBetweenRules splits body at rule lines', () => {
  const slices = rowBandSlicesBetweenRules(100, 250, [140, 180, 220]);
  assert.equal(slices.length, 4);
  assert.equal(slices[0]!.top, 100);
  assert.equal(slices[0]!.height, 40);
  assert.equal(slices[3]!.top, 220);
  assert.equal(slices[3]!.height, 30);
});

test('consolidateRowBandRuleYs merges double horizontal rules', () => {
  const ys = consolidateRowBandRuleYs([100, 108, 140, 148, 180], 20);
  assert.deepEqual(ys, [100, 140, 180]);
});

test('mergeSmallRowBandSlices merges only hairline slivers', () => {
  const merged = mergeSmallRowBandSlices(
    [
      { rowIndex: 0, top: 10, height: 12 },
      { rowIndex: 1, top: 22, height: 14 },
      { rowIndex: 2, top: 36, height: 40 },
    ],
    28,
  );
  assert.equal(merged.length, 2);
  assert.equal(merged[0]!.height, 26);
  assert.equal(merged[1]!.height, 40);
});

test('splitOversizedRowBandSlices subdivides tall bands at interior rules', () => {
  const rules = [120, 170, 220];
  const slices = [{ rowIndex: 0, top: 100, height: 130 }];
  const out = splitOversizedRowBandSlices(slices, rules, 50, 1.22, 19);
  assert.ok(out.length >= 2);
  assert.ok(out.every((s) => s.height <= 70));
});

test('splitOversizedRowBandSlices subdivides by pitch when no interior rules', () => {
  const slices = [{ rowIndex: 0, top: 214, height: 119 }];
  const out = splitOversizedRowBandSlices(slices, [333], 44, 1.22, 17);
  assert.equal(out.length, 3);
  assert.equal(out.reduce((n, s) => n + s.height, 0), 119);
});

test('prepareRowBandSlicesForOcr keeps one band per rule gap (hairline merge only)', () => {
  const grid = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const { slices, rowPitchPx } = prepareRowBandSlicesForOcr(100, 400, [120, 128, 156, 164, 192, 200, 228], grid);
  assert.ok(rowPitchPx > 0);
  assert.ok(slices.length >= 3);
  const medianH = slices.map((s) => s.height).sort((a, b) => a - b)[Math.floor(slices.length / 2)]!;
  assert.ok(
    medianH <= rowPitchPx * grid.rowBandMaxMedianSlicePitchRatio + 8,
    `median slice ${medianH}px vs pitch ${rowPitchPx}px`,
  );
});

test('nutrientBodyExtents maps analysis row bands into OCR band slices', () => {
  const layout = nutrientBodyExtents(300, 45, [80, 120, 160, 200], 50, 400, DEFAULT_SHARED_LABEL_GRID_PARAMS);
  assert.ok(layout.top > 50);
  assert.ok(layout.height < 400);
  assert.ok(layout.rowBandSlices.length >= 3);
});
