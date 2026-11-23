import {
  consolidateRowBandRuleYs,
  disjointRowBandSlices,
  expandRowBandSlicesToMinReadableHeight,
  mapAnalysisYToImageBand,
  medianConsecutiveSpacing,
  alignNutrientSpanBordersToConsensus,
  alignWarpedNutrientTailToConsensus,
  alignWarpedNutrientTopsWhereDrifted,
  fanWarpedNutrientSkewFromFooterRule,
  clampRowBandSliceSkew,
  maxRowSurfaceSkewPx,
  outerColumnRowSurfaceSkewCapPx,
  extendLastBodySliceToFooterY,
  collapseContainedRowBandSlices,
  mergeSmallRowBandSlices,
  nutrientTableClosingFooterY,
  subdivideOversizedRowBandsAtRules,
  repairHairlineNutrientBands,
  rowBandRuleMinSpacingPx,
  rowBandSlicesBetweenRules,
  type SharedLabelRowBandSlice,
} from './sharedLabelGridLayout.js';
import {
  consensusRuleInkRuns,
  horizontalRuleRowSliceEdgeYsInColumn,
  horizontalRuleRowSliceEdgeYsInColumnSubstrips,
  horizontalRuleRowYsInColumn,
  isBoundaryNearYs,
  sectionDividerBoundaryYsFromRuns,
} from '../integrations/ruledTableGridDetect.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from './sharedLabelGridParams.js';
import {
  columnBodyGlareMask,
  columnHasGlareBands,
  columnTrustsRuleAtY,
  emptyColumnBodyGlareMask,
  filterRuleYsByGlareMask,
  type ColumnBodyGlareMask,
} from '../integrations/bandLuminanceCluster.js';

export type RowRegionBox = {
  columnIndex: number;
  rowIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Product stack header (names / display kcal) vs ruled nutrient body. */
  zone: 'header' | 'body';
  /** `consensus` = shared global rule ys; `per_column` = rules detected in this strip only. */
  source: 'consensus' | 'per_column';
  topSkewPx?: number;
  bottomSkewPx?: number;
};

export type ColumnRowRegionSet = {
  columnIndex: number;
  ruleYsImage: number[];
  regions: RowRegionBox[];
};

/**
 * Axis-aligned row cells between rule lines (per-column rules → per-column tops/heights).
 * Not restricted to a single global y; skew shows up as different boxes per column.
 */
export function rowRegionBoxesBetweenRules(
  columnIndex: number,
  left: number,
  width: number,
  bodyTop: number,
  bodyBottom: number,
  ruleYsImage: number[],
  source: RowRegionBox['source'],
  zone: RowRegionBox['zone'] = 'body',
): RowRegionBox[] {
  const slices = rowBandSlicesBetweenRules(bodyTop, bodyBottom, ruleYsImage, 4);
  return slices.map((slice) => ({
    columnIndex,
    rowIndex: slice.rowIndex,
    left,
    top: slice.top,
    width,
    height: slice.height,
    zone,
    source,
  }));
}

export function rowRegionBoxesFromSlices(
  columnIndex: number,
  left: number,
  width: number,
  slices: SharedLabelRowBandSlice[],
  source: RowRegionBox['source'],
  zone: RowRegionBox['zone'],
): RowRegionBox[] {
  return slices.map((slice) => ({
    columnIndex,
    rowIndex: slice.rowIndex,
    left,
    top: slice.top,
    width,
    height: slice.height,
    zone,
    source,
    topSkewPx: slice.topSkewPx,
    bottomSkewPx: slice.bottomSkewPx,
  }));
}

/** Axis-aligned crop that covers a skewed row quad (curved packaging). */
export function rowBandSliceAxisAlignedBounds(slice: {
  top: number;
  height: number;
  topSkewPx?: number;
  bottomSkewPx?: number;
}): { top: number; height: number } {
  const topR = slice.top + (slice.topSkewPx ?? 0);
  const botL = slice.top + slice.height;
  const botR = botL + (slice.bottomSkewPx ?? 0);
  const top = Math.min(slice.top, topR);
  const bottom = Math.max(botL, botR);
  return { top, height: Math.max(1, bottom - top) };
}

function snapRuleNear(rules: number[], targetY: number, snapTol: number): number {
  const hit = rules.find((r) => Math.abs(r - targetY) <= snapTol);
  return hit ?? targetY;
}

type RuleOffsetSample = { meshY: number; offset: number };

/**
 * Rules for warp / gutter probes: trusted ink defines slope; keep visible rules in glare bands;
 * fill remaining mesh rows in glare via linear offset interpolation from trusted matches.
 */
export function ruleYsForColumnWarpProbe(
  ruleYsImage: number[],
  mask: ColumnBodyGlareMask,
  meshRuleYsImage: number[],
  bodyTop: number,
  snapTol: number,
  meshYToAnalysis: (yImage: number) => number,
): number[] {
  const sorted = [...ruleYsImage].sort((a, b) => a - b);
  const trusted = sorted.filter((y) => y > bodyTop + 2 && columnTrustsRuleAtY(mask, meshYToAnalysis(y)));
  if (trusted.length === 0) {
    return filterRuleYsByGlareMask(sorted, mask, meshYToAnalysis);
  }
  const out = new Set<number>(trusted);
  const meshBody = meshRuleYsImage.filter((y) => y > bodyTop + 2);
  const offsetSamples = meshLocalRuleOffsets(meshBody, trusted, snapTol);
  if (offsetSamples.length < 2) {
    return [...out].sort((a, b) => a - b);
  }
  const nearTol = Math.max(2, Math.round(snapTol * 0.45));
  for (const meshY of meshBody) {
    if (columnTrustsRuleAtY(mask, meshYToAnalysis(meshY))) continue;
    const hasNear = [...out].some((y) => Math.abs(y - meshY) <= snapTol);
    if (hasNear) continue;
    const interpY = meshY + Math.round(interpolatedRuleOffset(meshY, offsetSamples));
    if (![...out].some((y) => Math.abs(y - interpY) <= nearTol)) {
      out.add(interpY);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function columnUsesWarpOffsetAtMeshRule(col: ValueColumnWarpProbe, yAnalysis: number): boolean {
  if (col.warp) return true;
  return columnTrustsRuleAtY(col.glareMask, yAnalysis);
}

function meshLocalRuleOffsets(
  meshRuleYs: number[],
  localRuleYs: number[],
  snapTol: number,
): RuleOffsetSample[] {
  const offsets: RuleOffsetSample[] = [];
  for (const meshY of meshRuleYs) {
    const near = localRuleYs.find((y) => Math.abs(y - meshY) <= snapTol);
    if (near !== undefined) offsets.push({ meshY, offset: near - meshY });
  }
  return offsets;
}

function interpolatedRuleOffset(y: number, samples: RuleOffsetSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0]!.offset;
  const sorted = [...samples].sort((a, b) => a.meshY - b.meshY);
  if (y <= sorted[0]!.meshY) return sorted[0]!.offset;
  if (y >= sorted[sorted.length - 1]!.meshY) return sorted[sorted.length - 1]!.offset;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (y >= a.meshY && y <= b.meshY) {
      const t = (y - a.meshY) / Math.max(1, b.meshY - a.meshY);
      return a.offset * (1 - t) + b.offset * t;
    }
  }
  return 0;
}

function clampPx(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Diagnosability: `NT_ROW_WARP_TEST_UNLIMITED=1` drops skew/drift/top caps (Costco outer-column experiments). */
function rowWarpVerticalLimitsRelaxed(): boolean {
  return process.env.NT_ROW_WARP_TEST_UNLIMITED === '1';
}

function warpGridForVerticalLimits(): Pick<
  typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
  | 'rowSurfaceWarpMaxDriftPitchFraction'
  | 'rowSurfaceWarpMinMatchedRules'
  | 'rowSurfaceSkewMaxPitchFraction'
  | 'rowSurfaceSkewMinPx'
  | 'rowBandSplitOversizedPitchRatio'
> {
  if (!rowWarpVerticalLimitsRelaxed()) return DEFAULT_SHARED_LABEL_GRID_PARAMS;
  return {
    ...DEFAULT_SHARED_LABEL_GRID_PARAMS,
    rowSurfaceWarpMaxDriftPitchFraction: 4,
    rowSurfaceSkewMaxPitchFraction: 2,
    rowSurfaceSkewMinPx: 0,
    rowBandSplitOversizedPitchRatio: 3,
  };
}

function inkDriftOffsetAtMeshY(
  meshY: number,
  samples: RuleOffsetSample[],
  maxDriftPx: number,
): number {
  if (samples.length === 0) return 0;
  const raw = interpolatedRuleOffset(meshY, samples);
  if (rowWarpVerticalLimitsRelaxed()) return Math.round(raw);
  return clampPx(Math.round(raw), maxDriftPx);
}

function rampedDriftOffsetAtY(
  meshY: number,
  samples: RuleOffsetSample[],
  bodyTop: number,
  span: number,
  maxDriftPx: number,
): number {
  const frac = Math.max(0, Math.min(1, (meshY - bodyTop) / span));
  return Math.round(inkDriftOffsetAtMeshY(meshY, samples, maxDriftPx) * frac);
}

/** One mesh rule → rule ink Y on a column edge (snap, else interpolate; glare rows use slope from trusted ink). */
export function columnInkBoundaryYsAlongMesh(
  meshInBody: number[],
  inkRuleYs: number[],
  snapTol: number,
  glareMask?: ColumnBodyGlareMask,
  meshYToAnalysis?: (yImage: number) => number,
): number[] {
  const trustedInk =
    glareMask && meshYToAnalysis
      ? inkRuleYs.filter((y) => columnTrustsRuleAtY(glareMask, meshYToAnalysis(y)))
      : inkRuleYs;
  const anchorInk = trustedInk.length >= 2 ? trustedInk : inkRuleYs;
  const samples = meshLocalRuleOffsets(meshInBody, anchorInk, snapTol);
  return meshInBody.map((meshY) => {
    const inGlare =
      glareMask &&
      meshYToAnalysis &&
      !columnTrustsRuleAtY(glareMask, meshYToAnalysis(meshY));
    const fromSlope =
      samples.length >= 2
        ? meshY + Math.round(interpolatedRuleOffset(meshY, samples))
        : samples.length === 1
          ? meshY + samples[0]!.offset
          : meshY;
    const snapped = inkRuleYs.find((y) => Math.abs(y - meshY) <= snapTol);
    if (inGlare) {
      if (snapped !== undefined) return snapped;
      return fromSlope;
    }
    if (snapped !== undefined) return snapped;
    if (samples.length >= 1) return fromSlope;
    return meshY;
  });
}

function enforceMonotonicBoundaryYs(ys: number[], floorY: number, minStepPx: number): number[] {
  if (rowWarpVerticalLimitsRelaxed()) return [...ys];
  const out: number[] = [];
  let prev = floorY;
  for (const y of ys) {
    const next = Math.max(y, prev + minStepPx);
    out.push(next);
    prev = next;
  }
  return out;
}

/** Right vs left rule offset at the same consensus mesh row (≈ pixels skew across the column). */
export function columnSubstripInkSkewAtMesh(
  meshRuleYs: number[],
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
): number[] {
  const leftOffsets = meshLocalRuleOffsets(meshRuleYs, leftRuleYs, snapTol);
  const rightByMesh = new Map(meshLocalRuleOffsets(meshRuleYs, rightRuleYs, snapTol).map((s) => [s.meshY, s]));
  const skews: number[] = [];
  for (const l of leftOffsets) {
    const r = rightByMesh.get(l.meshY);
    if (r !== undefined) skews.push(r.offset - l.offset);
  }
  return skews;
}

/** Curved packs: right rule Y should be ≥ left along the fan; fix inverted substrip lists. */
export function orientColumnSubstripRuleYs(
  meshRuleYs: number[],
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
  skewMinPx: number,
  preferPositiveFan?: boolean,
): { left: number[]; right: number[] } {
  const spreads = columnSubstripInkSkewAtMesh(meshRuleYs, leftRuleYs, rightRuleYs, snapTol);
  if (spreads.length < 2) {
    return { left: leftRuleYs, right: rightRuleYs };
  }
  const med = medianOf(spreads);
  const pos = spreads.filter((s) => s >= skewMinPx).length;
  const neg = spreads.filter((s) => s <= -skewMinPx).length;
  const invert =
    med < -skewMinPx ||
    (neg > pos && neg >= 2) ||
    (preferPositiveFan === true && med < skewMinPx && pos + neg >= 2);
  if (invert) {
    return { left: rightRuleYs, right: leftRuleYs };
  }
  return { left: leftRuleYs, right: rightRuleYs };
}

export function columnSkewedBoundariesFromSubstripInk(
  meshInBody: number[],
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
  skewMinPx: number,
  glareMask?: ColumnBodyGlareMask,
  meshYToAnalysis?: (yImage: number) => number,
  preferPositiveFan?: boolean,
): { left: number[]; right: number[] } {
  const oriented = orientColumnSubstripRuleYs(
    meshInBody,
    leftRuleYs,
    rightRuleYs,
    snapTol,
    skewMinPx,
    preferPositiveFan,
  );
  const leftB = columnInkBoundaryYsAlongMesh(
    meshInBody,
    oriented.left,
    snapTol,
    glareMask,
    meshYToAnalysis,
  );
  const rightOffsets = meshLocalRuleOffsets(meshInBody, oriented.right, snapTol);
  const rightByMesh = new Map(rightOffsets.map((s) => [s.meshY, s]));
  const leftOffsets = meshLocalRuleOffsets(meshInBody, oriented.left, snapTol);
  const spreadSamples: RuleOffsetSample[] = [];
  for (const l of leftOffsets) {
    const r = rightByMesh.get(l.meshY);
    if (r !== undefined) spreadSamples.push({ meshY: l.meshY, offset: r.offset - l.offset });
  }
  if (spreadSamples.length < 2) {
    const rightB = columnInkBoundaryYsAlongMesh(
      meshInBody,
      oriented.right,
      snapTol,
      glareMask,
      meshYToAnalysis,
    );
    return { left: leftB, right: rightB };
  }
  const rightB = meshInBody.map((meshY, i) => {
    const r = rightByMesh.get(meshY);
    if (r !== undefined) return meshY + r.offset;
    const spread = Math.round(interpolatedRuleOffset(meshY, spreadSamples));
    return leftB[i]! + spread;
  });
  return { left: leftB, right: rightB };
}

function columnInkSkewDeltasAlongMesh(
  meshRuleYs: number[],
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
): number[] {
  const leftB = columnInkBoundaryYsAlongMesh(meshRuleYs, leftRuleYs, snapTol);
  const rightB = columnInkBoundaryYsAlongMesh(meshRuleYs, rightRuleYs, snapTol);
  return leftB.map((l, i) => rightB[i]! - l);
}

/**
 * Curved value columns: horizontal band tops follow left-gutter rule ink at each consensus mesh row.
 */
export function snapWarpedMacroRowsToColumnLeftInk(
  nutrients: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  leftRuleYs: number[],
  snapTol: number,
  tailStartRow: number,
  pooledPitch: number,
  glareMask?: ColumnBodyGlareMask,
  meshYToAnalysis?: (yImage: number) => number,
): SharedLabelRowBandSlice[] {
  const minH = Math.max(8, Math.round(pooledPitch * 0.35));
  if (nutrients.length === 0 || reference.length === 0 || nutrients.length !== reference.length) {
    return nutrients;
  }
  const meshTops = reference.map((r) => r.top);
  const leftTops = columnInkBoundaryYsAlongMesh(meshTops, leftRuleYs, snapTol);
  if (leftTops.length < 2) return nutrients;
  const rowInGlareBand = (refTop: number, localTop: number): boolean => {
    if (glareMask === undefined || meshYToAnalysis === undefined || !columnHasGlareBands(glareMask)) {
      return false;
    }
    return (
      !columnTrustsRuleAtY(glareMask, meshYToAnalysis(refTop)) ||
      !columnTrustsRuleAtY(glareMask, meshYToAnalysis(localTop))
    );
  };
  return nutrients.map((slice, i) => {
    if (i >= tailStartRow && tailStartRow < nutrients.length) return { ...slice, rowIndex: i };
    const glareShift = rowInGlareBand(reference[i]!.top, slice.top) ? 1 : 0;
    const inkIdx = Math.min(i + glareShift, leftTops.length - 1);
    const inkTop = leftTops[inkIdx]!;
    const nextInkIdx = Math.min(inkIdx + 1, leftTops.length - 1);
    const nextBoundaryY =
      inkIdx + 1 < leftTops.length && (i + glareShift + 1 < tailStartRow || glareShift > 0)
        ? leftTops[nextInkIdx]!
        : i + 1 < reference.length
          ? columnInkBoundaryYsAlongMesh([reference[i + 1]!.top], leftRuleYs, snapTol)[0] ??
            slice.top + slice.height
          : slice.top + slice.height;
    return {
      ...slice,
      rowIndex: i,
      top: inkTop,
      height: Math.max(minH, Math.round(nextBoundaryY - inkTop)),
    };
  });
}

function firstGlareConsensusNutrientRowIndex(
  reference: SharedLabelRowBandSlice[],
  preambleEndY: number,
  glareMask: ColumnBodyGlareMask,
  meshYToAnalysis: (yImage: number) => number,
): number | undefined {
  for (const ref of reference) {
    if (ref.top < preambleEndY - 2) continue;
    if (!columnTrustsRuleAtY(glareMask, meshYToAnalysis(ref.top))) return ref.rowIndex;
  }
  return undefined;
}

/** Glare wipes ruled mesh rows — per-column bands from the first glare consensus row downward sit ~one pitch high. */
export function nudgePerColumnRowsOnePitchDownInGlareBands(
  nutrients: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  glareMask: ColumnBodyGlareMask,
  meshYToAnalysis: (yImage: number) => number,
  pooledPitch: number,
  preambleEndY: number,
): SharedLabelRowBandSlice[] {
  if (nutrients.length === 0 || reference.length === 0 || !columnHasGlareBands(glareMask)) {
    return nutrients;
  }
  let startRow = firstGlareConsensusNutrientRowIndex(
    reference,
    preambleEndY,
    glareMask,
    meshYToAnalysis,
  );
  if (startRow === undefined) return nutrients;
  /** Bright-band mask often lags consensus mesh by one nutrient row on curved outer columns. */
  if (startRow > 0) startRow -= 1;
  const nudgePx = Math.round(pooledPitch * 0.92);
  const minH = Math.max(8, Math.round(pooledPitch * 0.35));
  const out = nutrients.map((s) => ({ ...s }));
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const slice = out[i]!;
    if (slice.rowIndex < startRow) continue;
    const newTop = slice.top + nudgePx;
    const nextBoundary = out[i + 1]?.top ?? slice.top + slice.height + nudgePx;
    out[i] = {
      ...slice,
      top: newTop,
      height: Math.max(minH, nextBoundary - newTop),
    };
  }
  return disjointRowBandSlices(out, DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx);
}

/** Pixels of ruled ink spread (right minus left offset) at the closing footer mesh row. */
export function footerRuleInkSpreadPx(
  footerY: number,
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
  skewMinPx: number,
): number {
  const paired = columnSubstripInkSkewAtMesh([footerY], leftRuleYs, rightRuleYs, snapTol);
  if (paired.length >= 1 && Math.abs(paired[0]!) >= skewMinPx) return paired[0]!;
  const deltas = columnInkSkewDeltasAlongMesh([footerY], leftRuleYs, rightRuleYs, snapTol);
  if (deltas.length >= 1 && Math.abs(deltas[0]!) >= skewMinPx) return deltas[0]!;
  return 0;
}

/** Ink pairing spread at the footer (capped); never uses raw last-rule Y delta across substrips. */
export function columnFooterFanSpreadPx(
  closingFooterY: number,
  preambleEndY: number,
  meshRuleYsInBody: number[],
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
  skewMinPx: number,
  pooledPitch: number,
): number {
  const cap = Math.max(maxRowSurfaceSkewPx(pooledPitch), outerColumnRowSurfaceSkewCapPx(pooledPitch));
  let spread = footerRuleInkSpreadPx(closingFooterY, leftRuleYs, rightRuleYs, snapTol, skewMinPx);
  if (Math.abs(spread) < skewMinPx && meshRuleYsInBody.length >= 2) {
    const lowerHalfY = preambleEndY + (closingFooterY - preambleEndY) * 0.45;
    const lowerMesh = meshRuleYsInBody.filter((y) => y >= lowerHalfY);
    const mesh = lowerMesh.length >= 2 ? lowerMesh : meshRuleYsInBody;
    const spreads = columnSubstripInkSkewAtMesh(mesh, leftRuleYs, rightRuleYs, snapTol);
    if (spreads.length >= 1) {
      const pos = spreads.filter((s) => s >= skewMinPx);
      const neg = spreads.filter((s) => s <= -skewMinPx);
      let candidate = 0;
      if (pos.length > 0) candidate = medianOf(pos);
      else if (neg.length > 0) candidate = medianOf(neg.map((s) => Math.abs(s)));
      if (candidate >= skewMinPx) spread = candidate;
    }
  }
  if (spread < -skewMinPx) spread = Math.abs(spread);
  if (spread > cap) spread = cap;
  if (spread >= skewMinPx) return spread;
  return 0;
}

/** Curved outer columns: row bottoms should sit lower on the right (positive bottomSkewPx in viz). */
function medianBottomSkewPx(slices: SharedLabelRowBandSlice[]): number {
  const vals = slices
    .map((s) => s.bottomSkewPx ?? 0)
    .filter((s) => Math.abs(s) >= 2);
  return vals.length > 0 ? medianOf(vals) : 0;
}

/** Outer columns: right edge of each rule at or below the left (image Y increases downward). */
function enforceDownwardFanBoundaryPairs(
  leftMono: number[],
  rightMono: number[],
  minSpreadPx: number,
): { left: number[]; right: number[] } {
  const right = [...rightMono];
  for (let i = 0; i < leftMono.length; i++) {
    if (right[i]! < leftMono[i]! + minSpreadPx) {
      right[i] = leftMono[i]! + minSpreadPx;
    }
  }
  return { left: leftMono, right };
}

function mostlyUpwardSlopingFan(slices: SharedLabelRowBandSlice[], skewMinPx: number): boolean {
  const vals = slices
    .map((s) => s.bottomSkewPx ?? 0)
    .filter((s) => Math.abs(s) >= skewMinPx);
  if (vals.length < 2) return false;
  const neg = vals.filter((v) => v < -skewMinPx).length;
  return neg > vals.length / 2;
}

function nutrientSkewedSlicesFromOrientedInk(
  preambleEndY: number,
  sliceBottom: number,
  refNutrientCount: number,
  inkMeshInBody: number[],
  leftRules: number[],
  rightRules: number[],
  snapTol: number,
  skewMinPx: number,
  glareMask: ColumnBodyGlareMask,
  pooledPitch: number,
  preferDownwardFan: boolean,
): SharedLabelRowBandSlice[] | null {
  const minStep = Math.max(3, Math.round(pooledPitch * 0.12));
  const build = (leftR: number[], rightR: number[]) => {
    const { left: leftInk, right: rightInk } = columnSkewedBoundariesFromSubstripInk(
      inkMeshInBody,
      leftR,
      rightR,
      snapTol,
      skewMinPx,
      glareMask,
      undefined,
      preferDownwardFan ? true : undefined,
    );
    let leftMono = enforceMonotonicBoundaryYs(leftInk, preambleEndY, minStep);
    let rightMono = enforceMonotonicBoundaryYs(rightInk, preambleEndY, minStep);
    if (leftMono.length < refNutrientCount - 1) return null;
    if (preferDownwardFan) {
      ({ left: leftMono, right: rightMono } = enforceDownwardFanBoundaryPairs(
        leftMono,
        rightMono,
        skewMinPx,
      ));
    }
    return rowBandSlicesFromSkewedColumnBoundaries(preambleEndY, sliceBottom, leftMono, rightMono);
  };
  let nutrients = build(leftRules, rightRules);
  if (!nutrients || nutrients.length !== refNutrientCount) return null;
  if (preferDownwardFan && mostlyUpwardSlopingFan(nutrients, skewMinPx)) {
    nutrients = build(rightRules, leftRules);
    if (!nutrients || nutrients.length !== refNutrientCount) return null;
  }
  return nutrients;
}

/**
 * Reject warped cell quads whose slope disagrees with substrip ink (e.g. gutter ramp vs real ruled fan).
 * Cheap: reuses mesh/local offset pairing already computed for warp probes.
 */
export function skewedSlicesAgreeWithColumnInkSlope(
  slices: SharedLabelRowBandSlice[],
  meshRuleYsInBody: number[],
  leftRuleYs: number[],
  rightRuleYs: number[],
  snapTol: number,
  pooledPitch: number,
  grid: Pick<typeof DEFAULT_SHARED_LABEL_GRID_PARAMS, 'rowSurfaceSkewMinPx' | 'rowSurfaceSkewMaxPitchFraction'> =
    DEFAULT_SHARED_LABEL_GRID_PARAMS,
): boolean {
  if (rowWarpVerticalLimitsRelaxed()) return true;
  const pairedSpreads = columnSubstripInkSkewAtMesh(meshRuleYsInBody, leftRuleYs, rightRuleYs, snapTol);
  const inkSpreads =
    pairedSpreads.length >= 2
      ? pairedSpreads
      : columnInkSkewDeltasAlongMesh(meshRuleYsInBody, leftRuleYs, rightRuleYs, snapTol);
  if (inkSpreads.length < 2) return true;
  const minPx = grid.rowSurfaceSkewMinPx;
  const inkPos = inkSpreads.filter((s) => s >= minPx).length;
  const inkNeg = inkSpreads.filter((s) => s <= -minPx).length;
  if (inkPos >= 2 && inkNeg >= 2) return false;
  const inkMedian = medianOf(inkSpreads);
  if (Math.abs(inkMedian) < minPx) return true;

  const geomBottom = slices.map((s) => s.bottomSkewPx ?? 0);
  const significantGeom = geomBottom.filter((g) => Math.abs(g) >= minPx);
  const geomMedian =
    significantGeom.length > 0
      ? medianOf(significantGeom)
      : medianOf(geomBottom.filter((g) => g !== 0));
  if (Math.abs(geomMedian) < minPx) {
    return Math.abs(inkMedian) < minPx * 2;
  }
  if (Math.sign(geomMedian) !== Math.sign(inkMedian)) return false;

  const tol = Math.max(minPx, Math.round(pooledPitch * grid.rowSurfaceSkewMaxPitchFraction));
  if (Math.abs(geomMedian - inkMedian) > tol * 2.4) return false;

  const pairCount = Math.min(slices.length, inkSpreads.length);
  if (pairCount < 2) return true;
  let agree = 0;
  let compared = 0;
  for (let i = 0; i < pairCount; i += 1) {
    const spread = inkSpreads[i]!;
    const skew = slices[i]!.bottomSkewPx ?? 0;
    if (Math.abs(spread) < minPx && Math.abs(skew) < minPx) continue;
    compared += 1;
    if (Math.sign(spread) === Math.sign(skew) || Math.abs(skew - spread) <= tol) agree += 1;
  }
  if (compared < 2) return true;
  return agree / compared >= 0.55;
}

function skewedSlicesAlignWithConsensus(
  reference: SharedLabelRowBandSlice[],
  slices: SharedLabelRowBandSlice[],
  pooledPitch: number,
): boolean {
  if (slices.length !== reference.length || pooledPitch <= 0) return false;
  if (rowWarpVerticalLimitsRelaxed()) return true;
  const grid = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const maxSkew = Math.max(
    grid.rowSurfaceSkewMinPx,
    Math.round(pooledPitch * grid.rowSurfaceSkewMaxPitchFraction),
  );
  const maxTopDrift = Math.round(pooledPitch * 0.5);
  const maxHeightDelta = pooledPitch * grid.rowBandSplitOversizedPitchRatio;
  for (let i = 0; i < reference.length; i += 1) {
    const r = reference[i]!;
    const s = slices[i]!;
    const skew = Math.max(Math.abs(s.topSkewPx ?? 0), Math.abs(s.bottomSkewPx ?? 0));
    if (skew > maxSkew) return false;
    if (Math.abs(s.top - r.top) > maxTopDrift) return false;
    if (Math.abs(s.height - r.height) > maxHeightDelta) return false;
  }
  return true;
}

function meshSubstripOffsetSpreadPitch(
  leftOffsets: RuleOffsetSample[],
  rightOffsets: RuleOffsetSample[],
  pooledPitch: number,
): number {
  const rightByMesh = new Map(rightOffsets.map((s) => [s.meshY, s.offset]));
  const spreads: number[] = [];
  for (const l of leftOffsets) {
    const r = rightByMesh.get(l.meshY);
    if (r !== undefined) spreads.push(Math.abs(l.offset - r));
  }
  if (spreads.length === 0) return 0;
  spreads.sort((a, b) => a - b);
  return spreads[Math.floor(spreads.length / 2)]! / Math.max(1, pooledPitch);
}

function columnWarpOffsetSamples(
  leftRuleYs: number[],
  rightRuleYs: number[],
  fullColumnRuleYs: number[],
  meshRuleYs: number[],
  bodyTop: number,
  snapTol: number,
  pooledPitch: number,
  grid: Pick<
    typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
    | 'rowSurfaceWarpMaxDriftPitchFraction'
    | 'rowSurfaceWarpMinMatchedRules'
    | 'rowSurfaceSkewMaxPitchFraction'
  >,
  options?: { skipSubstripSpreadGate?: boolean },
): { left: RuleOffsetSample[]; right: RuleOffsetSample[]; full: RuleOffsetSample[] } | null {
  const localRules = [...new Set([...leftRuleYs, ...rightRuleYs, ...fullColumnRuleYs])].filter(
    (y) => y > bodyTop + 2,
  );
  const leftOffsets = meshLocalRuleOffsets(meshRuleYs, leftRuleYs, snapTol);
  const rightOffsets = meshLocalRuleOffsets(meshRuleYs, rightRuleYs, snapTol);
  const fullOffsets = meshLocalRuleOffsets(meshRuleYs, localRules, snapTol);
  const minMatched = grid.rowSurfaceWarpMinMatchedRules;
  if (Math.max(leftOffsets.length, rightOffsets.length, fullOffsets.length) < minMatched) {
    return null;
  }
  if (rowWarpVerticalLimitsRelaxed()) {
    return { left: leftOffsets, right: rightOffsets, full: fullOffsets };
  }
  const maxDriftPx = Math.max(2, Math.round(pooledPitch * grid.rowSurfaceWarpMaxDriftPitchFraction));
  const maxOffset = Math.max(
    ...[...leftOffsets, ...rightOffsets].map((s) => Math.abs(s.offset)),
    0,
  );
  const chaosLimit = Math.round(Math.max(maxDriftPx * 2.2, pooledPitch * 0.95));
  if (maxOffset > chaosLimit) {
    return null;
  }
  const substripSpread = meshSubstripOffsetSpreadPitch(leftOffsets, rightOffsets, pooledPitch);
  if (
    !options?.skipSubstripSpreadGate &&
    substripSpread > grid.rowSurfaceSkewMaxPitchFraction
  ) {
    return null;
  }
  return { left: leftOffsets, right: rightOffsets, full: fullOffsets };
}

function gutterRampedOffsetAtY(
  meshY: number,
  leftSamples: RuleOffsetSample[] | null,
  rightSamples: RuleOffsetSample[] | null,
  bodyTop: number,
  span: number,
  maxDriftPx: number,
  followInk = true,
): number {
  const offsetAt = (samples: RuleOffsetSample[]) =>
    followInk
      ? inkDriftOffsetAtMeshY(meshY, samples, maxDriftPx)
      : rampedDriftOffsetAtY(meshY, samples, bodyTop, span, maxDriftPx);
  const left = leftSamples && leftSamples.length > 0 ? offsetAt(leftSamples) : null;
  const right = rightSamples && rightSamples.length > 0 ? offsetAt(rightSamples) : null;
  if (left !== null && right !== null) return Math.round((left + right) / 2);
  if (right !== null) return right;
  if (left !== null) return left;
  return 0;
}

/**
 * One logical row index per consensus band. Warped columns get vertical drift ramped from 0 at
 * body top to full cap (~½ pitch) at the bottom — curved packs fan down the outer columns.
 */
export function columnRowBandSlicesOnConsensusMesh(
  reference: SharedLabelRowBandSlice[],
  bodyTop: number,
  leftRuleYs: number[],
  rightRuleYs: number[],
  fullColumnRuleYs: number[],
  meshRuleYs: number[],
  snapTol: number,
  pooledPitch: number,
  warp: boolean,
  grid: Pick<
    typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
    | 'rowSurfaceSkewMaxPitchFraction'
    | 'rowSurfaceWarpMaxDriftPitchFraction'
    | 'rowSurfaceWarpMinMatchedRules'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): SharedLabelRowBandSlice[] {
  if (!warp || reference.length === 0) {
    return reference.map((ref, rowIndex) => ({ rowIndex, top: ref.top, height: ref.height }));
  }

  const samples = columnWarpOffsetSamples(
    leftRuleYs,
    rightRuleYs,
    fullColumnRuleYs,
    meshRuleYs,
    bodyTop,
    snapTol,
    pooledPitch,
    grid,
  );
  if (!samples) {
    return reference.map((ref, rowIndex) => ({ rowIndex, top: ref.top, height: ref.height }));
  }

  const maxDriftPx = Math.max(2, Math.round(pooledPitch * grid.rowSurfaceWarpMaxDriftPitchFraction));
  const minMatched = grid.rowSurfaceWarpMinMatchedRules;
  const driftSamples =
    samples.full.length >= minMatched ? samples.full : [...samples.left, ...samples.right];
  const driftSorted = driftSamples.map((s) => s.offset).sort((a, b) => a - b);
  const columnDrift =
    driftSorted.length > 0 ? driftSorted[Math.floor(driftSorted.length / 2)]! : 0;
  const driftPx = clampPx(Math.round(columnDrift), maxDriftPx);
  if (driftPx === 0) {
    return reference.map((ref, rowIndex) => ({ rowIndex, top: ref.top, height: ref.height }));
  }

  const bodyBottom = reference[reference.length - 1]!.top + reference[reference.length - 1]!.height;
  const span = Math.max(1, bodyBottom - bodyTop);
  const meshInBody = rulesInBody(bodyTop, bodyBottom, meshRuleYs);
  if (meshInBody.length === 0) {
    return reference.map((ref, rowIndex) => ({ rowIndex, top: ref.top, height: ref.height }));
  }

  const leftGutterYs = meshInBody.map(
    (meshY) => meshY + inkDriftOffsetAtMeshY(meshY, samples.left, maxDriftPx),
  );
  const rightGutterYs = meshInBody.map(
    (meshY) => meshY + inkDriftOffsetAtMeshY(meshY, samples.right, maxDriftPx),
  );
  const skewed = rowBandSlicesFromSkewedColumnBoundaries(
    bodyTop,
    bodyBottom,
    leftGutterYs,
    rightGutterYs,
  );
  if (skewed.length === reference.length) {
    return skewed.map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }

  return reference.map((ref, rowIndex) => {
    const yMid = ref.top + ref.height / 2;
    const frac = Math.max(0, Math.min(1, (yMid - bodyTop) / span));
    const rowDrift = Math.round(driftPx * frac);
    return {
      rowIndex,
      top: ref.top + rowDrift,
      height: ref.height,
    };
  });
}

/** Row-boundary ys for one column's slices: each slice top plus the final bottom edge. */
function rowBandBoundaryYs(slices: SharedLabelRowBandSlice[], edge: 'left' | 'right'): number[] {
  if (slices.length === 0) return [];
  const skew = (s: SharedLabelRowBandSlice) => (edge === 'right' ? (s.topSkewPx ?? 0) : 0);
  const bounds = slices.map((s) => s.top + skew(s));
  const last = slices[slices.length - 1]!;
  const bottomSkew = edge === 'right' ? (last.bottomSkewPx ?? 0) : 0;
  bounds.push(last.top + last.height + bottomSkew);
  return bounds;
}

/**
 * Re-fit a column's row boundaries to its own detected rule positions.
 *
 * Upstream mesh/consensus alignment can leave a column's slices anchored to
 * the shared row mesh even when the physical table slopes or the column's
 * local rules sit offset (curved packs, glare-eroded rule detection). The
 * column's own rule ys are the ground truth for where its rows actually are:
 * interior boundaries are aligned to local rules monotonically (glare-eroded
 * or curved columns can sit ~half a pitch off the consensus mesh, beyond
 * snap tolerances), unmatched boundaries take the interpolated offset, and
 * table-edge anchors stay fixed. Row count and order are preserved.
 */
export function fitColumnSlicesToLocalRules(
  slices: SharedLabelRowBandSlice[],
  localRuleYs: number[],
  snapTol: number,
  pooledPitch: number,
  grid: Pick<
    typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
    'rowSurfaceWarpMaxDriftPitchFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || localRuleYs.length === 0) return slices;
  const bounds = rowBandBoundaryYs(slices, 'left');
  if (bounds.length < 4) return slices;
  const maxDevPx = Math.max(snapTol, Math.round(pooledPitch * 0.66));
  const maxDriftPx = Math.max(2, Math.round(pooledPitch * grid.rowSurfaceWarpMaxDriftPitchFraction * 1.4));
  const interior = bounds.slice(1, -1);
  const rules = [...new Set(localRuleYs)].sort((a, b) => a - b);
  const matched = alignInteriorBoundsToRules(interior, rules, maxDevPx);
  const matchCount = matched.filter((y) => y !== null).length;
  if (matchCount < Math.max(4, Math.ceil(interior.length * 0.5))) return slices;
  const samples: RuleOffsetSample[] = [];
  matched.forEach((ruleY, idx) => {
    if (ruleY !== null) samples.push({ meshY: interior[idx]!, offset: ruleY - interior[idx]! });
  });
  const fitted = bounds.map((b, idx) => {
    if (idx === 0 || idx === bounds.length - 1) return b;
    return b + clampPx(Math.round(interpolatedRuleOffset(b, samples)), maxDriftPx);
  });
  const minStep = Math.max(4, Math.round(pooledPitch * 0.15));
  for (let j = 1; j < fitted.length; j += 1) {
    fitted[j] = Math.max(fitted[j]!, fitted[j - 1]! + minStep);
  }
  const last = fitted.length - 1;
  fitted[last] = bounds[last]!;
  for (let j = last - 1; j > 0; j -= 1) {
    fitted[j] = Math.min(fitted[j]!, fitted[j + 1]! - minStep);
  }
  return slices.map((slice, rowIndex) => ({
    ...slice,
    rowIndex,
    top: fitted[rowIndex]!,
    height: Math.max(1, fitted[rowIndex + 1]! - fitted[rowIndex]!),
  }));
}

/**
 * Monotonic alignment of interior row boundaries to a column's detected rules.
 *
 * Both sequences are y-sorted and roughly pitch-spaced, but counts differ
 * (glare erases rules; the mesh may merge/split rows). A small DP finds the
 * cheapest order-preserving pairing where a boundary may match a rule within
 * `maxDevPx`, be skipped (paying a penalty), or leave a rule unused. This
 * tolerates ~half-pitch surface drift on curved columns without letting a
 * boundary jump a full row onto a neighbouring rule.
 */
function alignInteriorBoundsToRules(
  bounds: number[],
  ruleYs: number[],
  maxDevPx: number,
): Array<number | null> {
  const n = bounds.length;
  const m = ruleYs.length;
  const out: Array<number | null> = bounds.map(() => null);
  if (n === 0 || m === 0) return out;
  const skipBoundCost = maxDevPx + 1;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const parent: Uint8Array[] = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let j = 0; j <= m; j += 1) dp[0]![j] = 0;
  for (let i = 1; i <= n; i += 1) dp[i]![0] = i * skipBoundCost;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      let best = dp[i - 1]![j]! + skipBoundCost;
      let choice = 0;
      if (dp[i]![j - 1]! < best) {
        best = dp[i]![j - 1]!;
        choice = 1;
      }
      const dev = Math.abs(bounds[i - 1]! - ruleYs[j - 1]!);
      if (dev <= maxDevPx) {
        const matched = dp[i - 1]![j - 1]! + dev;
        if (matched <= best) {
          best = matched;
          choice = 2;
        }
      }
      dp[i]![j] = best;
      parent[i]![j] = choice;
    }
  }
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const choice = i > 0 && j > 0 ? parent[i]![j]! : i > 0 ? 0 : 1;
    if (choice === 2) {
      out[i - 1] = ruleYs[j - 1]!;
      i -= 1;
      j -= 1;
    } else if (choice === 1) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return out;
}

export type ValueColumnWarpProbe = {
  warp: boolean;
  glareMask: ColumnBodyGlareMask;
  leftRuleYs: number[];
  rightRuleYs: number[];
  fullRuleYs: number[];
};

function gutterTrustedAtRule(
  columns: ValueColumnWarpProbe[],
  gutterCount: number,
  gi: number,
  yAnalysis: number,
): boolean {
  if (gi === 0) return columnTrustsRuleAtY(columns[0]!.glareMask, yAnalysis);
  if (gi === gutterCount - 1) return columnTrustsRuleAtY(columns[columns.length - 1]!.glareMask, yAnalysis);
  return (
    columnTrustsRuleAtY(columns[gi - 1]!.glareMask, yAnalysis) &&
    columnTrustsRuleAtY(columns[gi]!.glareMask, yAnalysis)
  );
}

function lerpGutterRuleAtIndex(
  gutterRuleYs: number[][],
  columns: ValueColumnWarpProbe[],
  gutterCount: number,
  gi: number,
  ri: number,
  yAnalysis: number,
): void {
  let west = gi - 1;
  while (west >= 0 && !gutterTrustedAtRule(columns, gutterCount, west, yAnalysis)) west -= 1;
  let east = gi + 1;
  while (east < gutterCount && !gutterTrustedAtRule(columns, gutterCount, east, yAnalysis)) east += 1;
  if (west < 0 && east >= gutterCount) return;
  if (west >= 0 && east >= gutterCount) {
    gutterRuleYs[gi]![ri] = gutterRuleYs[west]![ri]!;
    return;
  }
  if (west < 0 && east < gutterCount) {
    gutterRuleYs[gi]![ri] = gutterRuleYs[east]![ri]!;
    return;
  }
  if (west < 0 || east >= gutterCount) return;
  const t = (gi - west) / Math.max(1, east - west);
  const yW = gutterRuleYs[west]![ri]!;
  const yE = gutterRuleYs[east]![ri]!;
  gutterRuleYs[gi]![ri] = Math.round(yW * (1 - t) + yE * t);
}

/**
 * At each mesh rule, interpolate gutter Y where local column bands are glare-untrusted.
 */
export function interpolateGlareGutterRuleYs(
  gutterRuleYs: number[][],
  columns: ValueColumnWarpProbe[],
  meshInBodyImage: number[],
  meshYToAnalysis: (yImage: number) => number,
): void {
  const gutterCount = gutterRuleYs.length;
  const ruleCount = meshInBodyImage.length;
  if (gutterCount === 0 || ruleCount === 0) return;
  for (let ri = 0; ri < ruleCount; ri += 1) {
    const yAnalysis = meshYToAnalysis(meshInBodyImage[ri]!);
    for (let gi = 0; gi < gutterCount; gi += 1) {
      if (gutterTrustedAtRule(columns, gutterCount, gi, yAnalysis)) continue;
      lerpGutterRuleAtIndex(gutterRuleYs, columns, gutterCount, gi, ri, yAnalysis);
    }
  }
}

export function computeValueColumnGutterRuleYs(
  bodyTop: number,
  bodyBottom: number,
  columns: ValueColumnWarpProbe[],
  meshRuleYs: number[],
  snapTol: number,
  pooledPitch: number,
  meshYToAnalysis: (yImage: number) => number,
  grid: Pick<
    typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
    | 'rowSurfaceWarpMaxDriftPitchFraction'
    | 'rowSurfaceWarpMinMatchedRules'
    | 'rowSurfaceSkewMaxPitchFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): number[][] | null {
  const needsGeometry =
    columns.some((c) => c.warp || columnHasGlareBands(c.glareMask));
  if (!needsGeometry) return null;
  const meshInBody = rulesInBody(bodyTop, bodyBottom, meshRuleYs);
  if (meshInBody.length === 0) return null;

  const span = Math.max(1, bodyBottom - bodyTop);
  const maxDriftPx = Math.max(2, Math.round(pooledPitch * grid.rowSurfaceWarpMaxDriftPitchFraction));
  const offsetSamples = columns.map((col) =>
    col.warp
      ? columnWarpOffsetSamples(
          col.leftRuleYs,
          col.rightRuleYs,
          col.fullRuleYs,
          meshRuleYs,
          bodyTop,
          snapTol,
          pooledPitch,
          grid,
          { skipSubstripSpreadGate: true },
        )
      : null,
  );

  const gutterCount = columns.length + 1;
  const gutterRuleYs: number[][] = Array.from({ length: gutterCount }, () => []);
  for (let gi = 0; gi < gutterCount; gi += 1) {
    const westCol = gi > 0 ? columns[gi - 1] : undefined;
    const eastCol = gi < columns.length ? columns[gi] : undefined;
    for (let ri = 0; ri < meshInBody.length; ri += 1) {
      const meshY = meshInBody[ri]!;
      const yAnalysis = meshYToAnalysis(meshY);
      let leftS: RuleOffsetSample[] | null = null;
      let rightS: RuleOffsetSample[] | null = null;
      if (gi === 0) {
        const first = offsetSamples[0];
        const col0 = columns[0];
        if (first && col0 && columnUsesWarpOffsetAtMeshRule(col0, yAnalysis)) leftS = first.left;
      } else if (gi === gutterCount - 1) {
        const last = offsetSamples[columns.length - 1];
        const colLast = columns[columns.length - 1];
        if (last && colLast && columnUsesWarpOffsetAtMeshRule(colLast, yAnalysis)) {
          rightS = last.right;
        }
      } else {
        const west = offsetSamples[gi - 1];
        const east = offsetSamples[gi];
        if (west && westCol && columnUsesWarpOffsetAtMeshRule(westCol, yAnalysis)) {
          rightS = west.right;
        }
        if (east && eastCol && columnUsesWarpOffsetAtMeshRule(eastCol, yAnalysis)) {
          leftS = east.left;
        }
      }
      const offset = gutterRampedOffsetAtY(meshY, leftS, rightS, bodyTop, span, maxDriftPx);
      gutterRuleYs[gi]!.push(meshY + offset);
    }
  }
  interpolateGlareGutterRuleYs(gutterRuleYs, columns, meshInBody, meshYToAnalysis);
  return gutterRuleYs;
}

/** Median gutter Y per mesh rule; merge rules columns collectively treat as one ink line. */
export function gutterConsensusMeshRuleYsFromGutters(
  bodyTop: number,
  bodyBottom: number,
  meshInBody: number[],
  gutterRuleYs: number[][],
  minBetweenRules: number,
): number[] {
  const merged: number[] = [];
  for (let ri = 0; ri < meshInBody.length; ri += 1) {
    const atRule = gutterRuleYs.map((g) => g[ri]).filter((y): y is number => y !== undefined);
    if (atRule.length === 0) {
      merged.push(meshInBody[ri]!);
    } else {
      atRule.sort((a, b) => a - b);
      merged.push(atRule[Math.floor(atRule.length / 2)]!);
    }
  }
  return consolidateRowBandRuleYs(merged, minBetweenRules).filter(
    (y) => y > bodyTop + 2 && y < bodyBottom - 2,
  );
}

/**
 * Value columns share gutter Y at each rule: right edge of column c meets left edge of c+1.
 */
export function connectedValueRowBandSlicesOnConsensusMesh(
  reference: SharedLabelRowBandSlice[],
  bodyTop: number,
  bodyBottom: number,
  columns: ValueColumnWarpProbe[],
  meshRuleYs: number[],
  snapTol: number,
  pooledPitch: number,
  meshYToAnalysis: (yImage: number) => number,
  grid: Pick<
    typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
    'rowSurfaceWarpMaxDriftPitchFraction' | 'rowSurfaceWarpMinMatchedRules'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
  precomputedGutterRuleYs?: number[][],
  inkMeshRuleYs?: number[],
): SharedLabelRowBandSlice[][] {
  const flat = columns.map(() =>
    reference.map((ref, rowIndex) => ({ rowIndex, top: ref.top, height: ref.height })),
  );
  const needsGeometry = columns.some(
    (c) => c.warp || (columnHasGlareBands(c.glareMask) && c.glareMask.columnGlareWarpSuspect),
  );
  if (reference.length === 0 || !needsGeometry) return flat;

  const meshInBody = rulesInBody(bodyTop, bodyBottom, meshRuleYs);
  const inkMeshInBody = rulesInBody(bodyTop, bodyBottom, inkMeshRuleYs ?? meshRuleYs);
  if (meshInBody.length === 0) return flat;

  const gutterRuleYs =
    precomputedGutterRuleYs ??
    computeValueColumnGutterRuleYs(
      bodyTop,
      bodyBottom,
      columns,
      meshRuleYs,
      snapTol,
      pooledPitch,
      meshYToAnalysis,
      DEFAULT_SHARED_LABEL_GRID_PARAMS,
    );
  const inkSlopeProbe = (
    slices: SharedLabelRowBandSlice[],
    col: ValueColumnWarpProbe,
  ): boolean =>
    skewedSlicesAgreeWithColumnInkSlope(
      slices,
      inkMeshInBody,
      col.leftRuleYs,
      col.rightRuleYs,
      snapTol,
      pooledPitch,
    );

  const skewMinPx = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;

  const inkSlicesForColumn = (col: ValueColumnWarpProbe, colIndex: number): SharedLabelRowBandSlice[] | null => {
    if (!col.warp || col.leftRuleYs.length < 2 || col.rightRuleYs.length < 2) return null;
    const minStep = Math.max(3, Math.round(pooledPitch * 0.12));
    const preferFan = colIndex >= Math.max(0, columns.length - 3);
    const { left: leftInk, right: rightInk } = columnSkewedBoundariesFromSubstripInk(
      inkMeshInBody,
      col.leftRuleYs,
      col.rightRuleYs,
      snapTol,
      skewMinPx,
      col.glareMask,
      meshYToAnalysis,
      preferFan ? true : undefined,
    );
    let leftMono = enforceMonotonicBoundaryYs(leftInk, bodyTop, minStep);
    let rightMono = enforceMonotonicBoundaryYs(rightInk, bodyTop, minStep);
    if (preferFan) {
      ({ left: leftMono, right: rightMono } = enforceDownwardFanBoundaryPairs(
        leftMono,
        rightMono,
        skewMinPx,
      ));
    }
    const skewed = rowBandSlicesFromSkewedColumnBoundaries(bodyTop, bodyBottom, leftMono, rightMono);
    return skewed.length === reference.length ? skewed : null;
  };

  const tagRowIndex = (slices: SharedLabelRowBandSlice[]) =>
    slices.map((slice, rowIndex) => ({ ...slice, rowIndex }));

  if (!gutterRuleYs) {
    return columns.map((col, colIndex) => {
      const useGutterGeometry =
        col.warp || (columnHasGlareBands(col.glareMask) && col.glareMask.columnGlareWarpSuspect);
      if (!useGutterGeometry) return flat[colIndex]!;
      const inkSlices = inkSlicesForColumn(col, colIndex);
      if (inkSlices && inkSlopeProbe(inkSlices, col)) return tagRowIndex(inkSlices);
      return flat[colIndex]!;
    });
  }

  return columns.map((col, colIndex) => {
    const useGutterGeometry =
      col.warp || (columnHasGlareBands(col.glareMask) && col.glareMask.columnGlareWarpSuspect);
    if (!useGutterGeometry) return flat[colIndex]!;

    const inkSlices = inkSlicesForColumn(col, colIndex);
    if (
      inkSlices &&
      inkSlices.length === reference.length &&
      col.warp &&
      (rowWarpVerticalLimitsRelaxed() || inkSlopeProbe(inkSlices, col)) &&
      skewedSlicesAlignWithConsensus(reference, inkSlices, pooledPitch)
    ) {
      return tagRowIndex(inkSlices);
    }
    if (!inkSlices && col.warp && col.leftRuleYs.length >= 2 && col.rightRuleYs.length >= 2) {
      const offsetSlices = columnRowBandSlicesOnConsensusMesh(
        reference,
        bodyTop,
        col.leftRuleYs,
        col.rightRuleYs,
        col.fullRuleYs,
        inkMeshRuleYs ?? meshRuleYs,
        snapTol,
        pooledPitch,
        true,
        warpGridForVerticalLimits(),
      );
      if (
        offsetSlices.length === reference.length &&
        (inkSlopeProbe(offsetSlices, col) ||
          offsetSlices.some(
            (s) => Math.abs(s.bottomSkewPx ?? 0) >= DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx,
          ))
      ) {
        return offsetSlices.map((slice, rowIndex) => ({ ...slice, rowIndex }));
      }
    }

    const leftYs = gutterRuleYs[colIndex] ?? [];
    const rightYs = gutterRuleYs[colIndex + 1] ?? [];
    if (leftYs.length === 0 || rightYs.length === 0) {
      if (inkSlices && inkSlopeProbe(inkSlices, col)) return tagRowIndex(inkSlices);
      return flat[colIndex]!;
    }
    const slices = rowBandSlicesFromSkewedColumnBoundaries(bodyTop, bodyBottom, leftYs, rightYs);
    const warpGrid = warpGridForVerticalLimits();
    const maxSkewPx = Math.max(
      warpGrid.rowSurfaceSkewMinPx,
      Math.round(pooledPitch * warpGrid.rowSurfaceSkewMaxPitchFraction),
    );
    const skewTooStrong = (s: SharedLabelRowBandSlice) =>
      rowWarpVerticalLimitsRelaxed()
        ? false
        : Math.max(Math.abs(s.topSkewPx ?? 0), Math.abs(s.bottomSkewPx ?? 0)) > maxSkewPx;
    if (slices.length !== reference.length) {
      if (inkSlices && inkSlopeProbe(inkSlices, col)) return tagRowIndex(inkSlices);
      if (columnHasGlareBands(col.glareMask)) return flat[colIndex]!;
      return columnRowBandSlicesOnConsensusMesh(
        reference,
        bodyTop,
        col.leftRuleYs,
        col.rightRuleYs,
        col.fullRuleYs,
        meshRuleYs,
        snapTol,
        pooledPitch,
        true,
        DEFAULT_SHARED_LABEL_GRID_PARAMS,
      );
    }
    const gutterOk =
      !slices.some(skewTooStrong) &&
      skewedSlicesAlignWithConsensus(reference, slices, pooledPitch) &&
      inkSlopeProbe(slices, col);
    if (gutterOk) return tagRowIndex(slices);
    if (inkSlices && inkSlopeProbe(inkSlices, col)) return tagRowIndex(inkSlices);
    return flat[colIndex]!;
  });
}

export function rowBandSlicesFromSkewedColumnBoundaries(
  bodyTop: number,
  bodyBottom: number,
  leftBoundaryYs: number[],
  rightBoundaryYs: number[],
  minSliceHeight = 4,
): SharedLabelRowBandSlice[] {
  const n = Math.min(leftBoundaryYs.length, rightBoundaryYs.length);
  if (n === 0) {
    return [{ rowIndex: 0, top: bodyTop, height: Math.max(minSliceHeight, bodyBottom - bodyTop) }];
  }
  const slices: SharedLabelRowBandSlice[] = [];
  let topL = bodyTop;
  let topR = bodyTop;
  for (let i = 0; i < n; i += 1) {
    const botL = leftBoundaryYs[i]!;
    const botR = rightBoundaryYs[i]!;
    const envelopeHeight = Math.max(botL, botR) - Math.min(topL, topR);
    if (envelopeHeight >= minSliceHeight) {
      // Left-edge geometry; the right edge is expressed only through the skew offsets.
      slices.push({
        rowIndex: slices.length,
        top: topL,
        height: Math.max(1, botL - topL),
        topSkewPx: topR - topL,
        bottomSkewPx: botR - botL,
      });
    }
    topL = botL;
    topR = botR;
  }
  const tailHeight = bodyBottom - Math.min(topL, topR);
  if (tailHeight >= minSliceHeight) {
    slices.push({
      rowIndex: slices.length,
      top: topL,
      height: Math.max(1, bodyBottom - topL),
      topSkewPx: topR - topL,
      bottomSkewPx: 0,
    });
  }
  return slices.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Intersect a row region with an axis-aligned clip rect (band or crop envelope). */
export function clipRowRegionBoxToRect(
  box: RowRegionBox,
  clipLeft: number,
  clipTop: number,
  clipWidth: number,
  clipHeight: number,
  minExtent = 1,
): RowRegionBox | null {
  const clipRight = clipLeft + clipWidth;
  const clipBottom = clipTop + clipHeight;
  const left = Math.max(clipLeft, box.left);
  const top = Math.max(clipTop, box.top);
  const right = Math.min(clipRight, box.left + box.width);
  const bottom = Math.min(clipBottom, box.top + box.height);
  const width = right - left;
  const height = bottom - top;
  if (width < minExtent || height < minExtent) return null;
  return { ...box, left, top, width, height };
}

export function mapAnalysisRuleYsToImage(
  ruleYsAnalysis: number[],
  analysisH: number,
  imageBandTop: number,
  imageBandHeight: number,
): number[] {
  return ruleYsAnalysis.map((y) => mapAnalysisYToImageBand(y, analysisH, imageBandTop, imageBandHeight));
}

/**
 * One logical row as a distorted box in image space: each column is still an axis-aligned
 * rectangle; the row surface is their union with top/bottom y allowed to step at gutters.
 * Polygon winds along the top edge (left→right), then the bottom edge (right→left).
 */
export function rowSurfacePolygonPoints(boxes: RowRegionBox[]): string {
  const sorted = [...boxes]
    .filter((b) => b.width > 0 && b.height > 0)
    .sort((a, b) => a.left - b.left);
  if (sorted.length === 0) return '';
  const pts: Array<[number, number]> = [];
  for (const b of sorted) {
    pts.push([b.left, b.top], [b.left + b.width, b.top]);
  }
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const b = sorted[i]!;
    const right = b.left + b.width;
    const bot = b.top + b.height;
    pts.push([right, bot], [b.left, bot]);
  }
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

export function headerRegionBoxes(
  columnIndex: number,
  left: number,
  width: number,
  headerTop: number,
  bodyTop: number,
): RowRegionBox[] {
  const height = Math.max(0, bodyTop - headerTop);
  if (height < 4) return [];
  return [
    {
      columnIndex,
      rowIndex: -1,
      left,
      top: headerTop,
      width,
      height,
      zone: 'header',
      source: 'per_column',
    },
  ];
}

export function consensusRowRegionBoxes(
  valueColumns: Array<{ left: number; width: number }>,
  bodyTop: number,
  bodyBottom: number,
  consensusRuleYsImage: number[],
): RowRegionBox[] {
  const boxes: RowRegionBox[] = [];
  valueColumns.forEach((col, columnIndex) => {
    boxes.push(
      ...rowRegionBoxesBetweenRules(
        columnIndex,
        col.left,
        col.width,
        bodyTop,
        bodyBottom,
        consensusRuleYsImage,
        'consensus',
      ),
    );
  });
  return boxes;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function rulesInBody(bodyTop: number, bodyBottom: number, ruleYsImage: number[]): number[] {
  return [...ruleYsImage].sort((a, b) => a - b).filter((y) => y > bodyTop + 2 && y < bodyBottom - 2);
}

/** Interior mesh Y at the bottom of each consensus row band (matches viz row gaps). */
export function consensusRowSurfaceMeshRuleYs(
  reference: SharedLabelRowBandSlice[],
  bodyTop: number,
  bodyBottom: number,
): number[] {
  return rulesInBody(
    bodyTop,
    bodyBottom,
    reference.slice(0, -1).map((slice) => slice.top + slice.height),
  );
}

function rowSurfaceMeshRuleYsForWarp(
  reference: SharedLabelRowBandSlice[],
  meshReferenceRulesImage: number[],
  bodyTop: number,
  bodyBottom: number,
  minBetweenRules: number,
): number[] {
  const outsideBody = meshReferenceRulesImage.filter(
    (y) => y <= bodyTop + 2 || y >= bodyBottom - 2,
  );
  const interior = consensusRowSurfaceMeshRuleYs(reference, bodyTop, bodyBottom);
  return consolidateRowBandRuleYs([...outsideBody, ...interior], minBetweenRules);
}

/**
 * Label-rail rules that consensus missed: at most one fill per consensus gap, snapped to
 * `below + pitch` when the gap is clearly a single skipped row (not a double-rule sliver).
 */
export function labelOnlyRulesForConsensusMesh(
  consensusBodyRulesImage: number[],
  labelBodyRulesImage: number[],
  pitch: number,
  jitterPx: number,
  minGapSpanPitchFraction: number,
): number[] {
  if (pitch <= 0 || consensusBodyRulesImage.length === 0) return [];
  const minDistinct = rowBandRuleMinSpacingPx(pitch);
  const minSpan = pitch * minGapSpanPitchFraction;
  const maxSingleMissingSpan = pitch * 2.05;
  const consensus = [...consensusBodyRulesImage].sort((a, b) => a - b);
  const fills: number[] = [];
  for (let i = 0; i < consensus.length - 1; i += 1) {
    const below = consensus[i]!;
    const above = consensus[i + 1]!;
    const span = above - below;
    if (span < minSpan || span > maxSingleMissingSpan) continue;
    const targetY = below + Math.round(pitch);
    if (targetY <= below + minDistinct || targetY >= above - minDistinct) continue;
    const pick = labelBodyRulesImage.find(
      (y) =>
        Math.abs(y - targetY) <= jitterPx &&
        y > below + minDistinct &&
        y < above - minDistinct &&
        !consensus.some((c) => Math.abs(c - y) <= jitterPx) &&
        !fills.some((f) => Math.abs(f - y) <= minDistinct),
    );
    if (pick !== undefined) fills.push(pick);
  }
  return fills;
}

/**
 * Label-rail text (e.g. “Amount per serving” / “Calories”) can add ruled lines that do not cross
 * product value columns — never fold those into the shared value mesh inside the body preamble.
 */
export function labelOnlyRulesForValueMesh(
  labelBodyRulesImage: number[],
  valueRulesPerColumn: number[][],
  bodyTop: number,
  pitch: number,
  jitterPx: number,
  preamblePitchFraction: number,
): number[] {
  if (pitch <= 0 || labelBodyRulesImage.length === 0) return [];
  const preambleEnd = bodyTop + Math.round(pitch * preamblePitchFraction);
  const flatValue = valueRulesPerColumn.flat();
  return labelBodyRulesImage.filter((y) => {
    if (y <= bodyTop + 2 || y > preambleEnd) return false;
    return flatValue.some((v) => Math.abs(v - y) <= jitterPx);
  });
}

function rulesInVerticalSpan(spanTop: number, spanBottom: number, ruleYsImage: number[]): number[] {
  return [...ruleYsImage].sort((a, b) => a - b).filter((y) => y > spanTop + 2 && y < spanBottom - 2);
}

/** Median spacing from every column's detected rules (rules inform pitch even when sparse). */
export function poolRowPitchFromRuleSets(
  ruleSets: number[][],
  bodyTop: number,
  bodyBottom: number,
): number {
  const spacings: number[] = [];
  for (const rules of ruleSets) {
    const inBody = rulesInBody(bodyTop, bodyBottom, rules);
    if (inBody.length >= 2) {
      const s = medianConsecutiveSpacing(inBody);
      if (s > 0) spacings.push(s);
    }
  }
  if (spacings.length > 0) return medianOf(spacings);
  return Math.max(8, Math.round((bodyBottom - bodyTop) / 12));
}

export function columnPitchAtBodyEnds(
  detectedInBody: number[],
  pooledPitch: number,
): { pitchTop: number; pitchBottom: number } {
  if (detectedInBody.length >= 3) {
    const pitchTop = detectedInBody[1]! - detectedInBody[0]!;
    const pitchBottom =
      detectedInBody[detectedInBody.length - 1]! - detectedInBody[detectedInBody.length - 2]!;
    return {
      pitchTop: pitchTop > 0 ? pitchTop : pooledPitch,
      pitchBottom: pitchBottom > 0 ? pitchBottom : pooledPitch,
    };
  }
  if (detectedInBody.length === 2) {
    const gap = detectedInBody[1]! - detectedInBody[0]!;
    const p = gap > 0 ? gap : pooledPitch;
    return { pitchTop: p, pitchBottom: p };
  }
  return { pitchTop: pooledPitch, pitchBottom: pooledPitch };
}

/**
 * Map fraction f∈[0,1] along the body to image y when row pitch morphs from top-heavy to bottom-heavy
 * (linear pitch curve — trapezoids and gently curved ruled grids).
 */
export function yAtPitchWeightedBodyFraction(
  bodyTop: number,
  bodyBottom: number,
  pitchTop: number,
  pitchBottom: number,
  fraction: number,
): number {
  const H = bodyBottom - bodyTop;
  if (H <= 0) return bodyTop;
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return bodyTop;
  if (f >= 1) return bodyBottom;
  const steps = 64;
  const weights: number[] = [];
  let total = 0;
  for (let i = 0; i < steps; i += 1) {
    const s = (i + 0.5) / steps;
    const pitch = pitchTop * (1 - s) + pitchBottom * s;
    weights.push(pitch);
    total += pitch;
  }
  let accum = 0;
  const target = f * total;
  for (let i = 0; i < steps; i += 1) {
    accum += weights[i]!;
    if (accum >= target) {
      return bodyTop + ((i + 1) / steps) * H;
    }
  }
  return bodyTop + f * H;
}

function referenceRuleFractions(bodyTop: number, bodyBottom: number, referenceRuleYsImage: number[]): number[] {
  const span = Math.max(1, bodyBottom - bodyTop);
  return rulesInBody(bodyTop, bodyBottom, referenceRuleYsImage).map((y) => (y - bodyTop) / span);
}

/**
 * Infer interior rule lines: snap to detections when present, else walk a pitch surface between body anchors.
 * Uses a shared reference mesh so rowIndex stays aligned across skewed / curved columns.
 */
export function inferColumnBodyRuleYsSurface(input: {
  bodyTop: number;
  bodyBottom: number;
  detectedRuleYsImage: number[];
  pooledPitch: number;
  referenceRuleYsImage: number[];
}): number[] {
  const { bodyTop, bodyBottom, pooledPitch, referenceRuleYsImage } = input;
  const detectedInBody = rulesInBody(bodyTop, bodyBottom, input.detectedRuleYsImage);
  const refInBody = rulesInBody(bodyTop, bodyBottom, referenceRuleYsImage);
  const minBetweenRules = rowBandRuleMinSpacingPx(pooledPitch);
  const snapTol = Math.max(4, Math.round(pooledPitch * 0.38));

  if (refInBody.length >= 1) {
    const snappedRef = refInBody.map((y) => {
      const near = detectedInBody.find((d) => Math.abs(d - y) <= snapTol);
      return near ?? y;
    });
    return consolidateRowBandRuleYs(snappedRef, minBetweenRules).filter(
      (y) => y > bodyTop + 2 && y < bodyBottom - 2,
    );
  }

  if (detectedInBody.length === 0) {
    return [];
  }

  return consolidateRowBandRuleYs(detectedInBody, minBetweenRules).filter(
    (y) => y > bodyTop + 2 && y < bodyBottom - 2,
  );
}

export function rowBandSlicesFromColumnRules(
  bodyTop: number,
  bodyBottom: number,
  ruleYsImage: number[],
  minSliceHeight = 4,
  options?: { ruleBoundaryBiasPx?: number; rulesAreInkBoundaries?: boolean },
): SharedLabelRowBandSlice[] {
  const pitch =
    ruleYsImage.length >= 2
      ? medianConsecutiveSpacing(ruleYsImage)
      : Math.max(8, Math.round((bodyBottom - bodyTop) / 12));
  const minBetweenRules = rowBandRuleMinSpacingPx(pitch);
  const consolidated = consolidateRowBandRuleYs(ruleYsImage, minBetweenRules);
  const bias =
    options?.rulesAreInkBoundaries === true
      ? 0
      : options?.ruleBoundaryBiasPx !== undefined
        ? options.ruleBoundaryBiasPx
        : pitch > 0
          ? Math.max(1, Math.round(pitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandRuleBoundaryBiasPitchFraction))
          : 0;
  const slices = rowBandSlicesBetweenRules(bodyTop, bodyBottom, consolidated, minSliceHeight, bias);
  const expanded = expandRowBandSlicesToMinReadableHeight(slices, pitch, DEFAULT_SHARED_LABEL_GRID_PARAMS);
  return disjointRowBandSlices(expanded, DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx);
}

/** Split row bands that clearly contain two nutrient rows (~2× pitch) without an interior rule. */
export function splitDoubleHeightRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  pitch: number,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || pitch <= 0) return slices;
  const out: SharedLabelRowBandSlice[] = [];
  for (const slice of slices) {
    const heightPitch = slice.height / pitch;
    if (heightPitch >= 1.85 && heightPitch <= 2.4) {
      const mid = slice.top + Math.round(pitch);
      const h1 = mid - slice.top;
      const h2 = slice.top + slice.height - mid;
      if (h1 >= 8 && h2 >= 8) {
        out.push({ rowIndex: 0, top: slice.top, height: h1 });
        out.push({ rowIndex: 0, top: mid, height: h2 });
        continue;
      }
    }
    out.push(slice);
  }
  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Leave Calories/% DV preamble alone — `splitDailyValueTransitionFromBody` owns that band. */
export function splitDoubleHeightRowBandSlicesPreservingPreamble(
  slices: SharedLabelRowBandSlice[],
  pitch: number,
  bodyTop: number,
  preambleEndY: number | undefined,
): SharedLabelRowBandSlice[] {
  if (preambleEndY === undefined || pitch <= 0) {
    return splitDoubleHeightRowBandSlices(slices, pitch);
  }
  const out: SharedLabelRowBandSlice[] = [];
  for (const slice of slices) {
    const spansPreamble =
      slice.top < preambleEndY - 2 && slice.top + slice.height > bodyTop + Math.max(8, Math.round(pitch * 0.35));
    if (spansPreamble) {
      out.push(slice);
      continue;
    }
    out.push(...splitDoubleHeightRowBandSlices([slice], pitch));
  }
  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/**
 * Bands that start above `cutY` but extend below it belong in the nutrient mesh — not left
 * wholly in the flat preamble bucket (warped outer columns often merge % DV through row 1).
 */
export function splitRowBandSlicesCrossingY(
  slices: SharedLabelRowBandSlice[],
  cutY: number,
  overlapPx: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
): { above: SharedLabelRowBandSlice[]; below: SharedLabelRowBandSlice[] } {
  const above: SharedLabelRowBandSlice[] = [];
  const below: SharedLabelRowBandSlice[] = [];
  for (const slice of slices) {
    const bottom = slice.top + slice.height;
    if (slice.top < cutY - 2 && bottom > cutY + 2) {
      const hAbove = cutY - slice.top;
      const hBelow = bottom - cutY;
      if (hAbove >= 4) {
        above.push({ ...slice, height: hAbove });
      }
      if (hBelow >= 4) {
        below.push({
          ...slice,
          top: cutY,
          height: hBelow,
        });
      }
    } else if (slice.top < cutY - 2) {
      above.push(slice);
    } else {
      below.push(slice);
    }
  }
  return {
    above: disjointRowBandSlices(above, overlapPx),
    below: disjointRowBandSlices(below, overlapPx),
  };
}

export type RowSurfaceLayoutMode = 'shared' | 'per_column';

export type PerColumnRowBandSlicePlan = {
  rowSurfaceMode: RowSurfaceLayoutMode;
  /** Consensus mesh (manifest row count + straight-table OCR). */
  consensusRowBandSlices: SharedLabelRowBandSlice[];
  labelRowBandSlices: SharedLabelRowBandSlice[];
  valueRowBandSlicesPerColumn: SharedLabelRowBandSlice[][];
  headerConsensusRowBandSlices: SharedLabelRowBandSlice[];
  headerLabelRowBandSlices: SharedLabelRowBandSlice[];
  headerRowBandSlicesPerColumn: SharedLabelRowBandSlice[][];
  /** Per value column: glare trust bands (analysis y) used for row-surface estimation. */
  valueColumnGlareMasks: ColumnBodyGlareMask[];
  valueColumnWarpProbes: ValueColumnWarpProbe[];
  /** Columns whose slice count disagreed with consensus and were rebuilt on the consensus mesh. */
  rowBandReconciledColumns: number;
};

export function maxRowTopSpreadPx(
  reference: SharedLabelRowBandSlice[],
  columns: SharedLabelRowBandSlice[][],
): number {
  let maxSpread = 0;
  for (const col of columns) {
    for (let i = 0; i < Math.min(reference.length, col.length); i += 1) {
      const delta = Math.abs(col[i]!.top - reference[i]!.top);
      if (delta > maxSpread) maxSpread = delta;
    }
  }
  return maxSpread;
}

function columnRowTopSpreadPx(
  reference: SharedLabelRowBandSlice[],
  col: SharedLabelRowBandSlice[],
): number {
  if (col.length !== reference.length) return Number.POSITIVE_INFINITY;
  let maxSpread = 0;
  for (let i = 0; i < reference.length; i += 1) {
    maxSpread = Math.max(maxSpread, Math.abs(col[i]!.top - reference[i]!.top));
  }
  return maxSpread;
}

function columnRowHeightSpreadPx(
  reference: SharedLabelRowBandSlice[],
  col: SharedLabelRowBandSlice[],
): number {
  if (col.length !== reference.length) return Number.POSITIVE_INFINITY;
  let maxSpread = 0;
  for (let i = 0; i < reference.length; i += 1) {
    maxSpread = Math.max(maxSpread, Math.abs(col[i]!.height - reference[i]!.height));
  }
  return maxSpread;
}

function columnWithinLocalGeometryTolerance(
  reference: SharedLabelRowBandSlice[],
  col: SharedLabelRowBandSlice[],
  pooledPitch: number,
  localTolerancePitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceLocalGeometryTolerancePitchFraction,
): boolean {
  const tol = Math.max(4, Math.round(pooledPitch * localTolerancePitchFraction));
  return (
    columnRowTopSpreadPx(reference, col) <= tol && columnRowHeightSpreadPx(reference, col) <= tol
  );
}

export function alignRowSurfacesToReference(
  reference: SharedLabelRowBandSlice[],
  columns: SharedLabelRowBandSlice[][],
  pooledPitch: number,
  straightSpreadPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceStraightSpreadPitchFraction,
): { mode: RowSurfaceLayoutMode; columns: SharedLabelRowBandSlice[][] } {
  const threshold = Math.max(6, Math.round(pooledPitch * straightSpreadPitchFraction));
  const aligned = columns.map((col) => col.map((s) => ({ ...s })));
  const anyWarped = columns.some(
    (col) =>
      columnRowTopSpreadPx(reference, col) > threshold ||
      !columnWithinLocalGeometryTolerance(reference, col, pooledPitch),
  );
  return { mode: anyWarped ? 'per_column' : 'shared', columns: aligned };
}

/**
 * Product-name header: do not reuse nutrient-body pitch inference (empty header rules used to yield ~10 slivers).
 */
export function rowBandSlicesForHeaderSpan(
  spanTop: number,
  spanBottom: number,
  detectedRuleYsImage: number[],
  referenceRuleYsImage: number[],
  bodyRowPitchPx: number,
  grid: Pick<
    typeof DEFAULT_SHARED_LABEL_GRID_PARAMS,
    | 'headerMaxRowBandSlices'
    | 'headerMinInteriorRuleSpacingSpanFraction'
    | 'headerMaxInteriorRuleSpanFraction'
    | 'headerKeepRuleNearBodySpanFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): SharedLabelRowBandSlice[] {
  const span = spanBottom - spanTop;
  if (span < 8) return [];
  const minSpacing = Math.max(
    12,
    Math.round(span * grid.headerMinInteriorRuleSpacingSpanFraction),
  );
  const detected = rulesInVerticalSpan(spanTop, spanBottom, detectedRuleYsImage);
  const reference = rulesInVerticalSpan(spanTop, spanBottom, referenceRuleYsImage);
  const nearBodySpan = Math.max(12, Math.round(span * grid.headerKeepRuleNearBodySpanFraction));
  let rules = consolidateRowBandRuleYs([...reference, ...detected], minSpacing).filter((y) => {
    if (y <= spanTop + 2 || y >= spanBottom - 2) return false;
    const frac = (y - spanTop) / span;
    const nearBody = spanBottom - y <= nearBodySpan;
    return frac < grid.headerMaxInteriorRuleSpanFraction || nearBody;
  });

  const maxSlices = Math.max(1, grid.headerMaxRowBandSlices);
  if (rules.length === 0 || span <= bodyRowPitchPx * 1.15) {
    return [{ rowIndex: 0, top: spanTop, height: span }];
  }

  if (rules.length > maxSlices - 1) {
    rules = rules.slice(0, maxSlices - 1);
  }

  const boundaryOpts = { rulesAreInkBoundaries: true as const };
  let slices = rowBandSlicesFromColumnRules(spanTop, spanBottom, rules, 4, boundaryOpts);
  while (slices.length > maxSlices && slices.length > 1) {
    const last = slices.pop()!;
    const prev = slices.pop()!;
    slices.push({
      rowIndex: prev.rowIndex,
      top: prev.top,
      height: prev.height + last.height,
    });
  }
  const clipped = slices
    .map((slice) => {
      const top = Math.max(spanTop, slice.top);
      const bottom = Math.min(spanBottom, slice.top + slice.height);
      return { ...slice, top, height: bottom - top };
    })
    .filter((slice) => slice.height >= 4);
  return clipped.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/**
 * Value columns must share the label rail's near-body header band (% Daily Value), not one tall product slab.
 */
export function syncValueHeaderBandsToLabelHeader(
  headerLabelSlices: SharedLabelRowBandSlice[],
  headerConsensusSlices: SharedLabelRowBandSlice[],
  headerPerColumnSlices: SharedLabelRowBandSlice[][],
  spanTop: number,
  spanBottom: number,
): {
  headerConsensusRowBandSlices: SharedLabelRowBandSlice[];
  headerRowBandSlicesPerColumn: SharedLabelRowBandSlice[][];
} {
  if (headerLabelSlices.length < 2) {
    return {
      headerConsensusRowBandSlices: headerConsensusSlices,
      headerRowBandSlicesPerColumn: headerPerColumnSlices,
    };
  }
  const template = headerLabelSlices.map((slice, rowIndex) => ({
    rowIndex,
    top: slice.top,
    height: slice.height,
  }));
  const apply = (existing: SharedLabelRowBandSlice[]) =>
    existing.length >= template.length ? existing : template;
  return {
    headerConsensusRowBandSlices: apply(headerConsensusSlices),
    headerRowBandSlicesPerColumn: headerPerColumnSlices.map(apply),
  };
}

/** First ruled line at or below the body preamble (Calories row), not % Daily Value ink. */
export function firstSubstantiveNutrientRuleY(
  bodyTop: number,
  bodyBottom: number,
  pitch: number,
  ruleYsImage: number[],
  belowBodyTopPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyBelowFirstRulePitchFraction,
): number | undefined {
  if (pitch <= 0) return undefined;
  const floorY = bodyTop + Math.round(pitch * belowBodyTopPitchFraction);
  const inBody = rulesInBody(bodyTop, bodyBottom, ruleYsImage);
  return inBody.find((y) => y >= floorY);
}

/** Calories row top from product columns only (ignore label-rail rules merged into the mesh). */
export function firstSubstantiveNutrientRuleYOnValueColumns(
  bodyTop: number,
  bodyBottom: number,
  pitch: number,
  valueRulesPerColumn: number[][],
  belowBodyTopPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyBelowFirstRulePitchFraction,
): number | undefined {
  if (pitch <= 0 || valueRulesPerColumn.length === 0) return undefined;
  const floorY = bodyTop + Math.round(pitch * belowBodyTopPitchFraction);
  const jitter = Math.max(4, Math.round(pitch * 0.22));
  const firstPerCol: number[] = [];
  for (const rules of valueRulesPerColumn) {
    const first = rulesInBody(bodyTop, bodyBottom, rules).find((y) => y >= floorY);
    if (first !== undefined) firstPerCol.push(first);
  }
  if (firstPerCol.length === 0) return undefined;
  const buckets = new Map<number, number>();
  for (const y of firstPerCol) {
    let bucket = y;
    for (const key of buckets.keys()) {
      if (Math.abs(key - y) <= jitter) {
        bucket = key;
        break;
      }
    }
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let bestY = firstPerCol[0]!;
  let bestVotes = 0;
  for (const [y, votes] of buckets) {
    if (votes > bestVotes || (votes === bestVotes && y < bestY)) {
      bestVotes = votes;
      bestY = y;
    }
  }
  return bestY;
}

/** Calories row starts at the nutrient body top (not below an interior rule). */
export function caloriesRowSliceTopY(bodyTop: number): number {
  return bodyTop;
}

/**
 * True when ruled body preamble is tall enough for separate Calories then % Daily Value rows
 * (common on variety-pack value columns; not asserted for every label layout).
 */
export function bodyPreambleSuggestsCaloriesThenDailyValue(
  bodyTop: number,
  firstInteriorRuleY: number,
  pitch: number,
): boolean {
  if (pitch <= 0) return false;
  const preamble = firstInteriorRuleY - bodyTop;
  return preamble >= Math.round(pitch * 1.12);
}

/**
 * Label rail: split preamble at a ruled line between "Calories" and "% Daily Value" label copy
 * (do not use this Y on value columns — calorie digits are often one tall row).
 */
export function dailyValueRowSliceTopYFromLabelRules(
  bodyTop: number,
  firstInteriorRuleY: number,
  pitch: number,
  labelRuleYsInBody: number[],
): number | undefined {
  if (!bodyPreambleSuggestsCaloriesThenDailyValue(bodyTop, firstInteriorRuleY, pitch)) {
    return undefined;
  }
  const floorY = bodyTop + Math.max(6, Math.round(pitch * 0.12));
  const ceilingY = firstInteriorRuleY - Math.max(8, Math.round(pitch * 0.35));
  const inBand = rulesInBody(bodyTop, firstInteriorRuleY, labelRuleYsInBody).filter(
    (y) => y > floorY && y < ceilingY,
  );
  return inBand[0];
}

/** Label-only preamble split (text rows); never reuse on value columns. */
export function dailyValueRowSliceTopYForLabelColumn(
  bodyTop: number,
  firstInteriorRuleY: number,
  pitch: number,
  labelRuleYsInBody: number[],
  labelTextRowPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.labelBodyCaloriesTextRowPitchFraction,
): number | undefined {
  const fromRule = dailyValueRowSliceTopYFromLabelRules(
    bodyTop,
    firstInteriorRuleY,
    pitch,
    labelRuleYsInBody,
  );
  if (fromRule !== undefined) return fromRule;
  if (!bodyPreambleSuggestsCaloriesThenDailyValue(bodyTop, firstInteriorRuleY, pitch) || pitch <= 0) {
    return undefined;
  }
  const textRowTop = bodyTop + Math.round(pitch * labelTextRowPitchFraction);
  const ceilingY = firstInteriorRuleY - Math.max(8, Math.round(pitch * 0.35));
  if (textRowTop > bodyTop + 6 && textRowTop < ceilingY) {
    return textRowTop;
  }
  return undefined;
}

/**
 * Value columns: only split when a preamble rule is corroborated across product columns
 * (never mirror label two-line copy into value geometry).
 */
export function dailyValueRowSliceTopYFromValueColumns(
  bodyTop: number,
  firstInteriorRuleY: number,
  pitch: number,
  valueRulesPerColumn: number[][],
): number | undefined {
  if (!bodyPreambleSuggestsCaloriesThenDailyValue(bodyTop, firstInteriorRuleY, pitch)) {
    return undefined;
  }
  const floorY = bodyTop + Math.round(pitch * 0.55);
  const ceilingY = firstInteriorRuleY - Math.max(8, Math.round(pitch * 0.35));
  const jitter = Math.max(4, Math.round(pitch * 0.22));
  const buckets = new Map<number, number>();
  let columnsWithBandRule = 0;
  for (const rules of valueRulesPerColumn) {
    const bandRules = rulesInBody(bodyTop, firstInteriorRuleY, rules).filter(
      (y) => y > floorY && y < ceilingY,
    );
    if (bandRules.length === 0) continue;
    columnsWithBandRule += 1;
    const y = bandRules[0]!;
    let bucket = y;
    for (const key of buckets.keys()) {
      if (Math.abs(key - y) <= jitter) {
        bucket = key;
        break;
      }
    }
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  if (columnsWithBandRule < Math.ceil(valueRulesPerColumn.length * 0.45)) {
    return undefined;
  }
  let bestY: number | undefined;
  let bestVotes = 0;
  for (const [y, votes] of buckets) {
    if (votes > bestVotes) {
      bestVotes = votes;
      bestY = y;
    }
  }
  if (bestY === undefined || bestVotes < Math.ceil(valueRulesPerColumn.length * 0.45)) {
    return undefined;
  }
  return bestY;
}

/**
 * Value columns: ink vote when present; otherwise anchor a short % Daily band on the first
 * nutrient rule and keep a taller calories band above (large digits).
 */
export function dailyValueRowSliceTopYForValueColumns(
  bodyTop: number,
  firstInteriorRuleY: number,
  pitch: number,
  valueRulesPerColumn: number[][],
  dailyValueBandPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyDailyValueBandPitchFraction,
  caloriesMinHeightPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyCaloriesBandMinPitchFraction,
  caloriesMinPreambleFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyCaloriesMinPreambleFraction,
  dailyValueMinBandPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyDailyValueBandMinPitchFraction,
): number | undefined {
  const fromInk = dailyValueRowSliceTopYFromValueColumns(
    bodyTop,
    firstInteriorRuleY,
    pitch,
    valueRulesPerColumn,
  );
  if (fromInk !== undefined) return fromInk;
  if (!bodyPreambleSuggestsCaloriesThenDailyValue(bodyTop, firstInteriorRuleY, pitch)) {
    return undefined;
  }
  const preamble = firstInteriorRuleY - bodyTop;
  const dvMin = Math.max(12, Math.round(pitch * dailyValueMinBandPitchFraction));
  const caloriesShare = Math.min(0.94, Math.max(0.62, caloriesMinPreambleFraction));
  const dvShare = 1 - caloriesShare;
  const dvBandCap = Math.max(dvMin, Math.round(preamble * dvShare));
  const dvBand = Math.max(
    dvMin,
    Math.min(Math.round(pitch * dailyValueBandPitchFraction), dvBandCap),
  );
  let dvTop = firstInteriorRuleY - dvBand;
  dvTop = Math.max(
    dvTop,
    bodyTop + Math.round(preamble * caloriesShare),
    bodyTop + Math.round(pitch * caloriesMinHeightPitchFraction),
  );
  dvTop = Math.min(dvTop, firstInteriorRuleY - dvMin);
  if (dvTop <= bodyTop + 4) {
    return undefined;
  }
  return dvTop;
}

/**
 * Split tall body preambles into Calories + % Daily Value body bands (both body zone).
 * Headers are unchanged (gold ends at the label header span, not through calorie ink).
 */
export function splitDailyValueTransitionFromBody(
  bodyTop: number,
  firstInteriorRuleY: number,
  _pitch: number,
  headerSlices: SharedLabelRowBandSlice[],
  bodySlices: SharedLabelRowBandSlice[],
  dvTop: number | undefined,
): { headerSlices: SharedLabelRowBandSlice[]; bodySlices: SharedLabelRowBandSlice[] } {
  if (dvTop === undefined || dvTop <= bodyTop + 4 || firstInteriorRuleY <= dvTop + 4) {
    return { headerSlices, bodySlices };
  }
  const calHeight = dvTop - bodyTop;
  const dvHeight = firstInteriorRuleY - dvTop;
  if (calHeight < 4 || dvHeight < 4) {
    return { headerSlices, bodySlices };
  }
  const calorieSlice: SharedLabelRowBandSlice = { rowIndex: 0, top: bodyTop, height: calHeight };
  const dailyValueSlice: SharedLabelRowBandSlice = { rowIndex: 1, top: dvTop, height: dvHeight };
  const nutrientTail = bodySlices
    .filter((slice) => slice.top + slice.height > firstInteriorRuleY + 2)
    .map((slice) => {
      if (slice.top < firstInteriorRuleY - 2) {
        const bottom = slice.top + slice.height;
        return { ...slice, top: firstInteriorRuleY, height: bottom - firstInteriorRuleY };
      }
      return { ...slice };
    })
    .filter((slice) => slice.top >= firstInteriorRuleY - 2 && slice.height >= 4);
  const bodyOut = disjointRowBandSlices(
    [calorieSlice, dailyValueSlice, ...nutrientTail],
    DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
  ).map((slice, rowIndex) => ({
    ...slice,
    rowIndex,
  }));
  return { headerSlices, bodySlices: bodyOut };
}

/**
 * Value columns: one OCR cell for Calories + % Daily values unless product columns share
 * a ruled line in the preamble (no pitch-based slash through large calorie digits).
 */
export function collapseBodyPreambleToSingleBand(
  bodyTop: number,
  firstInteriorRuleY: number | undefined,
  slices: SharedLabelRowBandSlice[],
): SharedLabelRowBandSlice[] {
  if (firstInteriorRuleY === undefined || firstInteriorRuleY <= bodyTop + 8) {
    return slices.map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }
  const preambleEnd = firstInteriorRuleY;
  const spansPreamble = slices.some(
    (s) => s.top < preambleEnd - 2 && s.top + s.height > bodyTop + 4,
  );
  if (!spansPreamble) {
    return slices.map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }
  const tail = slices
    .filter((s) => s.top >= preambleEnd - 2)
    .filter((s) => s.height >= 4);
  const preamble: SharedLabelRowBandSlice = {
    rowIndex: 0,
    top: bodyTop,
    height: preambleEnd - bodyTop,
  };
  const stitched = disjointRowBandSlices(
    [preamble, ...tail],
    DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
  ).map((slice, rowIndex) => ({
    ...slice,
    rowIndex,
    ...(slice.top < preambleEnd + 2
      ? { topSkewPx: 0, bottomSkewPx: 0 }
      : {
          topSkewPx: slice.topSkewPx,
          bottomSkewPx: slice.bottomSkewPx,
        }),
  }));
  return stitched;
}

/** Re-anchor Total Fat row at the voted first nutrient rule when warp/gutter drops it. */
export function repairBodyBandsAfterPreamble(
  bodyTop: number,
  firstInteriorRuleY: number | undefined,
  slices: SharedLabelRowBandSlice[],
  pitch: number,
): SharedLabelRowBandSlice[] {
  if (firstInteriorRuleY === undefined || firstInteriorRuleY <= bodyTop + 8 || pitch <= 0) {
    return slices.map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }
  const merged = collapseBodyPreambleToSingleBand(bodyTop, firstInteriorRuleY, slices);
  const preamble = merged.filter((s) => s.top < firstInteriorRuleY + 2);
  let tail = merged.filter((s) => s.top >= firstInteriorRuleY - 2);
  const maxLead = Math.max(6, Math.round(pitch * 0.28));
  const anchored = tail.some(
    (s) => s.top <= firstInteriorRuleY + maxLead && s.top + s.height >= firstInteriorRuleY + Math.round(pitch * 0.45),
  );
  if (tail.length === 0) {
    tail = [
      {
        rowIndex: preamble.length,
        top: firstInteriorRuleY,
        height: Math.max(12, Math.round(pitch)),
      },
    ];
  } else if (!anchored && tail[0]!.top > firstInteriorRuleY + maxLead) {
    const gap = tail[0]!.top - firstInteriorRuleY;
    if (gap >= 4) {
      tail = [{ rowIndex: preamble.length, top: firstInteriorRuleY, height: gap }, ...tail];
    }
  }
  return disjointRowBandSlices(
    [...preamble, ...tail],
    DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
  ).map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** When per-column warp drifts from consensus, keep flat preamble and snap nutrient rows to reference. */
export function snapValueNutrientRowsToConsensus(
  bodyTop: number,
  preambleEndY: number | undefined,
  reference: SharedLabelRowBandSlice[],
  column: SharedLabelRowBandSlice[],
  pooledPitch: number,
  straightSpreadPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceStraightSpreadPitchFraction,
): SharedLabelRowBandSlice[] {
  if (preambleEndY === undefined || preambleEndY <= bodyTop + 8) {
    return column.map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }
  const pre: SharedLabelRowBandSlice[] = [
    { rowIndex: 0, top: bodyTop, height: preambleEndY - bodyTop, topSkewPx: 0, bottomSkewPx: 0 },
  ];
  const refNutrients = reference.filter((s) => s.top >= preambleEndY - 2);
  if (refNutrients.length === 0) {
    return repairBodyBandsAfterPreamble(bodyTop, preambleEndY, column, pooledPitch);
  }
  void straightSpreadPitchFraction;
  void column;
  return [...pre, ...refNutrients.map((s) => ({ ...s }))].map((slice, rowIndex) => ({
    ...slice,
    rowIndex,
  }));
}

/** Curved outer columns: keep warp-derived row tops; flat cells only (no skew polygons). */
export function valueColumnKeepsWarpedNutrientRows(
  colIndex: number,
  columnCount: number,
  probe: ValueColumnWarpProbe | undefined,
  meshRuleYsInBody: number[],
  snapTol: number,
): boolean {
  if (!probe?.warp || probe.leftRuleYs.length < 2 || meshRuleYsInBody.length < 2) {
    return false;
  }
  const outerStart = Math.max(0, columnCount - 5);
  if (colIndex < outerStart) return false;
  if (!probe.warp) return false;
  const skewMin = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;
  const spreads = columnSubstripInkSkewAtMesh(
    meshRuleYsInBody,
    probe.leftRuleYs,
    probe.rightRuleYs,
    snapTol,
  );
  if (spreads.length < 2) return true;
  if (Math.abs(medianOf(spreads)) >= skewMin) return true;
  // Outer perspective strip: keep skewed finalize even when substrip spread median is near zero.
  return (
    colIndex >= outerStart ||
    columnHasGlareBands(probe.glareMask) ||
    columnInkSkewDeltasAlongMesh(meshRuleYsInBody, probe.leftRuleYs, probe.rightRuleYs, snapTol).some(
      (d) => Math.abs(d) >= skewMin,
    )
  );
}

/** Warped mesh slices from `connectedValueRowBandSlicesOnConsensusMesh` — use when finalize would flatten to consensus. */
export function warpedNutrientRowSlicesUsable(
  reference: SharedLabelRowBandSlice[],
  warped: SharedLabelRowBandSlice[],
  pooledPitch: number,
  /** Foreshortened outer columns: row bands can be taller than consensus pitch. */
  allowPerspectiveTallerRows = false,
): boolean {
  if (warped.length === 0 || warped.length !== reference.length) return false;
  const maxTopDelta = Math.max(10, Math.round(pooledPitch * 0.5));
  const heightFraction = allowPerspectiveTallerRows ? 1.35 : 0.65;
  const maxHeightDelta = Math.max(14, Math.round(pooledPitch * heightFraction));
  for (let i = 0; i < reference.length; i += 1) {
    const ref = reference[i]!;
    const w = warped[i]!;
    if (w.height < 8) return false;
    if (Math.abs(w.top - ref.top) > maxTopDelta) return false;
    if (Math.abs(w.height - ref.height) > maxHeightDelta) return false;
  }
  for (let i = 1; i < warped.length; i += 1) {
    const prev = warped[i - 1]!;
    const cur = warped[i]!;
    if (cur.top < prev.top + prev.height - 4) return false;
  }
  return true;
}

function flattenWarpedRowBandSlice(slice: SharedLabelRowBandSlice): SharedLabelRowBandSlice {
  const aligned = rowBandSliceAxisAlignedBounds(slice);
  return {
    rowIndex: slice.rowIndex,
    top: aligned.top,
    height: aligned.height,
    topSkewPx: 0,
    bottomSkewPx: 0,
  };
}

/** Nutrient rows on a curved outer column: mesh rules snapped to this column's ink (glare-aware). */
export function valueWarpedNutrientSlicesFromInkMesh(
  preambleEndY: number,
  bodyBottom: number,
  refNutrients: SharedLabelRowBandSlice[],
  meshRuleYsFull: number[],
  probe: ValueColumnWarpProbe,
  snapTol: number,
  pooledPitch: number,
): SharedLabelRowBandSlice[] | null {
  void meshRuleYsFull;
  const meshAnchors = [
    preambleEndY,
    ...refNutrients.slice(0, -1).map((slice) => slice.top + slice.height),
  ];
  const localRules = rulesInBody(preambleEndY, bodyBottom, probe.fullRuleYs);
  if (meshAnchors.length < 2 || localRules.length < 2 || refNutrients.length === 0) {
    return null;
  }
  const warpedMesh = columnInkBoundaryYsAlongMesh(meshAnchors, localRules, snapTol, probe.glareMask);
  if (warpedMesh.length < 2) return null;

  const out: SharedLabelRowBandSlice[] = [];
  for (let i = 0; i < refNutrients.length; i += 1) {
    const ref = refNutrients[i]!;
    const top = i === 0 ? preambleEndY : warpedMesh[i]!;
    const rowDrift = top - ref.top;
    const refBottom = ref.top + ref.height;
    const bottom =
      i + 1 < warpedMesh.length ? warpedMesh[i + 1]! : refBottom + rowDrift;
    const height = Math.max(8, bottom - top);
    if (height < 8) return null;
    out.push({ rowIndex: i, top, height, topSkewPx: 0, bottomSkewPx: 0 });
  }
  return warpedNutrientRowSlicesUsable(refNutrients, out, pooledPitch) ? out : null;
}

/**
 * Curved outer columns: one skewed band per row with tops/bottoms from left vs right ruled ink.
 */
export function valueSkewedNutrientSlicesFromColumnInk(
  bodyTop: number,
  preambleEndY: number,
  bodyBottom: number,
  refNutrients: SharedLabelRowBandSlice[],
  probe: ValueColumnWarpProbe,
  meshRuleYsFull: number[],
  snapTol: number,
  pooledPitch: number,
  preferDownwardFan = false,
  /** Outermost perspective columns: consensus mesh can sit above local ruled ink and squash bands. */
  anchorInkMeshToColumnRules = false,
  closingFooterY?: number,
): SharedLabelRowBandSlice[] | null {
  void meshRuleYsFull;
  if (refNutrients.length === 0 || probe.leftRuleYs.length < 2 || probe.rightRuleYs.length < 2) {
    return null;
  }
  const consensusMeshYs = refNutrients
    .slice(0, -1)
    .map((slice) => slice.top + slice.height)
    .filter((y) => y > bodyTop + 2 && y < bodyBottom - 2);
  let inkMeshInBody = consensusMeshYs;
  if (anchorInkMeshToColumnRules) {
    const minFirstMeshY = preambleEndY + Math.max(12, Math.round(pooledPitch * 0.55));
    const columnBodyRules = rulesInBody(preambleEndY, bodyBottom, probe.fullRuleYs).filter(
      (y) => y >= minFirstMeshY && y > bodyTop + 2 && y < bodyBottom - 2,
    );
    const needMeshYs = refNutrients.length - 1;
    if (columnBodyRules.length >= 2) {
      if (columnBodyRules.length >= needMeshYs) {
        inkMeshInBody = columnBodyRules.slice(0, needMeshYs);
      } else {
        inkMeshInBody = consensusMeshYs.map((meshY, i) => {
          const colY = columnBodyRules[Math.min(i, columnBodyRules.length - 1)]!;
          return Math.max(meshY, colY);
        });
      }
    }
  }
  if (inkMeshInBody.length < 2) return null;

  const skewMinPx = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;
  const consensusFooterY =
    refNutrients[refNutrients.length - 1]!.top + refNutrients[refNutrients.length - 1]!.height;
  const sliceBottom = closingFooterY ?? Math.max(bodyBottom, consensusFooterY);

  const nutrients = nutrientSkewedSlicesFromOrientedInk(
    preambleEndY,
    sliceBottom,
    refNutrients.length,
    inkMeshInBody,
    probe.leftRuleYs,
    probe.rightRuleYs,
    snapTol,
    skewMinPx,
    probe.glareMask,
    pooledPitch,
    preferDownwardFan,
  );
  if (!nutrients) return null;
  const hasSkew = nutrients.some((s) => (s.topSkewPx ?? 0) !== 0 || (s.bottomSkewPx ?? 0) !== 0);
  const skewSpreads = columnSubstripInkSkewAtMesh(
    inkMeshInBody,
    probe.leftRuleYs,
    probe.rightRuleYs,
    snapTol,
  );
  const inkFans =
    skewSpreads.length >= 2 &&
    Math.abs(medianOf(skewSpreads)) >= DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;
  if (!hasSkew && !inkFans) return null;
  return nutrients.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

export function finalizeValueColumnBodySlices(
  bodyTop: number,
  preambleEndY: number,
  bodyBottom: number,
  consensusReference: SharedLabelRowBandSlice[],
  columnSlices: SharedLabelRowBandSlice[],
  colIndex: number,
  columnCount: number,
  probe: ValueColumnWarpProbe | undefined,
  meshRuleYsInBody: number[],
  meshRuleYsFull: number[],
  snapTol: number,
  pooledPitch: number,
  closingFooterY?: number,
  /** Trusted fan spread from an inner perspective column when outer ink pairing is weak. */
  anchorFanSpreadPx?: number,
  meshYToAnalysis?: (yImage: number) => number,
): SharedLabelRowBandSlice[] {
  if (
    valueColumnKeepsWarpedNutrientRows(colIndex, columnCount, probe, meshRuleYsInBody, snapTol) &&
    probe
  ) {
    const pre: SharedLabelRowBandSlice[] = [
      { rowIndex: 0, top: bodyTop, height: preambleEndY - bodyTop, topSkewPx: 0, bottomSkewPx: 0 },
    ];
    const minNutrientRowH = Math.max(8, Math.round(pooledPitch * 0.35));
    let refNutrients = consensusReference.filter((s) => s.top >= preambleEndY - 2);
    if (
      refNutrients.length > 1 &&
      refNutrients[0]!.height < minNutrientRowH &&
      refNutrients[1] !== undefined
    ) {
      const hairline = refNutrients[0]!;
      const next = refNutrients[1]!;
      refNutrients[1] = {
        ...next,
        top: hairline.top,
        height: next.top + next.height - hairline.top,
      };
      refNutrients = refNutrients.slice(1);
    }
    const warpedNutrientsRaw = columnSlices
      .filter((s) => s.top >= preambleEndY - 2)
      .map((slice, rowIndex) => ({ ...slice, rowIndex }));
    const warpedNutrientsFlat = warpedNutrientsRaw.map((slice) => flattenWarpedRowBandSlice(slice));

    const meshNutrientMinSpreadPx = Math.max(6, Math.round(pooledPitch * 0.2));
    const meshSliceSpreadPx = columnRowTopSpreadPx(refNutrients, warpedNutrientsFlat);
    const warpedHasSkew = warpedNutrientsRaw.some(
      (s) => (s.topSkewPx ?? 0) !== 0 || (s.bottomSkewPx ?? 0) !== 0,
    );

    let nutrients: SharedLabelRowBandSlice[];
    let usedSkewedInk = false;
    const perspectiveStart = Math.max(0, columnCount - 5);
    const outerFanStart = Math.max(0, columnCount - 4);
    const preferDownwardFan = colIndex >= outerFanStart && colIndex < columnCount - 1;
    const anchorInkMeshToColumnRules = colIndex >= perspectiveStart && colIndex < columnCount - 1;
    const outerSkewCapPx = outerColumnRowSurfaceSkewCapPx(pooledPitch);
    const skewMin = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;
    const tailAlignCount = preferDownwardFan
      ? DEFAULT_SHARED_LABEL_GRID_PARAMS.warpNutrientSupplementalTailAlignRowCount
      : DEFAULT_SHARED_LABEL_GRID_PARAMS.warpNutrientTailAlignRowCount;
    const tailStartRow =
      refNutrients.length >= tailAlignCount
        ? refNutrients.length - tailAlignCount
        : refNutrients.length;
    const fromSkewed = valueSkewedNutrientSlicesFromColumnInk(
      bodyTop,
      preambleEndY,
      bodyBottom,
      refNutrients,
      probe,
      meshRuleYsFull,
      snapTol,
      pooledPitch,
      preferDownwardFan,
      anchorInkMeshToColumnRules,
      closingFooterY,
    );
    const footerFanSpread =
      preferDownwardFan && closingFooterY !== undefined
        ? columnFooterFanSpreadPx(
            closingFooterY,
            preambleEndY,
            meshRuleYsInBody,
            probe.leftRuleYs,
            probe.rightRuleYs,
            snapTol,
            skewMin,
            pooledPitch,
          )
        : 0;
  const fanSpreadPx = Math.max(
    footerFanSpread,
    anchorFanSpreadPx !== undefined && anchorFanSpreadPx >= skewMin ? anchorFanSpreadPx : 0,
  );
    const skewedUsable =
      fromSkewed && (!preferDownwardFan || !mostlyUpwardSlopingFan(fromSkewed, skewMin));
    const useFooterFan =
      !preferDownwardFan &&
      closingFooterY !== undefined &&
      !skewedUsable &&
      !fromSkewed &&
      fanSpreadPx >= skewMin;
    if (skewedUsable && fromSkewed) {
      usedSkewedInk = true;
      nutrients = clampRowBandSliceSkew(fromSkewed, pooledPitch, outerSkewCapPx);
    } else if (useFooterFan) {
      nutrients = fanWarpedNutrientSkewFromFooterRule(
        refNutrients.map((slice, rowIndex) => ({
          ...slice,
          rowIndex,
          topSkewPx: 0,
          bottomSkewPx: 0,
        })),
        refNutrients,
        preambleEndY,
        closingFooterY!,
        fanSpreadPx,
        tailStartRow,
        skewMin,
      );
    } else if (fromSkewed) {
      nutrients = preferDownwardFan
        ? clampRowBandSliceSkew(fromSkewed, pooledPitch, outerSkewCapPx)
        : clampRowBandSliceSkew(fromSkewed, pooledPitch);
    } else {
      const fromInk = valueWarpedNutrientSlicesFromInkMesh(
        preambleEndY,
        bodyBottom,
        refNutrients,
        meshRuleYsFull,
        probe,
        snapTol,
        pooledPitch,
      );
      if (fromInk) {
        nutrients = fromInk;
      } else if (
        warpedNutrientRowSlicesUsable(refNutrients, warpedNutrientsFlat, pooledPitch, true) &&
        (meshSliceSpreadPx > meshNutrientMinSpreadPx || warpedHasSkew)
      ) {
        nutrients = warpedHasSkew ? warpedNutrientsRaw : warpedNutrientsFlat;
        if (preferDownwardFan && warpedHasSkew && mostlyUpwardSlopingFan(nutrients, skewMin)) {
          nutrients = mergeSmallRowBandSlices(
            valueSkewedNutrientSlicesFromColumnInk(
              bodyTop,
              preambleEndY,
              bodyBottom,
              refNutrients,
              {
                ...probe,
                leftRuleYs: probe.rightRuleYs,
                rightRuleYs: probe.leftRuleYs,
              },
              meshRuleYsFull,
              snapTol,
              pooledPitch,
              true,
              anchorInkMeshToColumnRules,
              closingFooterY,
            ) ?? nutrients,
            minNutrientRowH,
          );
        }
      } else {
      nutrients = columnRowBandSlicesOnConsensusMesh(
          refNutrients,
          preambleEndY,
          probe.leftRuleYs,
          probe.rightRuleYs,
          probe.fullRuleYs,
          rulesInBody(preambleEndY, bodyBottom, meshRuleYsFull),
          snapTol,
          pooledPitch,
          true,
        );
      }
    }

    if (preferDownwardFan && !usedSkewedInk) {
      nutrients = snapWarpedMacroRowsToColumnLeftInk(
        nutrients,
        refNutrients,
        probe.leftRuleYs,
        snapTol,
        tailStartRow,
        pooledPitch,
        probe.glareMask,
        meshYToAnalysis,
      );
    }

    const disjointed = disjointRowBandSlices(
      [...pre, ...nutrients],
      DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
    );
    const body = disjointed.filter((s) => s.top >= preambleEndY - 2);
    const warpRepairGrid = {
      ...DEFAULT_SHARED_LABEL_GRID_PARAMS,
      rowBandMergeHairlinePitchFraction: Math.max(
        DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction,
        DEFAULT_SHARED_LABEL_GRID_PARAMS.warpUndersizedNutrientRowMinPitchFraction,
      ),
    };
    const tailGrid = preferDownwardFan
      ? {
          ...DEFAULT_SHARED_LABEL_GRID_PARAMS,
          warpNutrientTailAlignRowCount:
            DEFAULT_SHARED_LABEL_GRID_PARAMS.warpNutrientSupplementalTailAlignRowCount,
        }
      : DEFAULT_SHARED_LABEL_GRID_PARAMS;
    let bodyRepaired =
      preferDownwardFan && usedSkewedInk
        ? body
        : alignWarpedNutrientTailToConsensus(body, refNutrients, pooledPitch, tailGrid);
    if (!(preferDownwardFan && usedSkewedInk)) {
      bodyRepaired = alignNutrientSpanBordersToConsensus(
        bodyRepaired,
        refNutrients,
        pooledPitch,
        closingFooterY,
        !usedSkewedInk,
      );
    }
    bodyRepaired = disjointRowBandSlices(
      bodyRepaired,
      DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
    );
    bodyRepaired = repairHairlineNutrientBands(
      bodyRepaired,
      refNutrients,
      pooledPitch,
      warpRepairGrid,
      preferDownwardFan && usedSkewedInk,
    );
    if (preferDownwardFan && !usedSkewedInk) {
      bodyRepaired = snapWarpedMacroRowsToColumnLeftInk(
        bodyRepaired,
        refNutrients,
        probe.leftRuleYs,
        snapTol,
        bodyRepaired.length,
        pooledPitch,
        probe.glareMask,
        meshYToAnalysis,
      );
    }
    if (
      preferDownwardFan &&
      !usedSkewedInk &&
      closingFooterY !== undefined &&
      fanSpreadPx >= skewMin
    ) {
      const footerSpread = Math.max(skewMin, Math.min(outerSkewCapPx, fanSpreadPx));
      bodyRepaired = fanWarpedNutrientSkewFromFooterRule(
        bodyRepaired,
        refNutrients,
        preambleEndY,
        closingFooterY,
        footerSpread,
        tailStartRow,
        skewMin,
      );
    }
    if (useFooterFan && closingFooterY !== undefined && !preferDownwardFan) {
      bodyRepaired = fanWarpedNutrientSkewFromFooterRule(
        bodyRepaired,
        refNutrients,
        preambleEndY,
        closingFooterY,
        fanSpreadPx,
        tailStartRow,
        skewMin,
      );
    } else if (!usedSkewedInk) {
      bodyRepaired = alignWarpedNutrientTopsWhereDrifted(
        bodyRepaired,
        refNutrients,
        pooledPitch,
        tailStartRow,
      );
    }
    if (preferDownwardFan && closingFooterY !== undefined) {
      bodyRepaired = alignNutrientSpanBordersToConsensus(
        bodyRepaired,
        refNutrients,
        pooledPitch,
        closingFooterY,
        false,
      );
    }
    if (preferDownwardFan) {
      bodyRepaired = clampRowBandSliceSkew(bodyRepaired, pooledPitch, outerSkewCapPx);
    }
  const preambleRaw = disjointed.filter((s) => s.top < preambleEndY - 2);
  const { above: preambleRows, below: preambleSpill } = splitRowBandSlicesCrossingY(
    preambleRaw,
    preambleEndY,
  );
  bodyRepaired = disjointRowBandSlices(
    [...bodyRepaired, ...preambleSpill],
    DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandSliceExpandOverlapPx,
  );

  const subdivideMaxH = Math.max(12, Math.round(pooledPitch * 1.42));
  const perspectiveColumn = colIndex >= Math.max(0, columnCount - 5) && colIndex < columnCount - 1;
  if (perspectiveColumn && probe.fullRuleYs.length > 0) {
    const footerBandSkipPitch = 3;
    const minContainedH = Math.max(8, Math.round(pooledPitch * 0.32));
    const nutrientRules = consolidateRowBandRuleYs(
      [
        ...rulesInBody(preambleEndY, bodyBottom, probe.fullRuleYs),
        ...rulesInBody(
          bodyTop + Math.round(pooledPitch * 0.45),
          preambleEndY + Math.round(pooledPitch * 0.2),
          meshRuleYsInBody,
        ),
      ],
      rowBandRuleMinSpacingPx(pooledPitch),
    );
    const sliceEligibleForSubdivide = (slice: SharedLabelRowBandSlice, index: number, total: number) => {
      if (slice.height <= subdivideMaxH) return false;
      const isLast = index === total - 1;
      if (isLast && slice.height > pooledPitch * footerBandSkipPitch) return false;
      return nutrientRules.some(
        (y) => y > slice.top + Math.round(pooledPitch * 0.08) && y < slice.top + slice.height - Math.round(pooledPitch * 0.08),
      );
    };
    const needsSubdivide = bodyRepaired.some((s, i, arr) => sliceEligibleForSubdivide(s, i, arr.length));
    const needsCollapse = bodyRepaired.some((s, i) => {
      if (i === 0) return false;
      const prev = bodyRepaired[i - 1]!;
      return (
        s.height < minContainedH &&
        s.top < prev.top + prev.height &&
        s.top + s.height <= prev.top + prev.height + 2
      );
    });
    if (needsSubdivide || needsCollapse) {
      if (needsSubdivide) {
        bodyRepaired = subdivideOversizedRowBandsAtRules(
          bodyRepaired,
          nutrientRules,
          pooledPitch,
          1.42,
          footerBandSkipPitch,
        );
        if (bodyRepaired.length > refNutrients.length) {
          bodyRepaired = mergeSmallRowBandSlices(
            bodyRepaired,
            Math.max(10, Math.round(pooledPitch * 0.52)),
          );
        }
      }
      if (needsCollapse) {
        bodyRepaired = collapseContainedRowBandSlices(bodyRepaired, pooledPitch);
      }
      if (bodyRepaired.length !== refNutrients.length) {
        bodyRepaired = alignWarpedNutrientTailToConsensus(bodyRepaired, refNutrients, pooledPitch, tailGrid);
        bodyRepaired = repairHairlineNutrientBands(
          bodyRepaired,
          refNutrients,
          pooledPitch,
          warpRepairGrid,
          preferDownwardFan && usedSkewedInk,
        );
      }
      if (preferDownwardFan) {
        bodyRepaired = clampRowBandSliceSkew(bodyRepaired, pooledPitch, outerSkewCapPx);
      }
    }
  }
  let preambleOut = preambleRows;
  const transitionRules = rulesInBody(bodyTop, preambleEndY, meshRuleYsInBody);
  const preambleNeedsSubdivide = preambleOut.some(
    (slice) =>
      slice.height > subdivideMaxH &&
      transitionRules.some(
        (y) =>
          y > slice.top + Math.round(pooledPitch * 0.08) &&
          y < slice.top + slice.height - Math.round(pooledPitch * 0.08),
      ),
  );
  if (preambleNeedsSubdivide) {
    preambleOut = subdivideOversizedRowBandsAtRules(
      preambleOut,
      transitionRules,
      pooledPitch,
      1.42,
      3,
    );
    preambleOut = mergeSmallRowBandSlices(
      preambleOut,
      Math.max(8, Math.round(pooledPitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction)),
    );
  }
  if (probe && meshYToAnalysis && columnHasGlareBands(probe.glareMask)) {
    bodyRepaired = nudgePerColumnRowsOnePitchDownInGlareBands(
      bodyRepaired,
      refNutrients,
      probe.glareMask,
      meshYToAnalysis,
      pooledPitch,
      preambleEndY,
    );
  }
  return [...preambleOut, ...bodyRepaired].map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }
  return snapValueNutrientRowsToConsensus(
    bodyTop,
    preambleEndY,
    consensusReference,
    columnSlices,
    pooledPitch,
  );
}

export function stripHairlineRulesInBodyPreamble(
  bodyTop: number,
  pitch: number,
  ruleYsImage: number[],
  belowBodyTopPitchFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.nutrientBodyBelowFirstRulePitchFraction,
): number[] {
  const floorY = bodyTop + Math.round(pitch * belowBodyTopPitchFraction);
  return ruleYsImage.filter((y) => y >= floorY);
}

/** Drop preamble rules that belong in the header (% Daily Value), not the nutrient body mesh. */
export function filterLabelOnlyPreambleRulesFromBodyMesh(
  bodyTop: number,
  pitch: number,
  headerNearBodyRuleYs: number[],
  ruleYsImage: number[],
  valueRulesPerColumn: number[][],
  jitterPx: number,
  preamblePitchFraction: number,
): number[] {
  if (pitch <= 0 || ruleYsImage.length === 0) return ruleYsImage;
  const preambleEnd = bodyTop + Math.round(pitch * preamblePitchFraction);
  const jitter = Math.max(2, jitterPx);
  const valueFlat = valueRulesPerColumn.flat();
  return ruleYsImage.filter((y) => {
    if (y <= bodyTop + 2 || y > preambleEnd) return true;
    if (headerNearBodyRuleYs.some((h) => Math.abs(h - y) <= jitter)) return false;
    const corroborated = valueFlat.some((v) => Math.abs(v - y) <= jitter);
    return corroborated;
  });
}

export function buildPerColumnRowBandSlicePlan(input: {
  pixels: Uint8Array;
  analysisW: number;
  analysisH: number;
  imageBandTop: number;
  imageBandHeight: number;
  bodyTopImage: number;
  bodyBottomImage: number;
  labelBoundaryAnalysisX: number;
  valueColumnSegmentsAnalysis: Array<{ x0: number; x1: number }>;
  consensusRowBandYsAnalysis: number[];
  consensusHeaderRowBandYsAnalysis?: number[];
}): PerColumnRowBandSlicePlan {
  const mapRulesToImage = (ruleYsAnalysis: number[]) =>
    mapAnalysisRuleYsToImage(ruleYsAnalysis, input.analysisH, input.imageBandTop, input.imageBandHeight);

  const bodyTop = input.bodyTopImage;
  const bodyBottom = input.bodyBottomImage;
  const bodyTopAnalysis = Math.round(
    ((bodyTop - input.imageBandTop) / Math.max(1, input.imageBandHeight)) * input.analysisH,
  );
  const sectionDividers = sectionDividerBoundaryYsFromRuns(
    consensusRuleInkRuns(
      input.pixels,
      input.analysisW,
      input.analysisH,
      input.valueColumnSegmentsAnalysis,
      4,
    ),
    bodyTopAnalysis,
    {},
    input.analysisH,
  );
  const dropSectionDividers = (ys: number[]) =>
    ys.filter((y) => !isBoundaryNearYs(y, sectionDividers, 3));

  const ruleBoundaries = (x0: number, x1: number) =>
    dropSectionDividers(
      horizontalRuleRowSliceEdgeYsInColumn(
        input.pixels,
        input.analysisW,
        input.analysisH,
        x0,
        x1,
        {},
        bodyTopAnalysis,
      ),
    );

  const labelRulesAnalysis = ruleBoundaries(0, Math.max(1, input.labelBoundaryAnalysisX));
  const valueRulesAnalysis = input.valueColumnSegmentsAnalysis.map((seg) =>
    ruleBoundaries(seg.x0, seg.x1),
  );

  const consensusRowBandYsAnalysis = dropSectionDividers(input.consensusRowBandYsAnalysis);
  const consensusRulesImage = mapRulesToImage(consensusRowBandYsAnalysis);
  const headerConsensusAnalysis =
    input.consensusHeaderRowBandYsAnalysis && input.consensusHeaderRowBandYsAnalysis.length > 0
      ? input.consensusHeaderRowBandYsAnalysis
      : input.consensusRowBandYsAnalysis.filter(
          (y) => mapAnalysisYToImageBand(y, input.analysisH, input.imageBandTop, input.imageBandHeight) < bodyTop - 2,
        );
  const headerConsensusRulesImage = mapRulesToImage(headerConsensusAnalysis);
  const labelRulesImage = mapRulesToImage(labelRulesAnalysis);
  let valueRulesImage = valueRulesAnalysis.map((rules) => mapRulesToImage(rules));

  const pooledPitch = poolRowPitchFromRuleSets(
    [consensusRulesImage, labelRulesImage, ...valueRulesImage],
    bodyTop,
    bodyBottom,
  );

  const ruleDedupeGap = rowBandRuleMinSpacingPx(pooledPitch);
  valueRulesImage = valueRulesImage.map((rules) =>
    consolidateRowBandRuleYs(rulesInBody(bodyTop, bodyBottom, rules), ruleDedupeGap),
  );
  labelRulesImage.sort((a, b) => a - b);
  const labelRulesBodyConsolidated = consolidateRowBandRuleYs(
    rulesInBody(bodyTop, bodyBottom, labelRulesImage),
    ruleDedupeGap,
  );

  const labelBodyRulesImage = labelRulesBodyConsolidated;
  const shared = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const headerTop = input.imageBandTop;
  const headerBottom = input.bodyTopImage;
  const headerConsensusRulesImageInSpanEarly = headerConsensusRulesImage.filter(
    (y) => y > headerTop && y < headerBottom,
  );
  const headerLabelRulesImageEarly = labelRulesImage.filter((y) => y > headerTop && y < headerBottom);
  const headerLabelRowBandSlicesEarly = rowBandSlicesForHeaderSpan(
    headerTop,
    headerBottom,
    headerLabelRulesImageEarly,
    headerConsensusRulesImageInSpanEarly,
    pooledPitch,
  );
  const dailyValueHeaderRuleYs =
    headerLabelRowBandSlicesEarly.length >= 2
      ? [headerLabelRowBandSlicesEarly[headerLabelRowBandSlicesEarly.length - 1]!.top]
      : headerConsensusRulesImageInSpanEarly.filter(
          (y) => headerBottom - y <= Math.max(12, Math.round((headerBottom - headerTop) * shared.headerKeepRuleNearBodySpanFraction)),
        );
  const labelGapFillJitter = Math.max(3, Math.round(pooledPitch * 0.28));
  const preamblePitch =
    shared.nutrientBodyBelowFirstRulePitchFraction * shared.rowBandMaxMedianSlicePitchRatio;
  let consensusBodyRulesImage = filterLabelOnlyPreambleRulesFromBodyMesh(
    bodyTop,
    pooledPitch,
    dailyValueHeaderRuleYs,
    rulesInBody(bodyTop, bodyBottom, consensusRulesImage),
    valueRulesImage,
    labelGapFillJitter,
    preamblePitch,
  );
  consensusBodyRulesImage = stripHairlineRulesInBodyPreamble(bodyTop, pooledPitch, consensusBodyRulesImage);
  consensusBodyRulesImage = consolidateRowBandRuleYs(
    consensusBodyRulesImage,
    rowBandRuleMinSpacingPx(pooledPitch),
  );
  valueRulesImage = valueRulesImage.map((rules) =>
    consolidateRowBandRuleYs(
      stripHairlineRulesInBodyPreamble(bodyTop, pooledPitch, rulesInBody(bodyTop, bodyBottom, rules)),
      ruleDedupeGap,
    ),
  );
  const labelOnlyRules = labelOnlyRulesForConsensusMesh(
    consensusBodyRulesImage,
    labelBodyRulesImage,
    pooledPitch,
    labelGapFillJitter,
    shared.labelRailMeshGapFillMinSpanPitchFraction,
  );
  const corroboratedPreambleLabel = labelOnlyRulesForValueMesh(
    labelBodyRulesImage,
    valueRulesImage.map((rules) => rulesInBody(bodyTop, bodyBottom, rules)),
    bodyTop,
    pooledPitch,
    labelGapFillJitter,
    preamblePitch,
  ).filter((y) => y > bodyTop + Math.round(pooledPitch * 0.45));
  const meshReferenceRulesImage = consolidateRowBandRuleYs(
    [...consensusBodyRulesImage, ...labelOnlyRules, ...corroboratedPreambleLabel],
    rowBandRuleMinSpacingPx(pooledPitch),
  );

  const inferRules = (detectedImage: number[]) =>
    inferColumnBodyRuleYsSurface({
      bodyTop,
      bodyBottom,
      detectedRuleYsImage: detectedImage,
      pooledPitch,
      referenceRuleYsImage: meshReferenceRulesImage,
    });

  const boundaryOpts = { rulesAreInkBoundaries: true as const };
  let consensusRowBandSlices = rowBandSlicesFromColumnRules(
    bodyTop,
    bodyBottom,
    inferRules(consensusRulesImage),
    4,
    boundaryOpts,
  );
  let labelRowBandSlices = rowBandSlicesFromColumnRules(
    bodyTop,
    bodyBottom,
    labelRulesBodyConsolidated,
    4,
    boundaryOpts,
  );
  let valueRowBandSlicesPerColumn = valueRulesImage.map((detected) =>
    rowBandSlicesFromColumnRules(bodyTop, bodyBottom, inferRules(detected), 4, boundaryOpts),
  );
  const preambleNutrientRuleYEarly = firstSubstantiveNutrientRuleYOnValueColumns(
    bodyTop,
    bodyBottom,
    pooledPitch,
    valueRulesImage,
  );
  const splitDoubleRowBands = (slices: SharedLabelRowBandSlice[]) =>
    splitDoubleHeightRowBandSlicesPreservingPreamble(
      slices,
      pooledPitch,
      bodyTop,
      preambleNutrientRuleYEarly,
    );
  consensusRowBandSlices = splitDoubleRowBands(consensusRowBandSlices);
  valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map(splitDoubleRowBands);
  consensusRowBandSlices = collapseBodyPreambleToSingleBand(
    bodyTop,
    preambleNutrientRuleYEarly,
    consensusRowBandSlices,
  );
  valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((slices) =>
    collapseBodyPreambleToSingleBand(bodyTop, preambleNutrientRuleYEarly, slices),
  );

  const headerConsensusRulesImageInSpan = headerConsensusRulesImageInSpanEarly;
  const headerLabelRulesImage = headerLabelRulesImageEarly;
  const headerValueRulesImage = valueRulesImage.map((rules) =>
    rules.filter((y) => y > headerTop && y < headerBottom),
  );

  let headerConsensusRowBandSlices = rowBandSlicesForHeaderSpan(
    headerTop,
    headerBottom,
    headerConsensusRulesImageInSpan,
    headerConsensusRulesImageInSpan,
    pooledPitch,
  );
  let headerLabelRowBandSlices = headerLabelRowBandSlicesEarly;
  let headerRowBandSlicesPerColumn = headerValueRulesImage.map((detected) =>
    rowBandSlicesForHeaderSpan(headerTop, headerBottom, detected, headerConsensusRulesImageInSpan, pooledPitch),
  );
  const headerSynced = syncValueHeaderBandsToLabelHeader(
    headerLabelRowBandSlices,
    headerConsensusRowBandSlices,
    headerRowBandSlicesPerColumn,
    headerTop,
    headerBottom,
  );
  headerConsensusRowBandSlices = headerSynced.headerConsensusRowBandSlices;
  headerRowBandSlicesPerColumn = headerSynced.headerRowBandSlicesPerColumn;

  const valueRowBandSlicesRaw = valueRowBandSlicesPerColumn.map((col) => col.map((s) => ({ ...s })));
  const bodyAlign = alignRowSurfacesToReference(consensusRowBandSlices, valueRowBandSlicesPerColumn, pooledPitch);
  valueRowBandSlicesPerColumn = bodyAlign.columns;
  let rowSurfaceMode = bodyAlign.mode;

  const straightThreshold = Math.max(
    6,
    Math.round(pooledPitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceStraightSpreadPitchFraction),
  );
  const snapTol = Math.max(4, Math.round(pooledPitch * 0.38));
  const bodyBottomAnalysis = Math.round(
    ((bodyBottom - input.imageBandTop) / Math.max(1, input.imageBandHeight)) * input.analysisH,
  );
  const glareGrid = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const meshYToAnalysis = (yImage: number) =>
    Math.round(((yImage - input.imageBandTop) / Math.max(1, input.imageBandHeight)) * input.analysisH);
  const glareMaskParams = {
    maxGlareMassFraction: glareGrid.rowSurfaceWarpMaxGlareMassFraction,
    maxBrightPixelFraction: glareGrid.rowSurfaceWarpMaxGlareBrightPixelFraction,
    maxBandBrightPixelFraction: glareGrid.rowSurfaceWarpMaxGlareBandBrightPixelFraction,
    bandCount: glareGrid.rowSurfaceGlareBodyBandCount,
    glareCapMaxForMassRule: 248,
  };
  const meshInBodyForWarp = rulesInBody(bodyTop, bodyBottom, meshReferenceRulesImage);
  const valueColumnGlareMasks: ColumnBodyGlareMask[] = [];
  let neighborPrefersDownwardFan = false;
  const valueColumnWarpProbes: ValueColumnWarpProbe[] = valueRowBandSlicesRaw.map(
    (slices, colIndex) => {
      const seg = input.valueColumnSegmentsAnalysis[colIndex];
      const glareMask =
        seg !== undefined
          ? columnBodyGlareMask(
              input.pixels,
              input.analysisW,
              input.analysisH,
              seg.x0,
              seg.x1,
              bodyTopAnalysis,
              bodyBottomAnalysis,
              glareMaskParams,
            )
          : emptyColumnBodyGlareMask(bodyTopAnalysis, bodyBottomAnalysis, glareGrid.rowSurfaceGlareBodyBandCount);
      valueColumnGlareMasks.push(glareMask);

      let warp =
        seg !== undefined &&
        columnRowTopSpreadPx(consensusRowBandSlices, slices) > straightThreshold;
      const fullRules = rulesInBody(bodyTop, bodyBottom, valueRulesImage[colIndex] ?? []);
      if (!seg) {
        return {
          warp: false,
          glareMask,
          leftRuleYs: meshReferenceRulesImage,
          rightRuleYs: meshReferenceRulesImage,
          fullRuleYs: fullRules,
        };
      }
      const subs = horizontalRuleRowSliceEdgeYsInColumnSubstrips(
        input.pixels,
        input.analysisW,
        input.analysisH,
        seg.x0,
        seg.x1,
        {},
        bodyTopAnalysis,
      );
      const leftRulesRaw = rulesInBody(bodyTop, bodyBottom, mapRulesToImage(subs.left));
      const rightRulesRaw = rulesInBody(bodyTop, bodyBottom, mapRulesToImage(subs.right));
      const skewMinPx = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx;
      const oriented = orientColumnSubstripRuleYs(
        meshInBodyForWarp,
        leftRulesRaw,
        rightRulesRaw,
        snapTol,
        skewMinPx,
        colIndex >= 5 ? neighborPrefersDownwardFan || undefined : undefined,
      );
      const leftRules = oriented.left;
      const rightRules = oriented.right;
      const substripSkews = columnSubstripInkSkewAtMesh(meshInBodyForWarp, leftRules, rightRules, snapTol);
      if (substripSkews.length >= 2 && medianOf(substripSkews) > skewMinPx) {
        neighborPrefersDownwardFan = true;
      }
      const skewMed =
        substripSkews.length >= 2
          ? medianOf(substripSkews)
          : medianOf(columnInkSkewDeltasAlongMesh(meshInBodyForWarp, leftRules, rightRules, snapTol));
      if (Math.abs(skewMed) >= skewMinPx) warp = true;
      else if (warp && substripSkews.length === 0 && Math.abs(skewMed) < skewMinPx) warp = false;
      if (!warp && columnHasGlareBands(glareMask)) {
        const driftSamples = columnWarpOffsetSamples(
          leftRules,
          rightRules,
          fullRules,
          meshReferenceRulesImage,
          bodyTop,
          snapTol,
          pooledPitch,
          DEFAULT_SHARED_LABEL_GRID_PARAMS,
          { skipSubstripSpreadGate: true },
        );
        if (
          driftSamples &&
          driftSamples.full.length >= DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceWarpMinMatchedRules
        ) {
          warp = true;
        }
      }
      return {
        warp,
        glareMask,
        leftRuleYs: leftRules,
        rightRuleYs: rightRules,
        fullRuleYs: fullRules,
      };
    },
  );
  let meshForWarp = meshReferenceRulesImage;
  let gutterRuleYs = computeValueColumnGutterRuleYs(
    bodyTop,
    bodyBottom,
    valueColumnWarpProbes,
    meshForWarp,
    snapTol,
    pooledPitch,
    meshYToAnalysis,
  );
  if (gutterRuleYs) {
    const meshInBody = rulesInBody(bodyTop, bodyBottom, meshForWarp);
    const minBetweenRules = rowBandRuleMinSpacingPx(pooledPitch);
    const gutterMesh = gutterConsensusMeshRuleYsFromGutters(
      bodyTop,
      bodyBottom,
      meshInBody,
      gutterRuleYs,
      minBetweenRules,
    );
    if (gutterMesh.length > 0 && gutterMesh.length < meshInBody.length) {
      const outsideBody = meshReferenceRulesImage.filter(
        (y) => y <= bodyTop + 2 || y >= bodyBottom - 2,
      );
      meshForWarp = consolidateRowBandRuleYs([...outsideBody, ...gutterMesh], minBetweenRules);
      consensusRowBandSlices = rowBandSlicesFromColumnRules(
        bodyTop,
        bodyBottom,
        gutterMesh,
        4,
        boundaryOpts,
      );
      const realign = alignRowSurfacesToReference(
        consensusRowBandSlices,
        valueRowBandSlicesPerColumn,
        pooledPitch,
      );
      valueRowBandSlicesPerColumn = realign.columns;
      rowSurfaceMode = realign.mode;
      gutterRuleYs =
        computeValueColumnGutterRuleYs(
          bodyTop,
          bodyBottom,
          valueColumnWarpProbes,
          meshForWarp,
          snapTol,
          pooledPitch,
          meshYToAnalysis,
        ) ?? gutterRuleYs;
    }
  }

  const minBetweenRules = rowBandRuleMinSpacingPx(pooledPitch);
  const rowSurfaceMeshRuleYs = rowSurfaceMeshRuleYsForWarp(
    consensusRowBandSlices,
    meshReferenceRulesImage,
    bodyTop,
    bodyBottom,
    minBetweenRules,
  );
  const inkMeshBodyYs = consensusRowSurfaceMeshRuleYs(
    consensusRowBandSlices,
    bodyTop,
    bodyBottom,
  );
  const gutterForConnected =
    computeValueColumnGutterRuleYs(
      bodyTop,
      bodyBottom,
      valueColumnWarpProbes,
      rowSurfaceMeshRuleYs,
      snapTol,
      pooledPitch,
      meshYToAnalysis,
    ) ?? gutterRuleYs;
  valueRowBandSlicesPerColumn = connectedValueRowBandSlicesOnConsensusMesh(
    consensusRowBandSlices,
    bodyTop,
    bodyBottom,
    valueColumnWarpProbes,
    rowSurfaceMeshRuleYs,
    snapTol,
    pooledPitch,
    meshYToAnalysis,
    DEFAULT_SHARED_LABEL_GRID_PARAMS,
    gutterForConnected ?? undefined,
    [...meshReferenceRulesImage.filter((y) => y <= bodyTop + 2 || y >= bodyBottom - 2), ...inkMeshBodyYs],
  );
  if (preambleNutrientRuleYEarly !== undefined) {
    consensusRowBandSlices = collapseBodyPreambleToSingleBand(
      bodyTop,
      preambleNutrientRuleYEarly,
      consensusRowBandSlices,
    );
    valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((colSlices) =>
      collapseBodyPreambleToSingleBand(bodyTop, preambleNutrientRuleYEarly, colSlices),
    );
  }

  const labelFull = rulesInBody(bodyTop, bodyBottom, labelRulesImage);
  const labelSubs = horizontalRuleRowSliceEdgeYsInColumnSubstrips(
    input.pixels,
    input.analysisW,
    input.analysisH,
    0,
    Math.max(1, input.labelBoundaryAnalysisX),
    {},
    bodyTopAnalysis,
  );
  labelRowBandSlices = columnRowBandSlicesOnConsensusMesh(
    consensusRowBandSlices,
    bodyTop,
    rulesInBody(bodyTop, bodyBottom, mapRulesToImage(labelSubs.left)),
    rulesInBody(bodyTop, bodyBottom, mapRulesToImage(labelSubs.right)),
    labelFull,
    meshReferenceRulesImage,
    snapTol,
    pooledPitch,
    false,
  );

  const headerAlign = alignRowSurfacesToReference(
    headerConsensusRowBandSlices,
    headerRowBandSlicesPerColumn,
    pooledPitch,
  );
  headerRowBandSlicesPerColumn = headerAlign.columns;
  const headerLabelAlign = alignRowSurfacesToReference(
    headerConsensusRowBandSlices,
    [headerLabelRowBandSlices],
    pooledPitch,
  );
  if (headerLabelAlign.mode === 'shared') {
    headerLabelRowBandSlices = headerLabelAlign.columns[0]!;
  }

  const firstNutrientRuleY = firstSubstantiveNutrientRuleYOnValueColumns(
    bodyTop,
    bodyBottom,
    pooledPitch,
    valueRulesImage,
  );
  const hairlineBodyMergePx = Math.max(
    8,
    Math.round(pooledPitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction),
  );
  if (
    firstNutrientRuleY !== undefined &&
    bodyPreambleSuggestsCaloriesThenDailyValue(bodyTop, firstNutrientRuleY, pooledPitch)
  ) {
    const labelDvTop = dailyValueRowSliceTopYForLabelColumn(
      bodyTop,
      firstNutrientRuleY,
      pooledPitch,
      labelRulesBodyConsolidated,
    );
    if (labelDvTop !== undefined) {
      const labelSplit = splitDailyValueTransitionFromBody(
        bodyTop,
        firstNutrientRuleY,
        pooledPitch,
        headerLabelRowBandSlices,
        labelRowBandSlices,
        labelDvTop,
      );
      labelRowBandSlices = mergeSmallRowBandSlices(labelSplit.bodySlices, hairlineBodyMergePx);
    }
    const valueDvTop = dailyValueRowSliceTopYForValueColumns(
      bodyTop,
      firstNutrientRuleY,
      pooledPitch,
      valueRulesImage,
    );
    if (valueDvTop !== undefined) {
      const consensusSplit = splitDailyValueTransitionFromBody(
        bodyTop,
        firstNutrientRuleY,
        pooledPitch,
        [],
        consensusRowBandSlices,
        valueDvTop,
      );
      consensusRowBandSlices = mergeSmallRowBandSlices(consensusSplit.bodySlices, hairlineBodyMergePx);
      valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((colSlices, colIndex) => {
        const colDvTop =
          dailyValueRowSliceTopYForValueColumns(
            bodyTop,
            firstNutrientRuleY,
            pooledPitch,
            [valueRulesImage[colIndex] ?? []],
          ) ?? valueDvTop;
        const colSplit = splitDailyValueTransitionFromBody(
          bodyTop,
          firstNutrientRuleY,
          pooledPitch,
          [],
          colSlices,
          colDvTop,
        );
        return mergeSmallRowBandSlices(colSplit.bodySlices, hairlineBodyMergePx);
      });
    }
  }

  const preambleEnd = firstNutrientRuleY;
  if (preambleEnd !== undefined) {
    consensusRowBandSlices = repairBodyBandsAfterPreamble(
      bodyTop,
      preambleEnd,
      consensusRowBandSlices,
      pooledPitch,
    );
    const meshInBodyFinalize = rulesInBody(bodyTop, bodyBottom, meshReferenceRulesImage);
    const inkMeshBodyYsFinalize = consensusRowSurfaceMeshRuleYs(
      consensusRowBandSlices,
      bodyTop,
      bodyBottom,
    );
    const inkMeshRuleYsForWarp = [
      ...meshReferenceRulesImage.filter((y) => y <= bodyTop + 2 || y >= bodyBottom - 2),
      ...inkMeshBodyYsFinalize,
    ];
    const refNutrientsForFooter = consensusRowBandSlices.filter((s) => s.top >= preambleEnd - 2);
    const imageBandBottom = input.imageBandTop + input.imageBandHeight;
    const closingFooterY = nutrientTableClosingFooterY(
      bodyTop,
      bodyBottom,
      imageBandBottom,
      pooledPitch,
      meshReferenceRulesImage,
      refNutrientsForFooter,
    );
    const columnCount = valueRowBandSlicesPerColumn.length;
    const anchorCol = Math.max(0, columnCount - 4);
    const anchorProbe = valueColumnWarpProbes[anchorCol];
    const anchorFanSpreadPx =
      anchorProbe !== undefined
        ? columnFooterFanSpreadPx(
            closingFooterY,
            preambleEnd,
            meshInBodyFinalize,
            anchorProbe.leftRuleYs,
            anchorProbe.rightRuleYs,
            snapTol,
            DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceSkewMinPx,
            pooledPitch,
          )
        : undefined;
    valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((colSlices, colIndex) =>
      finalizeValueColumnBodySlices(
        bodyTop,
        preambleEnd,
        bodyBottom,
        consensusRowBandSlices,
        colSlices,
        colIndex,
        columnCount,
        valueColumnWarpProbes[colIndex],
        meshInBodyFinalize,
        inkMeshRuleYsForWarp,
        snapTol,
        pooledPitch,
        closingFooterY,
        anchorFanSpreadPx,
        meshYToAnalysis,
      ),
    );
    consensusRowBandSlices = extendLastBodySliceToFooterY(
      consensusRowBandSlices,
      closingFooterY,
      preambleEnd,
    );
    labelRowBandSlices = extendLastBodySliceToFooterY(labelRowBandSlices, closingFooterY, preambleEnd);
    valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((colSlices) =>
      extendLastBodySliceToFooterY(colSlices, closingFooterY, preambleEnd),
    );
  }

  // Count reconciliation: per-column split/merge transforms above can drop or
  // add bands when one column's local rule detection misses a row line (glare,
  // pack curve). Rebuild any mismatched column on the consensus mesh — warped
  // through that column's own rule probes when available — so every column
  // emits the canonical row count and row stitching stays aligned.
  let rowBandReconciledColumns = 0;
  const referenceRowCount = consensusRowBandSlices.length;
  if (referenceRowCount > 0) {
    valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((colSlices, colIndex) => {
      if (colSlices.length === referenceRowCount) return colSlices;
      const probe = valueColumnWarpProbes[colIndex];
      rowBandReconciledColumns += 1;
      return columnRowBandSlicesOnConsensusMesh(
        consensusRowBandSlices,
        bodyTop,
        probe?.leftRuleYs ?? [],
        probe?.rightRuleYs ?? [],
        probe?.fullRuleYs ?? [],
        meshReferenceRulesImage,
        snapTol,
        pooledPitch,
        Boolean(probe?.warp),
      );
    });
    // Final geometry pass: every column's slices must sit on its own detected
    // row rules, not just the consensus count. Columns whose local detection
    // was glare-eroded keep consensus positions (too few rule matches to fit).
    valueRowBandSlicesPerColumn = valueRowBandSlicesPerColumn.map((colSlices, colIndex) => {
      const rules = valueColumnWarpProbes[colIndex]?.fullRuleYs ?? [];
      const fitted = fitColumnSlicesToLocalRules(colSlices, rules, snapTol, pooledPitch);
      if (process.env.NT_DEBUG_ROW_FIT === '1') {
        console.error(
          `[row-fit] col${colIndex} rules=${rules.length} ` +
            `before=${colSlices.slice(0, 4).map((s) => s.top).join('/')}` +
            ` after=${fitted.slice(0, 4).map((s) => s.top).join('/')}`,
        );
      }
      return fitted;
    });
    if (labelRowBandSlices.length !== referenceRowCount) {
      labelRowBandSlices = columnRowBandSlicesOnConsensusMesh(
        consensusRowBandSlices,
        bodyTop,
        rulesInBody(bodyTop, bodyBottom, mapRulesToImage(labelSubs.left)),
        rulesInBody(bodyTop, bodyBottom, mapRulesToImage(labelSubs.right)),
        labelFull,
        meshReferenceRulesImage,
        snapTol,
        pooledPitch,
        false,
      );
      rowBandReconciledColumns += 1;
    }
  }

  return {
    rowSurfaceMode,
    consensusRowBandSlices,
    labelRowBandSlices,
    valueRowBandSlicesPerColumn,
    headerConsensusRowBandSlices,
    headerLabelRowBandSlices,
    headerRowBandSlicesPerColumn,
    valueColumnGlareMasks,
    valueColumnWarpProbes,
    rowBandReconciledColumns,
  };
}

export function rowRegionDriftSummary(
  consensusSlices: SharedLabelRowBandSlice[],
  perColumn: RowRegionBox[],
  columnIndex: number,
): Array<{ rowIndex: number; topDeltaPx: number | null; heightDeltaPx: number | null }> {
  const colBoxes = perColumn.filter((b) => b.columnIndex === columnIndex && b.source === 'per_column');
  return consensusSlices.map((slice) => {
    const match = colBoxes.find((b) => b.rowIndex === slice.rowIndex);
    if (!match) return { rowIndex: slice.rowIndex, topDeltaPx: null, heightDeltaPx: null };
    return {
      rowIndex: slice.rowIndex,
      topDeltaPx: match.top - slice.top,
      heightDeltaPx: match.height - slice.height,
    };
  });
}