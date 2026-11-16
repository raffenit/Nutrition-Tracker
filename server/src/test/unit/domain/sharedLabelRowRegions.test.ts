import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  alignRowSurfacesToReference,
  clipRowRegionBoxToRect,
  columnRowBandSlicesOnConsensusMesh,
  connectedValueRowBandSlicesOnConsensusMesh,
  interpolateGlareGutterRuleYs,
  ruleYsForColumnWarpProbe,
  columnInkBoundaryYsAlongMesh,
  inferColumnBodyRuleYsSurface,
  rowBandSlicesFromSkewedColumnBoundaries,
  rowBandSliceAxisAlignedBounds,
  rowBandSlicesForHeaderSpan,
  syncValueHeaderBandsToLabelHeader,
  filterLabelOnlyPreambleRulesFromBodyMesh,
  splitDailyValueTransitionFromBody,
  caloriesRowSliceTopY,
  dailyValueRowSliceTopYFromLabelRules,
  dailyValueRowSliceTopYForLabelColumn,
  dailyValueRowSliceTopYFromValueColumns,
  dailyValueRowSliceTopYForValueColumns,
  bodyPreambleSuggestsCaloriesThenDailyValue,
  stripHairlineRulesInBodyPreamble,
  firstSubstantiveNutrientRuleYOnValueColumns,
  rowRegionBoxesBetweenRules,
  rowRegionDriftSummary,
  rowSurfacePolygonPoints,
  yAtPitchWeightedBodyFraction,
  columnSubstripInkSkewAtMesh,
  skewedSlicesAgreeWithColumnInkSlope,
  consensusRowSurfaceMeshRuleYs,
  orientColumnSubstripRuleYs,
  columnSkewedBoundariesFromSubstripInk,
  splitDoubleHeightRowBandSlices,
  splitDoubleHeightRowBandSlicesPreservingPreamble,
  splitRowBandSlicesCrossingY,
  collapseBodyPreambleToSingleBand,
  repairBodyBandsAfterPreamble,
  valueColumnKeepsWarpedNutrientRows,
  warpedNutrientRowSlicesUsable,
  finalizeValueColumnBodySlices,
  valueWarpedNutrientSlicesFromInkMesh,
  valueSkewedNutrientSlicesFromColumnInk,
  nudgePerColumnRowsOnePitchDownInGlareBands,
  type RowRegionBox,
} from '../../../domain/sharedLabelRowRegions.js';
import {
  disjointRowBandSlices,
  mapAnalysisYToImageBand,
  nutrientTableClosingFooterY,
  repairHairlineNutrientBands,
  rowBandSlicesBetweenRules,
} from '../../../domain/sharedLabelGridLayout.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../../../domain/sharedLabelGridParams.js';
import { emptyColumnBodyGlareMask } from '../../../integrations/bandLuminanceCluster.js';

const trustedGlareMask = emptyColumnBodyGlareMask(0, 400, 4);
const untrustedGlareMask = {
  ...emptyColumnBodyGlareMask(0, 400, 4),
  untrusted: [true, true, true, true],
};

test('per-column row boxes differ when rule ys differ', () => {
  const bodyTop = 100;
  const bodyBottom = 300;
  const colA = rowRegionBoxesBetweenRules(0, 50, 80, bodyTop, bodyBottom, [140, 180, 220], 'per_column');
  const colB = rowRegionBoxesBetweenRules(1, 150, 80, bodyTop, bodyBottom, [145, 185, 225], 'per_column');
  assert.equal(colA[0]!.top, 100);
  assert.equal(colB[0]!.top, 100);
  assert.equal(colA[1]!.top, 140);
  assert.equal(colB[1]!.top, 145);
  assert.equal(colA[1]!.top - colB[1]!.top, -5);
});

test('rowRegionDriftSummary reports top delta vs consensus slices', () => {
  const consensus = rowBandSlicesBetweenRules(100, 300, [150, 200], 4);
  const perCol = rowRegionBoxesBetweenRules(0, 0, 100, 100, 300, [155, 200], 'per_column');
  const drift = rowRegionDriftSummary(consensus, perCol, 0);
  assert.equal(drift[0]!.topDeltaPx, 0);
  assert.equal(drift[1]!.topDeltaPx, 5);
});

test('pitch-weighted body fraction morphs between top and bottom pitch', () => {
  const bodyTop = 100;
  const bodyBottom = 500;
  const uniform = yAtPitchWeightedBodyFraction(bodyTop, bodyBottom, 30, 30, 0.5);
  const warped = yAtPitchWeightedBodyFraction(bodyTop, bodyBottom, 20, 40, 0.5);
  assert.equal(uniform, 300);
  assert.notEqual(warped, uniform);
});

test('alignRowSurfacesToReference collapses to shared mesh on straight tables', () => {
  const reference = [
    { rowIndex: 0, top: 100, height: 40 },
    { rowIndex: 1, top: 140, height: 40 },
  ];
  const wavy = [
    [
      { rowIndex: 0, top: 102, height: 40 },
      { rowIndex: 1, top: 141, height: 40 },
    ],
    [
      { rowIndex: 0, top: 98, height: 40 },
      { rowIndex: 1, top: 139, height: 40 },
    ],
  ];
  const straight = alignRowSurfacesToReference(reference, wavy, 40);
  assert.equal(straight.mode, 'shared');
  assert.equal(straight.columns[0]![0]!.top, 102);
  assert.equal(straight.columns[1]![0]!.top, 98);
});

test('alignRowSurfacesToReference keeps warp only on divergent columns', () => {
  const reference = [
    { rowIndex: 0, top: 100, height: 40 },
    { rowIndex: 1, top: 140, height: 40 },
  ];
  const straightCol = [
    { rowIndex: 0, top: 101, height: 40 },
    { rowIndex: 1, top: 141, height: 40 },
  ];
  const warpedCol = [
    { rowIndex: 0, top: 118, height: 40 },
    { rowIndex: 1, top: 158, height: 40 },
  ];
  const mixed = alignRowSurfacesToReference(reference, [straightCol, warpedCol], 40);
  assert.equal(mixed.mode, 'per_column');
  assert.equal(mixed.columns[0]![0]!.top, 101);
  assert.equal(mixed.columns[1]![0]!.top, 118);
});

test('mapAnalysisYToImageBand uses the band that produced analysis pixels', () => {
  assert.equal(mapAnalysisYToImageBand(50, 100, 200, 400), 400);
  assert.equal(mapAnalysisYToImageBand(50, 100, 0, 400), 200);
  assert.notEqual(
    mapAnalysisYToImageBand(50, 100, 100, 400),
    mapAnalysisYToImageBand(50, 100, 0, 400),
  );
});

test('rowSurfacePolygonPoints outlines a row strip without pinching the ends', () => {
  const boxes: RowRegionBox[] = [
    { columnIndex: -1, rowIndex: 0, left: 0, top: 100, width: 200, height: 40, zone: 'body', source: 'per_column' },
    { columnIndex: 0, rowIndex: 0, left: 200, top: 110, width: 100, height: 35, zone: 'body', source: 'per_column' },
    { columnIndex: 1, rowIndex: 0, left: 300, top: 105, width: 100, height: 38, zone: 'body', source: 'per_column' },
  ];
  const pts = rowSurfacePolygonPoints(boxes);
  const order = pts.split(/\s+/);
  assert.deepEqual(order, [
    '0,100',
    '200,100',
    '200,110',
    '300,110',
    '300,105',
    '400,105',
    '400,143',
    '300,143',
    '300,145',
    '200,145',
    '200,140',
    '0,140',
  ]);
});

test('clipRowRegionBoxToRect intersects band crop without changing in-band boxes', () => {
  const box: RowRegionBox = {
    columnIndex: 0,
    rowIndex: 1,
    left: 50,
    top: 120,
    width: 100,
    height: 40,
    zone: 'body',
    source: 'per_column',
  };
  const clipped = clipRowRegionBoxToRect(box, 0, 0, 200, 300);
  assert.deepEqual(clipped, box);
  const partial = clipRowRegionBoxToRect(box, 80, 0, 200, 300);
  assert.equal(partial!.left, 80);
  assert.equal(partial!.width, 70);
  assert.equal(clipRowRegionBoxToRect(box, 200, 0, 50, 300), null);
});

test('columnRowBandSlicesOnConsensusMesh keeps one box per consensus row', () => {
  const reference = [
    { rowIndex: 0, top: 100, height: 40 },
    { rowIndex: 1, top: 140, height: 40 },
    { rowIndex: 2, top: 180, height: 40 },
  ];
  const mesh = [140, 180];
  const onMesh = columnRowBandSlicesOnConsensusMesh(
    reference,
    100,
    [140, 180],
    [145, 185],
    [140, 180],
    mesh,
    8,
    40,
    true,
    { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, rowSurfaceWarpMinMatchedRules: 2 },
  );
  assert.equal(onMesh.length, reference.length);
  assert.equal(onMesh[1]!.rowIndex, 1);
  assert.ok(onMesh[1]!.top >= 140 && onMesh[1]!.top <= 145);
});

test('connectedValueRowBandSlicesOnConsensusMesh shares gutter Y between neighbors', () => {
  const reference = [
    { rowIndex: 0, top: 100, height: 40 },
    { rowIndex: 1, top: 140, height: 40 },
    { rowIndex: 2, top: 180, height: 40 },
  ];
  const mesh = [140, 180];
  const grid = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, rowSurfaceWarpMinMatchedRules: 2 };
  const columns = [
    {
      warp: true,
      glareMask: trustedGlareMask,
      leftRuleYs: [140],
      rightRuleYs: [142],
      fullRuleYs: [140, 180],
    },
    {
      warp: true,
      glareMask: trustedGlareMask,
      leftRuleYs: [143],
      rightRuleYs: [145],
      fullRuleYs: [143, 183],
    },
  ];
  const out = connectedValueRowBandSlicesOnConsensusMesh(
    reference,
    100,
    220,
    columns,
    mesh,
    8,
    40,
    (y) => y,
    grid,
  );
  assert.equal(out.length, 2);
  const westTopR = out[0]![1]!.top + (out[0]![1]!.topSkewPx ?? 0);
  const eastTopL = out[1]![1]!.top;
  assert.equal(westTopR, eastTopL);
});

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

test('orientColumnSubstripRuleYs corrects inverted substrip fan (glare-corrupted probes)', () => {
  const mesh = [200, 240, 280, 320];
  const left = [201, 241, 281, 321];
  const rightFan = [212, 252, 292, 332];
  assert.ok(columnSubstripInkSkewAtMesh(mesh, left, rightFan, 10).every((s) => s > 0));
  const invertedRight = [191, 231, 271, 311];
  assert.ok(median(columnSubstripInkSkewAtMesh(mesh, left, invertedRight, 10)) < 0);
  const oriented = orientColumnSubstripRuleYs(mesh, left, invertedRight, 10, 4);
  assert.ok(median(columnSubstripInkSkewAtMesh(mesh, oriented.left, oriented.right, 10)) > 0);
});

test('columnSkewedBoundariesFromSubstripInk keeps downward fan on cell quads', () => {
  const mesh = [140, 180, 220];
  const left = [141, 181, 221];
  const right = [149, 193, 237];
  const { left: leftB, right: rightB } = columnSkewedBoundariesFromSubstripInk(
    mesh,
    left,
    right,
    10,
    4,
    trustedGlareMask,
    (y) => y,
  );
  const slices = rowBandSlicesFromSkewedColumnBoundaries(100, 260, leftB, rightB);
  const bottomSkews = slices.map((s) => s.bottomSkewPx ?? 0);
  assert.ok(bottomSkews.every((s) => s >= 0));
  assert.ok(median(bottomSkews) >= 4);
  assert.ok(
    skewedSlicesAgreeWithColumnInkSlope(slices, mesh, left, right, 10, 40),
    'slices must agree with substrip ink slope',
  );
});

test('nudgePerColumnRowsOnePitchDownInGlareBands shifts from first glare consensus row minus one', () => {
  const mask = {
    ...emptyColumnBodyGlareMask(0, 200, 10),
    untrusted: [false, false, false, false, false, false, true, false, false, false],
    brightFraction: Array(10).fill(0),
  };
  const pitch = 40;
  const preambleEnd = 100;
  const yAnalysis = (y: number) => y;
  const reference = [
    { rowIndex: 8, top: 120, height: 40 },
    { rowIndex: 9, top: 160, height: 40 },
  ];
  const nutrients = [
    { rowIndex: 8, top: 130, height: 40 },
    { rowIndex: 9, top: 170, height: 40 },
  ];
  const out = nudgePerColumnRowsOnePitchDownInGlareBands(
    nutrients,
    reference,
    mask,
    yAnalysis,
    pitch,
    preambleEnd,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0]!.top, 167);
  assert.equal(out[1]!.top, 207);
});

test('columnInkBoundaryYsAlongMesh snaps raw rule in glare band when ink is visible', () => {
  const mask = {
    ...emptyColumnBodyGlareMask(0, 400, 4),
    untrusted: [false, true, false, false],
    brightFraction: [0, 0.25, 0, 0],
  };
  const mesh = [200];
  const rules = [206];
  const yAnalysis = (yImage: number) => (yImage === 206 ? 120 : 80);
  const ys = columnInkBoundaryYsAlongMesh(mesh, rules, 8, mask, yAnalysis);
  assert.equal(ys[0], 206);
});

test('ruleYsForColumnWarpProbe drops glare-band rules — warp skew must use raw substrip pairing', () => {
  const mask = {
    ...emptyColumnBodyGlareMask(100, 320, 4),
    untrusted: [true, true, false, false],
    brightFraction: [0.22, 0.18, 0, 0],
  };
  const mesh = [140, 180, 220, 260];
  const leftRaw = [141, 181, 221, 261];
  const rightRaw = [149, 189, 209, 269];
  const rawSpread = columnSubstripInkSkewAtMesh(mesh, leftRaw, rightRaw, 10);
  assert.ok(median(rawSpread) > 0);
  const probedRight = ruleYsForColumnWarpProbe(rightRaw, mask, mesh, 100, 10, (y) => y);
  assert.ok(probedRight.length < rightRaw.length);
  const probeSpread = columnSubstripInkSkewAtMesh(mesh, leftRaw, probedRight, 10);
  assert.ok(
    rawSpread.length > probeSpread.length,
    'glare-filled probe must not replace raw substrip mesh pairing used for warp geometry',
  );
});

test('connectedValueRowBandSlicesOnConsensusMesh applies downward-fan ink on warped column', () => {
  const reference = [
    { rowIndex: 0, top: 100, height: 40 },
    { rowIndex: 1, top: 140, height: 40 },
    { rowIndex: 2, top: 180, height: 40 },
  ];
  const mesh = [140, 180];
  const left = [141, 181];
  const right = [149, 189];
  const columnDown = {
    warp: true,
    glareMask: trustedGlareMask,
    leftRuleYs: left,
    rightRuleYs: right,
    fullRuleYs: left,
  };
  const grid = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, rowSurfaceWarpMinMatchedRules: 2 };
  const gutters = [
    [140, 180],
    [140, 180],
    [140, 180],
  ];
  const down = connectedValueRowBandSlicesOnConsensusMesh(
    reference,
    100,
    220,
    [columnDown],
    mesh,
    10,
    40,
    (y) => y,
    grid,
    gutters,
    mesh,
  );
  assert.ok((down[0]![1]!.bottomSkewPx ?? 0) >= 4);
});

test('value column warp keeps oriented raw substrip rules not glare probe substitution', () => {
  const mask = {
    ...emptyColumnBodyGlareMask(100, 320, 4),
    untrusted: [true, true, false, false],
    brightFraction: [0.22, 0.18, 0, 0],
  };
  const mesh = [140, 180, 220, 260];
  const bodyTop = 100;
  const bodyBottom = 260;
  const snapTol = 10;
  const pooledPitch = 40;
  const leftRaw = [141, 181, 221, 261];
  const rightRaw = [149, 189, 209, 269];
  const oriented = orientColumnSubstripRuleYs(mesh, leftRaw, rightRaw, snapTol, 4);
  const probedRight = ruleYsForColumnWarpProbe(rightRaw, mask, mesh, bodyTop, snapTol, (y) => y);
  assert.notDeepEqual(probedRight, oriented.right);
  assert.ok(
    columnSubstripInkSkewAtMesh(mesh, oriented.left, oriented.right, snapTol).length >
      columnSubstripInkSkewAtMesh(mesh, oriented.left, probedRight, snapTol).length,
  );

  const reference = [0, 1, 2, 3].map((rowIndex) => ({
    rowIndex,
    top: bodyTop + rowIndex * 40,
    height: 40,
  }));
  const grid = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, rowSurfaceWarpMinMatchedRules: 2 };
  const gutters = mesh.map(() => [...mesh]);

  const columnFromSubstrip = {
    warp: true,
    glareMask: mask,
    leftRuleYs: oriented.left,
    rightRuleYs: oriented.right,
    fullRuleYs: rightRaw,
  };
  const columnFromProbe = { ...columnFromSubstrip, rightRuleYs: probedRight };

  const fromSubstrip = connectedValueRowBandSlicesOnConsensusMesh(
    reference,
    bodyTop,
    bodyBottom,
    [columnFromSubstrip],
    mesh,
    snapTol,
    pooledPitch,
    (y) => y,
    grid,
    gutters,
    mesh,
  );
  const fromProbe = connectedValueRowBandSlicesOnConsensusMesh(
    reference,
    bodyTop,
    bodyBottom,
    [columnFromProbe],
    mesh,
    snapTol,
    pooledPitch,
    (y) => y,
    grid,
    gutters,
    mesh,
  );

  assert.ok(
    skewedSlicesAgreeWithColumnInkSlope(
      fromSubstrip[0]!,
      mesh,
      oriented.left,
      oriented.right,
      snapTol,
      pooledPitch,
    ),
  );
  assert.equal(
    skewedSlicesAgreeWithColumnInkSlope(fromProbe[0]!, mesh, oriented.left, probedRight, snapTol, pooledPitch),
    false,
  );
  assert.ok(fromSubstrip[0]!.some((s) => (s.bottomSkewPx ?? 0) > 0));
  assert.ok(fromProbe[0]!.every((s) => (s.bottomSkewPx ?? 0) === 0));
});

test('columnInkBoundaryYsAlongMesh follows substrip ink slope per mesh rule', () => {
  const mesh = [100, 200, 300];
  const leftInk = [101, 201, 301];
  const rightInk = [109, 209, 309];
  const snapTol = 12;
  const left = columnInkBoundaryYsAlongMesh(mesh, leftInk, snapTol);
  const right = columnInkBoundaryYsAlongMesh(mesh, rightInk, snapTol);
  assert.deepEqual(left, leftInk);
  assert.deepEqual(right, rightInk);
  const slices = rowBandSlicesFromSkewedColumnBoundaries(80, 400, left, right);
  assert.ok((slices[1]!.topSkewPx ?? 0) > 0);
  assert.ok((slices[1]!.bottomSkewPx ?? 0) > 0);
});

test('columnInkBoundaryYsAlongMesh extrapolates ink slope when mesh row lacks a snapped rule', () => {
  const mesh = [100, 200, 300];
  const leftInk = [101, 208, 318];
  const left = columnInkBoundaryYsAlongMesh(mesh, leftInk, 8);
  assert.deepEqual(left, [101, 208, 308]);
});

test('ruleYsForColumnWarpProbe keeps glare ink and interpolates between trusted anchors', () => {
  const mask = {
    ...untrustedGlareMask,
    y0: 100,
    y1: 300,
    bandCount: 4,
    untrusted: [false, false, true, false],
    brightFraction: [0, 0, 0.2, 0],
  };
  const mesh = [120, 160, 200, 240];
  const rules = [118, 158, 212, 238];
  const out = ruleYsForColumnWarpProbe(rules, mask, mesh, 100, 6, (y) => y);
  assert.ok(out.includes(118));
  assert.ok(out.includes(158));
  assert.ok(!out.includes(212), 'glare-band noise not kept when trusted anchors exist');
  assert.ok(out.some((y) => y >= 198 && y <= 202), 'interpolated mesh row in glare');
});

test('interpolateGlareGutterRuleYs bridges glare columns from trusted neighbors', () => {
  const columns = [
    { warp: true, glareMask: trustedGlareMask, leftRuleYs: [], rightRuleYs: [], fullRuleYs: [] },
    { warp: false, glareMask: untrustedGlareMask, leftRuleYs: [], rightRuleYs: [], fullRuleYs: [] },
    { warp: true, glareMask: trustedGlareMask, leftRuleYs: [], rightRuleYs: [], fullRuleYs: [] },
  ];
  const gutters = [
    [100, 140],
    [110, 150],
    [120, 160],
    [130, 170],
  ];
  interpolateGlareGutterRuleYs(gutters, columns, [140, 180], (y) => y);
  assert.deepEqual(gutters[2], [120, 160]);
});

test('rowBandSlicesFromSkewedColumnBoundaries trapezoid rows track left/right ink', () => {
  const slices = rowBandSlicesFromSkewedColumnBoundaries(100, 280, [140, 200], [150, 210]);
  assert.equal(slices.length, 3);
  assert.equal(slices[0]!.topSkewPx ?? 0, 0);
  assert.equal(slices[1]!.topSkewPx, 10);
});

test('consensusRowSurfaceMeshRuleYs uses interior row-band bottoms', () => {
  const reference = [
    { rowIndex: 0, top: 100, height: 40 },
    { rowIndex: 1, top: 140, height: 45 },
    { rowIndex: 2, top: 185, height: 50 },
  ];
  assert.deepEqual(consensusRowSurfaceMeshRuleYs(reference, 100, 250), [140, 185]);
});

test('columnSubstripInkSkewAtMesh pairs left/right offsets at mesh rows', () => {
  const mesh = [200, 240, 280];
  const skews = columnSubstripInkSkewAtMesh(mesh, [201, 241, 281], [211, 251, 291], 12);
  assert.deepEqual(skews, [10, 10, 10]);
});

test('skewedSlicesAgreeWithColumnInkSlope rejects opposite-sign quads', () => {
  const mesh = [140, 180, 220];
  const inkSlices = rowBandSlicesFromSkewedColumnBoundaries(100, 260, [140, 180, 220], [148, 192, 236]);
  const flipped = rowBandSlicesFromSkewedColumnBoundaries(100, 260, [148, 192, 236], [140, 180, 220]);
  const probe = { left: [141, 181, 221], right: [149, 193, 237] };
  assert.ok(
    skewedSlicesAgreeWithColumnInkSlope(inkSlices, mesh, probe.left, probe.right, 12, 40),
  );
  assert.equal(
    skewedSlicesAgreeWithColumnInkSlope(flipped, mesh, probe.left, probe.right, 12, 40),
    false,
  );
});

test('surface inference fills interior rules when only top and bottom anchors exist', () => {
  const bodyTop = 100;
  const bodyBottom = 400;
  const reference = [150, 200, 250, 300];
  const detected = [148, 298];
  const inferred = inferColumnBodyRuleYsSurface({
    bodyTop,
    bodyBottom,
    detectedRuleYsImage: detected,
    pooledPitch: 50,
    referenceRuleYsImage: reference,
  });
  assert.ok(inferred.length >= 3);
  assert.ok(inferred.some((y) => y > 170 && y < 230));
});

test('rowBandSlicesForHeaderSpan uses one band without interior rules (not body pitch)', () => {
  const top = 100;
  const bottom = 300;
  const slices = rowBandSlicesForHeaderSpan(top, bottom, [], [], 52);
  assert.equal(slices.length, 1);
  assert.equal(slices[0]!.top, top);
  assert.equal(slices[0]!.height, 200);
});

test('syncValueHeaderBandsToLabelHeader splits value header at label % Daily Value band', () => {
  const spanTop = 361;
  const spanBottom = 567;
  const label = rowBandSlicesForHeaderSpan(spanTop, spanBottom, [532], [532], 40);
  assert.equal(label.length, 2);
  const mono = [{ rowIndex: 0, top: spanTop, height: spanBottom - spanTop }];
  const synced = syncValueHeaderBandsToLabelHeader(label, mono, [mono], spanTop, spanBottom);
  assert.equal(synced.headerConsensusRowBandSlices.length, 2);
  assert.deepEqual(synced.headerConsensusRowBandSlices, label);
});

test('firstSubstantiveNutrientRuleYOnValueColumns ignores label-heavy mesh and uses value median', () => {
  const y = firstSubstantiveNutrientRuleYOnValueColumns(
    561,
    1200,
    40,
    [
      [673, 710],
      [673, 717],
      [685, 729],
    ],
  );
  assert.equal(y, 673);
});

test('dailyValueRowSliceTopYFromValueColumns ignores label-only preamble rules', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const pitch = 44;
  const valueDv = dailyValueRowSliceTopYFromValueColumns(bodyTop, firstRule, pitch, [
    [567, 673, 710],
    [573, 673, 717],
    [573, 679, 729],
  ]);
  assert.equal(valueDv, undefined);
});

test('dailyValueRowSliceTopYForValueColumns keeps calories band tall and % Daily short above first rule', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const pitch = 44;
  const dvTop = dailyValueRowSliceTopYForValueColumns(bodyTop, firstRule, pitch, [
    [567, 673, 710],
    [573, 673, 717],
  ]);
  assert.ok(firstRule - dvTop! >= Math.round(pitch * 0.75));
});

test('dailyValueRowSliceTopYForLabelColumn falls back to one text row below body top', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const pitch = 44;
  const dvTop = dailyValueRowSliceTopYForLabelColumn(bodyTop, firstRule, pitch, [673, 710]);
  assert.equal(dvTop, bodyTop + Math.round(pitch * 0.95));
});

test('splitDailyValueTransitionFromBody splits at explicit dvTop without touching headers', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const pitch = 40;
  const header = [
    { rowIndex: 0, top: 361, height: 171 },
    { rowIndex: 1, top: 532, height: 29 },
  ];
  const body = [
    { rowIndex: 0, top: bodyTop, height: 156 },
    { rowIndex: 1, top: 717, height: 49 },
  ];
  const dvTop = dailyValueRowSliceTopYForLabelColumn(bodyTop, firstRule, pitch, [601, 710]);
  assert.equal(dvTop, 601);
  const split = splitDailyValueTransitionFromBody(bodyTop, firstRule, pitch, header, body, dvTop);
  assert.deepEqual(split.headerSlices, header);
  assert.equal(split.bodySlices[0]!.top, caloriesRowSliceTopY(bodyTop));
  assert.equal(split.bodySlices[1]!.top, dvTop);
  assert.equal(split.bodySlices[0]!.top + split.bodySlices[0]!.height, dvTop);
  assert.equal(split.bodySlices[1]!.top + split.bodySlices[1]!.height, firstRule);
  assert.equal(split.bodySlices[2]!.top, firstRule);
  assert.equal(split.bodySlices[3]!.top, 717);
});

test('valueColumnKeepsWarpedNutrientRows prefers outer warp columns on curved fan', () => {
  const mesh = [673, 710, 759];
  const probe = {
    warp: true,
    glareMask: emptyColumnBodyGlareMask(0, 900, 5),
    leftRuleYs: [674, 712, 762],
    rightRuleYs: [680, 718, 768],
    fullRuleYs: mesh,
  };
  assert.equal(valueColumnKeepsWarpedNutrientRows(7, 10, probe, mesh, 8), true);
  assert.equal(valueColumnKeepsWarpedNutrientRows(2, 10, probe, mesh, 8), false);
});

test('valueColumnKeepsWarpedNutrientRows keeps outer warp when substrip skew spreads are zero', () => {
  const mesh = [673, 710, 759];
  const probe = {
    warp: true,
    glareMask: emptyColumnBodyGlareMask(0, 900, 5),
    leftRuleYs: [673, 710, 759],
    rightRuleYs: [673, 710, 759],
    fullRuleYs: mesh,
  };
  assert.equal(valueColumnKeepsWarpedNutrientRows(8, 10, probe, mesh, 8), true);
  assert.equal(valueColumnKeepsWarpedNutrientRows(9, 10, probe, mesh, 8), true);
});

test('collapseBodyPreambleToSingleBand merges value preamble for OCR', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const slices = [
    { rowIndex: 0, top: 561, height: 78 },
    { rowIndex: 1, top: 639, height: 34 },
    { rowIndex: 2, top: 673, height: 50 },
  ];
  const out = collapseBodyPreambleToSingleBand(bodyTop, firstRule, slices);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.top, bodyTop);
  assert.equal(out[0]!.height, firstRule - bodyTop);
  assert.equal(out[1]!.top, firstRule);
});

test('splitRowBandSlicesCrossingY moves nutrient tail below preamble end', () => {
  const preambleEnd = 729;
  const merged = [{ rowIndex: 1, top: 673, height: 106, topSkewPx: 0, bottomSkewPx: 0 }];
  const { above, below } = splitRowBandSlicesCrossingY(merged, preambleEnd);
  assert.equal(above.length, 1);
  assert.equal(above[0]!.top, 673);
  assert.equal(above[0]!.height, preambleEnd - 673);
  assert.equal(below.length, 1);
  assert.equal(below[0]!.top, preambleEnd);
  assert.equal(below[0]!.height, 673 + 106 - preambleEnd);
});

test('repairBodyBandsAfterPreamble inserts row at first nutrient rule when warp skips it', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const repaired = repairBodyBandsAfterPreamble(
    bodyTop,
    firstRule,
    [
      { rowIndex: 0, top: 561, height: 112 },
      { rowIndex: 1, top: 710, height: 49 },
    ],
    44,
  );
  assert.equal(repaired[0]!.height, firstRule - bodyTop);
  assert.equal(repaired[1]!.top, firstRule);
  assert.ok(repaired[1]!.top + repaired[1]!.height <= 710 + 2);
});

test('splitDoubleHeightRowBandSlicesPreservingPreamble skips Calories or preamble band', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const pitch = 44;
  const preamble = [{ rowIndex: 0, top: bodyTop, height: Math.round(pitch * 2) }];
  const preserved = splitDoubleHeightRowBandSlicesPreservingPreamble(
    preamble,
    pitch,
    bodyTop,
    firstRule,
  );
  assert.equal(preserved.length, 1);
  const split = splitDoubleHeightRowBandSlices(preamble, pitch);
  assert.equal(split.length, 2);
  assert.equal(split[0]!.top + split[0]!.height, split[1]!.top);
});

test('splitDailyValueTransitionFromBody keeps tail at or below first nutrient rule only', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const dvTop = 638;
  const header = [{ rowIndex: 0, top: 361, height: 200 }];
  const body = [
    { rowIndex: 0, top: 605, height: 68 },
    { rowIndex: 1, top: 673, height: 31, topSkewPx: 0, bottomSkewPx: -6 },
    { rowIndex: 2, top: 698, height: 68, topSkewPx: -6, bottomSkewPx: 0 },
    { rowIndex: 3, top: 766, height: 44 },
  ];
  const out = splitDailyValueTransitionFromBody(bodyTop, firstRule, 44, header, body, dvTop).bodySlices;
  assert.equal(out[0]!.top, bodyTop);
  assert.equal(out[1]!.top, dvTop);
  assert.ok(out.every((s, i) => i < 2 || s.top >= firstRule - 2));
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(out[i]!.top >= out[i - 1]!.top + out[i - 1]!.height - 4);
  }
});

test('dailyValueRowSliceTopYForValueColumns enforces minimum % Daily band height', () => {
  const bodyTop = 561;
  const firstRule = 673;
  const pitch = 44;
  const dvTop = dailyValueRowSliceTopYForValueColumns(bodyTop, firstRule, pitch, [[673, 710]]);
  assert.ok(dvTop !== undefined);
  assert.ok(firstRule - dvTop! >= Math.round(pitch * 0.75));
});

test('splitDailyValueTransitionFromBody is a no-op when dvTop omitted', () => {
  const body = [{ rowIndex: 0, top: 561, height: 112 }];
  const header = [{ rowIndex: 0, top: 361, height: 200 }];
  const out = splitDailyValueTransitionFromBody(561, 673, 44, header, body, undefined);
  assert.deepEqual(out.bodySlices, body);
});

test('stripHairlineRulesInBodyPreamble removes rules between body top and first nutrient row', () => {
  const stripped = stripHairlineRulesInBodyPreamble(561, 40, [561, 567, 673, 710]);
  assert.deepEqual(stripped, [673, 710]);
});

test('filterLabelOnlyPreambleRulesFromBodyMesh drops header % Daily rule from body mesh', () => {
  const bodyTop = 567;
  const pitch = 40;
  const rules = [580, 673, 710];
  const filtered = filterLabelOnlyPreambleRulesFromBodyMesh(
    bodyTop,
    pitch,
    [532],
    rules,
    [[673, 710]],
    8,
    0.5,
  );
  assert.deepEqual(filtered, [673, 710]);
});

test('warpedNutrientRowSlicesUsable rejects overlapping warped rows', () => {
  const ref = [
    { rowIndex: 0, top: 673, height: 37 },
    { rowIndex: 1, top: 710, height: 49 },
  ];
  const overlap = [
    { rowIndex: 0, top: 673, height: 50 },
    { rowIndex: 1, top: 698, height: 60 },
  ];
  assert.equal(warpedNutrientRowSlicesUsable(ref, overlap, 44), false);
  const nudged = [
    { rowIndex: 0, top: 679, height: 37 },
    { rowIndex: 1, top: 716, height: 49 },
  ];
  assert.equal(warpedNutrientRowSlicesUsable(ref, nudged, 44), true);
});

test('valueSkewedNutrientSlicesFromColumnInk fans row bands with bottomSkewPx', () => {
  const preambleEnd = 673;
  const ref = [
    { rowIndex: 0, top: 673, height: 37 },
    { rowIndex: 1, top: 710, height: 49 },
    { rowIndex: 2, top: 759, height: 44 },
  ];
  const probe = {
    warp: true,
    glareMask: emptyColumnBodyGlareMask(0, 900, 5),
    leftRuleYs: [674, 712, 761],
    rightRuleYs: [682, 722, 772],
    fullRuleYs: [679, 729, 766],
  };
  const meshFull = [561, 601, 673, 710, 759, 803, 846];
  const out = valueSkewedNutrientSlicesFromColumnInk(
    561,
    preambleEnd,
    900,
    ref,
    probe,
    meshFull,
    8,
    44,
    true,
  );
  assert.ok(out);
  assert.ok(out.some((s) => Math.abs(s.bottomSkewPx ?? 0) >= 2 || Math.abs(s.topSkewPx ?? 0) >= 2));
});

test('valueWarpedNutrientSlicesFromInkMesh maps consensus mesh to column rule ink', () => {
  const preambleEnd = 673;
  const ref = [
    { rowIndex: 0, top: 673, height: 37 },
    { rowIndex: 1, top: 710, height: 49 },
    { rowIndex: 2, top: 759, height: 44 },
  ];
  const mesh = [673, 710, 759, 803, 846];
  const probe = {
    warp: true,
    glareMask: emptyColumnBodyGlareMask(0, 900, 5),
    leftRuleYs: [679, 729],
    rightRuleYs: [682, 732],
    fullRuleYs: [679, 729, 766, 816, 873],
  };
  const out = valueWarpedNutrientSlicesFromInkMesh(
    preambleEnd,
    1400,
    ref,
    mesh,
    probe,
    8,
    44,
  );
  assert.ok(out);
  assert.equal(out.length, ref.length);
  assert.ok(out[0]!.top === preambleEnd);
  assert.ok(out[0]!.height >= 40);
  assert.ok(out[1]!.top > 710);
});

test('rowBandSlicesFromSkewedColumnBoundaries can emit skewed interior sliver before repair', () => {
  const slices = rowBandSlicesFromSkewedColumnBoundaries(816, 950, [829], [842]);
  assert.ok(slices.length >= 1);
  assert.ok(
    slices.some((s) => s.height < 20 || ((s.bottomSkewPx ?? 0) >= 8 && s.height < 32)),
    `expected sliver, got ${JSON.stringify(slices)}`,
  );
});

test('repairHairlineNutrientBands restores readability after disjoint overlap trim', () => {
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
  const trimmed = disjointRowBandSlices(skewed, DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx);
  const repaired = repairHairlineNutrientBands(trimmed, reference, pitch);
  assert.ok(trimmed.some((s) => s.height < minReadable));
  assert.ok(repaired.every((s) => s.height >= minReadable));
});

test('finalizeValueColumnBodySlices repairs skewed hairline nutrient rows on outer warp columns', () => {
  const bodyTop = 561;
  const preambleEnd = 673;
  const pitch = 47;
  const minReadable = Math.round(pitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction);
  const consensus = [
    { rowIndex: 0, top: bodyTop, height: preambleEnd - bodyTop },
    { rowIndex: 1, top: 772, height: 44 },
    { rowIndex: 2, top: 816, height: 45 },
    { rowIndex: 3, top: 861, height: 44 },
    { rowIndex: 4, top: 905, height: 50 },
  ];
  const probe = {
    warp: true,
    glareMask: emptyColumnBodyGlareMask(0, 1400, 5),
    leftRuleYs: [710, 729, 766, 816, 866, 910, 954],
    rightRuleYs: [679, 692, 829, 866, 910, 954, 1004],
    fullRuleYs: [710, 766, 816, 866, 910, 960, 1010],
  };
  const mesh = [673, 710, 759, 803, 846, 891, 935];
  const refN = consensus.filter((s) => s.top >= preambleEnd);
  const closingFooterY = nutrientTableClosingFooterY(
    bodyTop,
    1400,
    1500,
    pitch,
    mesh.filter((y) => y > preambleEnd),
    refN,
  );
  const out = finalizeValueColumnBodySlices(
    bodyTop,
    preambleEnd,
    1400,
    consensus,
    consensus,
    7,
    10,
    probe,
    mesh.filter((y) => y > preambleEnd),
    mesh,
    8,
    pitch,
    closingFooterY,
  );
  const nutrients = out.filter((s) => s.top >= preambleEnd);
  assert.equal(nutrients.length, 4);
  assert.ok(
    nutrients.every((s) => s.height >= minReadable),
    `unreadable heights: ${nutrients.map((s) => s.height).join(',')}`,
  );
  assert.equal(nutrients[0]!.top, preambleEnd, 'ink-anchored mesh starts at first nutrient rule');
  assert.ok(
    nutrients.some((s) => (s.topSkewPx ?? 0) > 0 || (s.bottomSkewPx ?? 0) > 0),
    'outer finalize should keep trapezoid skew',
  );
  assert.equal(
    nutrients[nutrients.length - 1]!.top + nutrients[nutrients.length - 1]!.height,
    closingFooterY,
  );
});

test('finalizeValueColumnBodySlices keeps mesh warped nutrient tops on outer columns', () => {
  const bodyTop = 561;
  const preambleEnd = 673;
  const bodyBottom = 1400;
  const pitch = 44;
  const consensus = [
    { rowIndex: 0, top: bodyTop, height: preambleEnd - bodyTop },
    { rowIndex: 1, top: 673, height: 37 },
    { rowIndex: 2, top: 710, height: 49 },
  ];
  const warpedColumn = [
    { rowIndex: 0, top: bodyTop, height: preambleEnd - bodyTop },
    { rowIndex: 1, top: 679, height: 37 },
    { rowIndex: 2, top: 716, height: 49 },
  ];
  const probe = {
    warp: true,
    glareMask: emptyColumnBodyGlareMask(0, 900, 5),
    leftRuleYs: [674, 712, 760, 820, 880],
    rightRuleYs: [684, 724, 772, 836, 900],
    fullRuleYs: [679, 716, 766, 828, 890],
  };
  const refN = consensus.filter((s) => s.top >= preambleEnd);
  const closingFooterY = nutrientTableClosingFooterY(
    bodyTop,
    bodyBottom,
    950,
    pitch,
    [710, 766],
    refN,
  );
  const out = finalizeValueColumnBodySlices(
    bodyTop,
    preambleEnd,
    bodyBottom,
    consensus,
    warpedColumn,
    7,
    10,
    probe,
    [673, 710],
    [673, 710],
    8,
    pitch,
    closingFooterY,
  );
  const nutrients = out.filter((s) => s.top >= preambleEnd);
  assert.ok(
    nutrients.some((s) => (s.bottomSkewPx ?? 0) > 0 || s.top !== refN[1]!.top),
    'outer columns should keep ink warp or footer-fan skew',
  );
});

test('rowBandSlicesForHeaderSpan keeps rule band adjacent to body top (% Daily Value row)', () => {
  const top = 100;
  const bottom = 300;
  const dvRule = bottom - 24;
  const slices = rowBandSlicesForHeaderSpan(top, bottom, [dvRule], [dvRule], 52);
  assert.equal(slices.length, 2);
  assert.ok(slices[1]!.top >= dvRule - 8 && slices[1]!.top + slices[1]!.height <= bottom);
});
test('rowBandSlicesFromSkewedColumnBoundaries crop bounds cover the skewed quad without double skew', () => {
  const slices = rowBandSlicesFromSkewedColumnBoundaries(100, 200, [140], [150]);
  const first = rowBandSliceAxisAlignedBounds(slices[0]!);
  assert.deepEqual(first, { top: 100, height: 50 });
  const tail = rowBandSliceAxisAlignedBounds(slices[1]!);
  assert.deepEqual(tail, { top: 140, height: 60 });
});
