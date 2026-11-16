import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../../../domain/sharedLabelGridParams.js';
import {
  enforceValueColumnAnalysisBoundsMinWidthVsMedian,
  enforceValueColumnsDisjointFromLabel,
  expandValueColumnAnalysisBounds,
  imageValueColumnStripsFromAnalysisSegments,
  snapValueColumnAnalysisBoundsToBodyInk,
  looksLikeLeadingLabelBleedColumn,
  productValueSegmentsRightOfLabel,
  separateSharedLabelValueTexts,
  valueColumnTextLooksLikeLabelRail,
  valueColumnAnalysisSegmentsAligned,
  valueColumnAnalysisBoundsFromSharedVerticalRules,
} from '../../../domain/sharedLabelColumnSeparation.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const costcoSnapshotPath = path.join(
  repoRoot,
  'server/src/test/fixtures/costcoCandySharedLabelOcr.snapshot.json',
);

test('snapValueColumnAnalysisBoundsToBodyInk shifts toward body ink occupancy', () => {
  const w = 120;
  const h = 80;
  const pixels = new Uint8Array(w * h).fill(220);
  for (let y = 20; y < 60; y += 1) {
    for (let x = 52; x < 70; x += 1) pixels[y * w + x] = 30;
  }
  const roles = {
    background: 220,
    ink: 30,
    polarity: 'dark_on_light' as const,
    glareCap: 255,
    clusterCount: 2,
    clusters: [],
  };
  const segments = [{ x0: 40, x1: 82 }];
  const snapped = snapValueColumnAnalysisBoundsToBodyInk(
    pixels,
    w,
    h,
    segments,
    18,
    62,
    roles,
    10,
    DEFAULT_SHARED_LABEL_GRID_PARAMS,
    segments,
    w,
  );
  assert.ok(snapped[0]!.x0 >= segments[0]!.x0);
  assert.ok(snapped[0]!.x0 <= 53);
  assert.ok(snapped[0]!.x1 >= 68);
});

test('valueColumnAnalysisBoundsFromSharedVerticalRules ends wide stack at inner rule when stacks gapped', () => {
  const stacks = [
    { x0: 328, x1: 367 },
    { x0: 385, x1: 425 },
  ];
  const out = valueColumnAnalysisBoundsFromSharedVerticalRules(stacks, 98, 491);
  assert.equal(out[0]!.x1, 367);
  assert.equal(out[1]!.x0, 367);
  assert.equal(out[0]!.x1, out[1]!.x0);
});

test('valueColumnAnalysisBoundsFromSharedVerticalRules shares edges at vertical rules', () => {
  const stacks = [
    { x0: 100, x1: 138 },
    { x0: 138, x1: 176 },
    { x0: 176, x1: 200 },
  ];
  const out = valueColumnAnalysisBoundsFromSharedVerticalRules(stacks, 98, 491);
  assert.equal(out[0]!.x1, out[1]!.x0);
  assert.equal(out[1]!.x1, out[2]!.x0);
  assert.equal(out[0]!.x0, 100);
  assert.equal(out[2]!.x1, 200);
});

test('enforceValueColumnAnalysisBoundsMinWidthVsMedian grows trailing fan column', () => {
  const ruled = [
    { x0: 100, x1: 138 },
    { x0: 138, x1: 176 },
    { x0: 466, x1: 488 },
  ];
  const segments = valueColumnAnalysisBoundsFromSharedVerticalRules(ruled, 48, 491);
  const out = enforceValueColumnAnalysisBoundsMinWidthVsMedian(segments, 0.85, 48, 491, ruled);
  assert.equal(out[2]!.x1, 491);
  assert.ok(out[2]!.x1 - out[2]!.x0 >= Math.round(38 * 0.85));
  assert.equal(out[1]!.x1, out[2]!.x0);
});

test('expandValueColumnAnalysisBounds widens within neighbor midpoints', () => {
  const segments = [
    { x0: 100, x1: 140 },
    { x0: 200, x1: 240 },
  ];
  const anchored = expandValueColumnAnalysisBounds(segments, 0.1, 98, 491);
  assert.equal(anchored[0]!.x0, 100, 'x0 does not cross ruled anchor when stacks match segments');
  assert.equal(anchored[0]!.x1, 140);
  assert.equal(anchored[1]!.x0, 200);
  const ruled = [
    { x0: 92, x1: 140 },
    { x0: 200, x1: 240 },
  ];
  const expanded = expandValueColumnAnalysisBounds(segments, 0.1, 98, 491, ruled);
  assert.ok(expanded[0]!.x0 < 100);
  assert.ok(expanded[0]!.x0 >= 98);
  assert.equal(expanded[0]!.x1, 140);
  assert.ok(expanded[0]!.x1 <= 170);
  assert.ok(expanded[1]!.x0 >= 170);
});

test('imageValueColumnStripsFromAnalysisSegments maps exact analysis bounds to image', () => {
  const mapX = (x: number) => 1000 + x * 4;
  const strips = imageValueColumnStripsFromAnalysisSegments(
    [
      { x0: 100, x1: 138 },
      { x0: 385, x1: 425 },
    ],
    mapX,
    50,
    400,
  );
  assert.equal(strips.length, 2);
  assert.equal(strips[0]!.left, 1400);
  assert.equal(strips[0]!.width, 152);
  assert.equal(strips[1]!.left, 2540);
  assert.equal(strips[1]!.width, 160);
});

test('productValueSegmentsRightOfLabel clamps x0 to label boundary', () => {
  const out = productValueSegmentsRightOfLabel(
    [
      { x0: 50, x1: 120 },
      { x0: 120, x1: 200 },
    ],
    117,
    2,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0]!.x0, 117);
  assert.equal(out[0]!.x1, 120);
  assert.equal(out[1]!.x0, 120);
});

test('valueColumnAnalysisSegmentsAligned drops label-bleed strip with disjoint plan', () => {
  const label = { index: 0, left: 100, top: 0, width: 80, height: 400 };
  const productSegments = [
    { x0: 98, x1: 103 },
    { x0: 103, x1: 138 },
    { x0: 138, x1: 176 },
  ];
  const strips = productSegments.map((seg, index) => ({
    index,
    left: 100 + index * 50,
    top: 50,
    width: 50,
    height: 300,
  }));
  strips[0] = { index: 0, left: 100, top: 50, width: 30, height: 300 };
  const disjoint = enforceValueColumnsDisjointFromLabel(label, strips);
  const aligned = valueColumnAnalysisSegmentsAligned(
    productSegments,
    strips,
    disjoint,
    label,
    { left: 100, width: 400 },
    491,
    98,
  );
  assert.equal(aligned.length, disjoint.length);
  assert.equal(aligned[0]!.x0, 103);
  assert.equal(aligned[0]!.x1, 138);
});

test('valueColumnAnalysisSegmentsAligned keeps step-3 index when label-bleed strip is omitted', () => {
  const label = { index: 0, left: 431, top: 0, width: 536, height: 400 };
  const productSegments = [
    { x0: 63, x1: 103 },
    { x0: 103, x1: 138 },
    { x0: 138, x1: 176 },
    { x0: 176, x1: 215 },
    { x0: 215, x1: 252 },
    { x0: 252, x1: 290 },
    { x0: 290, x1: 328 },
    { x0: 385, x1: 425 },
    { x0: 425, x1: 466 },
    { x0: 466, x1: 491 },
  ];
  const strips = productSegments.map((seg, index) => ({
    index,
    left: 900 + index * 240,
    top: 50,
    width: 230,
    height: 300,
  }));
  strips[0] = { index: 0, left: 431, top: 50, width: 520, height: 300 };
  const disjoint = enforceValueColumnsDisjointFromLabel(label, strips);
  assert.equal(disjoint.length, 9);
  const aligned = valueColumnAnalysisSegmentsAligned(
    productSegments,
    strips,
    disjoint,
    label,
    { left: 431, width: 3000 },
    491,
    48,
  );
  assert.equal(aligned.length, 9);
  assert.equal(aligned[4]!.x0, 252);
  assert.equal(aligned[4]!.x1, 290);
  assert.equal(disjoint[5]!.sourceStep3Index, 6);
  assert.equal(aligned[5]!.x0, 290);
  assert.equal(aligned[5]!.x1, 328);
  assert.equal(disjoint[6]!.sourceStep3Index, 7);
  assert.equal(aligned[6]!.x0, 385);
  assert.equal(aligned[6]!.x1, 425);
});

test('enforceValueColumnsDisjointFromLabel drops strips fully inside label rail', () => {
  const label = { index: 0, left: 10, top: 0, width: 200, height: 400 };
  const values = [
    { index: 0, left: 10, top: 50, width: 180, height: 300 },
    { index: 1, left: 210, top: 50, width: 100, height: 300 },
  ];
  const kept = enforceValueColumnsDisjointFromLabel(label, values);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.left, 210);
});

test('separateSharedLabelValueTexts drops label-rail OCR bleed', () => {
  const label = 'Nutrition Facts\nAmount per serving\nCalories\nTotal Fat\nSodium';
  const bleed = 'Nutrition Facts\ncainer\nServing\nAmount per se';
  const product = '% Daily Value*\n90\n5g\n120mg';
  const { valueColumnTexts, droppedIndexes } = separateSharedLabelValueTexts(label, [bleed, product, product]);
  assert.deepEqual(droppedIndexes, [0]);
  assert.equal(valueColumnTexts.length, 2);
});

test(
  'Costco snapshot first value strip is product column (not label bleed)',
  { skip: !existsSync(costcoSnapshotPath) },
  async () => {
    const snap = JSON.parse(await readFile(costcoSnapshotPath, 'utf8')) as {
      labelColumnText: string;
      valueColumnTexts: string[];
    };
    assert.ok(
      !valueColumnTextLooksLikeLabelRail(snap.labelColumnText, snap.valueColumnTexts[0]!) &&
        !looksLikeLeadingLabelBleedColumn(0, snap.valueColumnTexts, snap.labelColumnText),
      'fixture col 0 should be row-band value OCR, not duplicated label rail',
    );
    const { droppedIndexes, valueColumnTexts } = separateSharedLabelValueTexts(
      snap.labelColumnText,
      snap.valueColumnTexts,
    );
    assert.deepEqual(droppedIndexes, []);
    assert.equal(valueColumnTexts.length, snap.valueColumnTexts.length);
  },
);
