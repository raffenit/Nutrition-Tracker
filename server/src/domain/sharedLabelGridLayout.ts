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

/** Merge consecutive slices until each band is tall enough for OCR. */
export function mergeSmallRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  minHeight: number,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || minHeight <= 0) return slices;

  const merged: SharedLabelRowBandSlice[] = [];
  let pending: SharedLabelRowBandSlice | null = null;

  const flush = () => {
    if (!pending) return;
    if (merged.length > 0 && pending.height < minHeight) {
      const last = merged[merged.length - 1]!;
      merged[merged.length - 1] = {
        rowIndex: last.rowIndex,
        top: last.top,
        height: last.height + pending.height,
      };
    } else {
      merged.push(pending);
    }
    pending = null;
  };

  for (const slice of slices) {
    if (!pending) {
      pending = { ...slice };
      continue;
    }
    pending = {
      rowIndex: pending.rowIndex,
      top: pending.top,
      height: pending.height + slice.height,
    };
    if (pending.height >= minHeight) flush();
  }
  flush();

  return merged.map((slice, rowIndex) => ({ ...slice, rowIndex }));
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
  >,
): { slices: SharedLabelRowBandSlice[]; rowPitchPx: number } {
  const sortedRules = [...ruleYsImage].sort((a, b) => a - b);
  const pitch = medianConsecutiveSpacing(sortedRules);
  const ruleMinGap =
    pitch > 0
      ? Math.max(2, Math.round(pitch * grid.rowBandRuleMinSpacingPitchFraction))
      : grid.minRowBandSliceHeightPx;
  const consolidated = consolidateRowBandRuleYs(sortedRules, ruleMinGap);
  const minBetweenRules = Math.max(
    4,
    pitch > 0 ? Math.round(pitch * grid.minRowBandSliceHeightPitchFraction * 0.35) : 4,
  );
  const slices = rowBandSlicesBetweenRules(bodyTop, bodyBottom, consolidated, minBetweenRules);
  const mergeHairlineBelow =
    pitch > 0
      ? Math.max(grid.minRowBandSliceHeightPx, Math.round(pitch * grid.rowBandMergeHairlinePitchFraction))
      : grid.minRowBandSliceHeightPx;
  return { slices: mergeSmallRowBandSlices(slices, mergeHairlineBelow), rowPitchPx: pitch };
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
