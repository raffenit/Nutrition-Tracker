import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../../../domain/sharedLabelGridParams.js';
import {
  consolidateRowBandRuleYs,
  disjointRowBandSlices,
  expandRowBandSlicesToMinReadableHeight,
  alignNutrientSpanBordersToConsensus,
  alignWarpedNutrientTailToConsensus,
  fanWarpedNutrientSkewFromFooterRule,
  nutrientTableClosingFooterY,
  mergeSmallRowBandSlices,
  repairHairlineNutrientBands,
  nutrientBodyExtents,
  prepareRowBandSlicesForOcr,
  rowBandSlicesBetweenRules,
  splitOversizedRowBandSlices,
} from '../../../domain/sharedLabelGridLayout.js';

test('expandRowBandSlicesToMinReadableHeight grows short bands for small tables', () => {
  const grid = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const out = expandRowBandSlicesToMinReadableHeight(
    [
      { rowIndex: 0, top: 100, height: 50 },
      { rowIndex: 1, top: 150, height: 30 },
    ],
    50,
    grid,
  );
  assert.ok(out[1]!.height >= 30);
  assert.ok(out[1]!.height > 30 || out[1]!.top < 150);
});

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

test('disjointRowBandSlices trims prior band when expansion overlaps the next', () => {
  const fixed = disjointRowBandSlices(
    [
      { rowIndex: 0, top: 100, height: 106 },
      { rowIndex: 1, top: 102, height: 45 },
    ],
    4,
  );
  assert.equal(fixed[0]!.height, 4);
  assert.equal(fixed[1]!.top, 102);
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

test('mergeSmallRowBandSlices drops row count when hairline merges into neighbor', () => {
  const pitch = 47;
  const hairlineMin = Math.round(pitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction);
  const merged = mergeSmallRowBandSlices(
    [
      { rowIndex: 0, top: 772, height: 44 },
      { rowIndex: 1, top: 816, height: 13 },
      { rowIndex: 2, top: 829, height: 47 },
    ],
    hairlineMin,
  );
  assert.equal(merged.length, 2);
  assert.ok(merged.every((s) => s.height >= hairlineMin));
});

test('repairHairlineNutrientBands snaps interior sliver to consensus without dropping rows', () => {
  const pitch = 47;
  const minReadable = Math.round(pitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction);
  const reference = [
    { rowIndex: 0, top: 772, height: 44 },
    { rowIndex: 1, top: 816, height: 45 },
    { rowIndex: 2, top: 861, height: 44 },
  ];
  const skewed = [
    { rowIndex: 0, top: 772, height: 44, topSkewPx: 0, bottomSkewPx: 4 },
    { rowIndex: 1, top: 816, height: 13, topSkewPx: 4, bottomSkewPx: 31 },
    { rowIndex: 2, top: 829, height: 47, topSkewPx: 31, bottomSkewPx: 26 },
  ];
  const repaired = repairHairlineNutrientBands(skewed, reference, pitch);
  assert.equal(repaired.length, 3);
  assert.ok(repaired.every((s) => s.height >= minReadable));
  assert.equal(repaired[1]!.top, 816);
  assert.equal(repaired[1]!.height, 45);
  assert.equal(repaired[1]!.bottomSkewPx, 0);
});

test('alignWarpedNutrientTailToConsensus snaps supplemental drift while keeping head skew', () => {
  const pitch = 47;
  const reference = [
    { rowIndex: 0, top: 1077, height: 45 },
    { rowIndex: 1, top: 1122, height: 46 },
    { rowIndex: 2, top: 1168, height: 35 },
    { rowIndex: 3, top: 1203, height: 43 },
  ];
  const warped = [
    { rowIndex: 0, top: 1066, height: 47, bottomSkewPx: 4 },
    { rowIndex: 1, top: 1113, height: 48, bottomSkewPx: 4 },
    { rowIndex: 2, top: 1161, height: 36, bottomSkewPx: 4 },
    { rowIndex: 3, top: 1197, height: 43, bottomSkewPx: 4 },
  ];
  const out = alignWarpedNutrientTailToConsensus(warped, reference, pitch, {
    ...DEFAULT_SHARED_LABEL_GRID_PARAMS,
    warpNutrientTailAlignRowCount: 4,
  });
  assert.equal(out[0]!.top, 1077);
  assert.equal(out[2]!.top, 1168);
  assert.equal(out[2]!.height, 35);
});

test('fanWarpedNutrientSkewFromFooterRule ramps skew from preamble to footer ink spread', () => {
  const skewMin = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;
  const preambleEnd = 673;
  const footerY = 1415;
  const spread = 28;
  const reference = [
    { rowIndex: 0, top: 772, height: 44 },
    { rowIndex: 1, top: 816, height: 45 },
    { rowIndex: 2, top: 1077, height: 45 },
  ];
  const flat = reference.map((s) => ({ ...s, topSkewPx: 0, bottomSkewPx: 0 }));
  const out = fanWarpedNutrientSkewFromFooterRule(
    flat,
    reference,
    preambleEnd,
    footerY,
    spread,
    2,
    skewMin,
  );
  assert.equal(out[0]!.topSkewPx, 0);
  assert.ok((out[0]!.bottomSkewPx ?? 0) > 0);
  assert.ok((out[1]!.bottomSkewPx ?? 0) > (out[0]!.bottomSkewPx ?? 0));
  assert.ok((out[2]!.bottomSkewPx ?? 0) >= spread);
});

test('nutrientTableClosingFooterY extends past last interior row toward band footer', () => {
  const pitch = 47;
  const reference = [
    { rowIndex: 0, top: 673, height: 37 },
    { rowIndex: 1, top: 1343, height: 37 },
  ];
  const footer = nutrientTableClosingFooterY(561, 1375.6, 1434, pitch, [710, 1380], reference);
  assert.ok(footer > 1380);
  assert.ok(footer <= 1434);
});

test('alignNutrientSpanBordersToConsensus pins first top and last footer to reference', () => {
  const pitch = 47;
  const reference = [
    { rowIndex: 0, top: 673, height: 37 },
    { rowIndex: 1, top: 710, height: 49 },
    { rowIndex: 2, top: 1343, height: 37 },
  ];
  const warped = [
    { rowIndex: 0, top: 723, height: 50, bottomSkewPx: 4 },
    { rowIndex: 1, top: 772, height: 44, bottomSkewPx: 4 },
    { rowIndex: 2, top: 1337, height: 38.6, bottomSkewPx: 0 },
  ];
  const aligned = alignNutrientSpanBordersToConsensus(warped, reference, pitch);
  assert.equal(aligned[0]!.top, 673);
  assert.equal(aligned[0]!.top + aligned[0]!.height, 773);
  assert.equal(aligned[2]!.top + aligned[2]!.height, 1380);
});

test('repairHairlineNutrientBands no-ops when slice lengths differ from reference', () => {
  const pitch = 44;
  const reference = [
    { rowIndex: 0, top: 710, height: 49 },
    { rowIndex: 1, top: 759, height: 44 },
  ];
  const skewed = [{ rowIndex: 0, top: 710, height: 93 }];
  const out = repairHairlineNutrientBands(skewed, reference, pitch);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.height, 93);
});

test('splitOversizedRowBandSlices subdivides tall bands at interior rules', () => {
  const rules = [120, 170, 220];
  const slices = [{ rowIndex: 0, top: 100, height: 130 }];
  const out = splitOversizedRowBandSlices(slices, rules, 50, 1.22, 19);
  assert.ok(out.length >= 2);
  assert.ok(out.every((s) => s.height <= 70));
});

test('splitOversizedRowBandSlices keeps one band when no interior rules (no empty-cell pitch chop)', () => {
  const slices = [{ rowIndex: 0, top: 214, height: 119 }];
  const out = splitOversizedRowBandSlices(slices, [333], 44, 1.22, 17);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.height, 119);
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
