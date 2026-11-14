import type { SharedLabelGridParams } from './sharedLabelGridParams.js';

/** Map analysis-band y to full-image y inside the OCR crop band. */
export function mapAnalysisYToOcrBand(
  analysisY: number,
  analysisH: number,
  ocrBandTop: number,
  ocrBandHeight: number,
): number {
  return ocrBandTop + Math.round((analysisY / Math.max(1, analysisH)) * ocrBandHeight);
}

export type SharedLabelRowBandSlice = {
  rowIndex: number;
  top: number;
  height: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function medianConsecutiveSpacing(ys: number[]): number {
  if (ys.length < 2) return 0;
  const spacings: number[] = [];
  for (let i = 1; i < ys.length; i += 1) {
    const d = ys[i]! - ys[i - 1]!;
    if (d > 0) spacings.push(d);
  }
  return median(spacings);
}

/** Drop rules that sit closer than one nutrient row pitch (double horizontal lines, jitter duplicates). */
export function consolidateRowBandRuleYs(ruleYs: number[], minSpacing: number): number[] {
  if (ruleYs.length <= 1 || minSpacing <= 0) return [...ruleYs].sort((a, b) => a - b);
  const sorted = [...ruleYs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const y of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || y - last >= minSpacing) out.push(y);
  }
  return out;
}

/** Horizontal slices between consensus rule lines (nutrient row bodies, not footer). */
export function rowBandSlicesBetweenRules(
  bodyTop: number,
  bodyBottom: number,
  ruleYsImage: number[],
  minSliceHeight = 8,
): SharedLabelRowBandSlice[] {
  const rules = [...ruleYsImage].sort((a, b) => a - b).filter((y) => y > bodyTop + 2 && y < bodyBottom - 2);
  const edges = [bodyTop, ...rules, bodyBottom];
  const slices: SharedLabelRowBandSlice[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const top = edges[i]!;
    const height = edges[i + 1]! - top;
    if (height >= minSliceHeight) slices.push({ rowIndex: i, top, height });
  }
  return slices;
}

/** Merge only hairline slivers (shorter than minHeight) into an adjacent row band. */
export function mergeSmallRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  minHeight: number,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || minHeight <= 0) return slices;

  const merged: SharedLabelRowBandSlice[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    let slice = { ...slices[i]! };
    if (slice.height >= minHeight) {
      merged.push(slice);
      continue;
    }
    if (merged.length > 0) {
      const last = merged[merged.length - 1]!;
      merged[merged.length - 1] = {
        rowIndex: last.rowIndex,
        top: last.top,
        height: last.height + slice.height,
      };
      continue;
    }
    if (i + 1 < slices.length) {
      const next = slices[i + 1]!;
      slice = {
        rowIndex: slice.rowIndex,
        top: slice.top,
        height: slice.height + next.height,
      };
      i += 1;
    }
    merged.push(slice);
  }

  return merged.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Equal ~pitch chunks when a band spans multiple nutrient rows but has no interior rule Y. */
function subdivideOversizedSliceByPitch(
  slice: SharedLabelRowBandSlice,
  pitch: number,
  maxSlicePitchRatio: number,
): SharedLabelRowBandSlice[] {
  const maxH = pitch * maxSlicePitchRatio;
  if (slice.height <= maxH + 0.5) return [slice];
  const targetRows = Math.max(2, Math.ceil(slice.height / Math.max(8, pitch)));
  const parts: SharedLabelRowBandSlice[] = [];
  let top = slice.top;
  let remaining = slice.height;
  for (let i = 0; i < targetRows && remaining > 0; i += 1) {
    const rowsLeft = targetRows - i;
    const h =
      rowsLeft === 1
        ? remaining
        : Math.min(remaining, Math.max(Math.round(pitch), Math.round(remaining / rowsLeft)));
    parts.push({ rowIndex: 0, top, height: h });
    top += h;
    remaining -= h;
  }
  return parts;
}

/**
 * Subdivide bands taller than one nutrient row using interior consensus rules
 * (e.g. preamble + first row merged into one slice).
 */
export function splitOversizedRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  ruleYs: number[],
  pitch: number,
  maxSlicePitchRatio: number,
  minGapBetweenSubSlices: number,
  pitchSubdivideMinMultiplier = 2.35,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || pitch <= 0 || maxSlicePitchRatio <= 0) return slices;
  const maxHeight = pitch * maxSlicePitchRatio;
  const sortedRules = [...ruleYs].sort((a, b) => a - b);
  const minSub = Math.max(4, minGapBetweenSubSlices);

  const out: SharedLabelRowBandSlice[] = [];
  for (const slice of slices) {
    if (slice.height <= maxHeight + 0.5) {
      out.push(slice);
      continue;
    }
    const bottom = slice.top + slice.height;
    const innerRules = sortedRules.filter(
      (y) => y > slice.top + minSub && y < bottom - minSub,
    );
    if (innerRules.length === 0) {
      if (slice.height > pitch * pitchSubdivideMinMultiplier) {
        out.push(...subdivideOversizedSliceByPitch(slice, pitch, maxSlicePitchRatio));
      } else {
        out.push(slice);
      }
      continue;
    }
    const subs = rowBandSlicesBetweenRules(slice.top, bottom, innerRules, Math.max(4, Math.round(minSub * 0.5)));
    if (subs.length <= 1) {
      out.push(slice);
      continue;
    }
    out.push(...subs);
  }
  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

export function medianRowBandSliceHeight(slices: SharedLabelRowBandSlice[]): number {
  if (slices.length === 0) return 0;
  return median(slices.map((s) => s.height));
}

export function prepareRowBandSlicesForOcr(
  bodyTop: number,
  bodyBottom: number,
  ruleYsImage: number[],
  grid: Pick<
    SharedLabelGridParams,
    | 'rowBandRuleMinSpacingPitchFraction'
    | 'minRowBandSliceHeightPx'
    | 'minRowBandSliceHeightPitchFraction'
    | 'rowBandMergeHairlinePitchFraction'
    | 'rowBandSplitOversizedPitchRatio'
    | 'rowBandPitchSubdivideMinMultiplier'
  >,
): { slices: SharedLabelRowBandSlice[]; rowPitchPx: number } {
  const sortedRules = [...ruleYsImage].sort((a, b) => a - b);
  const coarsePitch = medianConsecutiveSpacing(sortedRules);
  const ruleMinGap =
    coarsePitch > 0
      ? Math.max(2, Math.round(coarsePitch * grid.rowBandRuleMinSpacingPitchFraction))
      : grid.minRowBandSliceHeightPx;
  const consolidated = consolidateRowBandRuleYs(sortedRules, ruleMinGap);
  const rulesInBody = consolidated.filter((y) => y > bodyTop + 2 && y < bodyBottom - 2);
  const pitch = medianConsecutiveSpacing(rulesInBody.length >= 2 ? rulesInBody : consolidated);
  const minBetweenRules = Math.max(
    4,
    pitch > 0 ? Math.round(pitch * grid.minRowBandSliceHeightPitchFraction * 0.35) : 4,
  );
  const slices = rowBandSlicesBetweenRules(bodyTop, bodyBottom, consolidated, minBetweenRules);
  const mergeHairlineBelow =
    pitch > 0
      ? Math.max(grid.minRowBandSliceHeightPx, Math.round(pitch * grid.rowBandMergeHairlinePitchFraction))
      : grid.minRowBandSliceHeightPx;
  const merged = mergeSmallRowBandSlices(slices, mergeHairlineBelow);
  const splitRules = rulesInBody.length > 0 ? consolidated : sortedRules;
  const split = splitOversizedRowBandSlices(
    merged,
    splitRules,
    pitch,
    grid.rowBandSplitOversizedPitchRatio,
    mergeHairlineBelow,
    grid.rowBandPitchSubdivideMinMultiplier,
  );
  const finalSlices = mergeSmallRowBandSlices(split, mergeHairlineBelow);
  return { slices: finalSlices, rowPitchPx: pitch };
}

export function nutrientBodyExtents(
  analysisH: number,
  bodyTopAnalysisY: number,
  rowBandYsAnalysis: number[],
  ocrBandTop: number,
  ocrBandHeight: number,
  grid: Pick<
    SharedLabelGridParams,
    | 'bodyFooterMarginFraction'
    | 'rowBandRuleMinSpacingPitchFraction'
    | 'minRowBandSliceHeightPx'
    | 'minRowBandSliceHeightPitchFraction'
    | 'rowBandMergeHairlinePitchFraction'
    | 'rowBandSplitOversizedPitchRatio'
    | 'rowBandPitchSubdivideMinMultiplier'
  >,
): { top: number; height: number; rowBandSlices: SharedLabelRowBandSlice[]; rowPitchPx: number } {
  const mapY = (y: number) => mapAnalysisYToOcrBand(y, analysisH, ocrBandTop, ocrBandHeight);
  const bodyTop = mapY(bodyTopAnalysisY);
  const ruleYsImage = rowBandYsAnalysis.map(mapY);

  let bodyBottom = ocrBandTop + ocrBandHeight - Math.round(ocrBandHeight * grid.bodyFooterMarginFraction);
  if (ruleYsImage.length >= 2) {
    const pitch = medianConsecutiveSpacing(ruleYsImage);
    if (pitch > 0) {
      bodyBottom = Math.min(ocrBandTop + ocrBandHeight, ruleYsImage[ruleYsImage.length - 1]! + pitch);
    }
  }

  const height = Math.max(8, bodyBottom - bodyTop);
  const bodyBottomY = bodyTop + height;
  const rowBands = prepareRowBandSlicesForOcr(bodyTop, bodyBottomY, ruleYsImage, grid);
  return {
    top: bodyTop,
    height,
    rowBandSlices: rowBands.slices,
    rowPitchPx: rowBands.rowPitchPx > 0 ? rowBands.rowPitchPx : medianRowBandSliceHeight(rowBands.slices),
  };
}
