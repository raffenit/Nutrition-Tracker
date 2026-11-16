import { OCR_IMPORT_MAX_PRODUCT_COLUMNS } from '../domain/columnStripDetectParams.js';
import type { BandLuminanceRoles } from '../domain/bandLuminanceRoles.js';
import {
  DEFAULT_RULED_TABLE_GRID_PARAMS,
  type RuledTableGridParams,
} from '../domain/ruledTableGridParams.js';
import {
  classifyBandLuminance,
  scanBandLuminanceY,
  verticalRuledGutterBrightnessLevel,
} from './bandLuminanceCluster.js';
import { IMAGE_ANALYSIS_WIDTH } from '../domain/imageAnalysisGeometry.js';
import { medianConsecutiveSpacing } from '../domain/sharedLabelGridLayout.js';
import { trimTrailingIrregularValueColumns } from './uniformColumnGeometry.js';

export {
  classifyBandLuminance,
  classifyBandLuminanceInScanBand,
  gutterBrightnessLevel,
  inkProfileGutterThreshold,
} from './bandLuminanceCluster.js';
export type { BandLuminanceRoles } from '../domain/bandLuminanceRoles.js';

export type RuledGridSegment = { x0: number; x1: number };

function bodyRuleMarginY(analysisH: number, p: RuledTableGridParams): number {
  return Math.max(1, Math.round(analysisH * p.bodyRuleYMarginBandFraction));
}

function fallbackRowPitchY(analysisH: number, p: RuledTableGridParams): number {
  return Math.max(1, Math.round(analysisH * p.defaultRowPitchBandFraction));
}

function nutrientRuleThicknessMax(pitch: number, p: RuledTableGridParams): number {
  if (pitch <= 0) return Number.POSITIVE_INFINITY;
  const slop = pitch * p.horizontalRuleThicknessSlopPitchFraction;
  return pitch * p.horizontalRuleMaxThicknessPitchFraction + slop;
}

/**
 * Column bounds in analysis x (full band width) from bright vertical gutters + horizontal rules.
 */
export type RuledGridCategorySegment = RuledGridSegment & { horizontalRuleCount: number };

export function ruledGridScanBandY(
  height: number,
  params: Partial<RuledTableGridParams> = {},
): { y0: number; y1: number } {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  return scanBandLuminanceY(height, p);
}

export function categoriesFromRuledGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  scanStartX: number,
  params: Partial<RuledTableGridParams> = {},
  maxColumns: number = OCR_IMPORT_MAX_PRODUCT_COLUMNS,
  options?: { requireHorizontalRules?: boolean },
): RuledGridCategorySegment[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const requireRules = options?.requireHorizontalRules ?? false;
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const scanW = width - scanStartX;
  if (scanW < 8) return [];

  const roles = classifyBandLuminance(pixels, width, height, scanStartX, width, y0, y1);
  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, width, y0, y1, roles);
  const gutterCenters = findBrightGutterCenters(brightness, p, roles);
  if (gutterCenters.length < 1) return [];

  const rightLocal = ruledValueScanRightLocal(gutterCenters, brightness.length);
  const edges = [0, ...gutterCenters, rightLocal];
  const minColW = Math.max(2, Math.round(scanW * p.minColumnWidthFraction));
  const segments: RuledGridCategorySegment[] = [];

  for (let i = 0; i < edges.length - 1; i += 1) {
    const localX0 = edges[i]!;
    const localX1 = edges[i + 1]!;
    if (localX1 - localX0 < minColW) continue;
    const absX0 = scanStartX + localX0;
    const absX1 = scanStartX + localX1;
    const ruleCount = countHorizontalRulesInColumn(pixels, width, height, absX0, absX1, y0, y1, p);
    if (requireRules && ruleCount < p.minHorizontalRulesPerColumn) continue;
    segments.push({ x0: absX0, x1: absX1, horizontalRuleCount: ruleCount });
  }

  if (segments.length > maxColumns) {
    const merged = mergeNarrowest(
      segments.map((s) => ({ x0: s.x0, x1: s.x1 })),
      maxColumns,
    );
    return merged.map((segment) => ({
      ...segment,
      horizontalRuleCount: countHorizontalRulesInColumn(pixels, width, height, segment.x0, segment.x1, y0, y1, p),
    }));
  }

  return trimOneSpuriousUniformGutterColumn(pixels, width, height, segments, scanW, y0, y1, p);
}

/**
 * Right edge of the ruled value scan in analysis-local x.
 * Extends to full width when a uniform grid likely continues through the right border
 * (unfinished pitch past the last detected gutter).
 */
function ruledValueScanRightLocal(gutterCenters: number[], scanLength: number): number {
  if (gutterCenters.length < 2) return scanLength;
  const spacings: number[] = [];
  for (let i = 1; i < gutterCenters.length; i += 1) {
    spacings.push(gutterCenters[i]! - gutterCenters[i - 1]!);
  }
  const pitch = medianOf(new Float64Array(spacings));
  if (pitch <= 0) return scanLength;
  const last = gutterCenters[gutterCenters.length - 1]!;
  const nominalRight = last + pitch;
  const trailing = scanLength - nominalRight;
  if (trailing > 0 && trailing <= pitch * 2.05) return scanLength;
  return Math.min(scanLength, nominalRight);
}

/** When gutters over-split by exactly one vs uniform nominal width, merge the narrowest segment away. */
function trimOneSpuriousUniformGutterColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  segments: RuledGridCategorySegment[],
  scanW: number,
  y0: number,
  y1: number,
  params: RuledTableGridParams,
): RuledGridCategorySegment[] {
  const ruled = segments.filter((s) => s.horizontalRuleCount >= params.minHorizontalRulesPerColumn);
  if (ruled.length < 3) return segments;

  const minProductW = Math.max(8, Math.round(scanW * params.minColumnWidthFraction * 1.05));
  const productCols = ruled.filter((s) => s.x1 - s.x0 >= minProductW);
  if (productCols.length < 3) return segments;

  const widths = productCols.map((s) => s.x1 - s.x0);
  const mean = widths.reduce((sum, w) => sum + w, 0) / widths.length;
  if (mean <= 0) return segments;
  const cv =
    Math.sqrt(widths.reduce((sum, w) => sum + (w - mean) ** 2, 0) / widths.length) / mean;
  if (cv > params.trimSpuriousColumnMaxUniformCv) return segments;

  const nominal = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] ?? mean;
  const target = Math.max(2, Math.round(scanW / Math.max(1, nominal)));
  if (segments.length <= target || segments.length - target > 2) return segments;

  const merged = mergeNarrowest(
    segments.map((s) => ({ x0: s.x0, x1: s.x1 })),
    target,
  );
  return merged.map((segment) => ({
    ...segment,
    horizontalRuleCount: countHorizontalRulesInColumn(
      pixels,
      width,
      height,
      segment.x0,
      segment.x1,
      y0,
      y1,
      params,
    ),
  }));
}

/** Left ink edge of the ruled grid (vertical border / first sustained table ink). */
export function ruledGridContentLeftX(
  pixels: Uint8Array,
  width: number,
  height: number,
  params: Partial<RuledTableGridParams> = {},
): number {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const colScore = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let edge = 0;
    for (let y = y0 + 1; y < y1 - 1; y += 1) {
      const idx = y * width + x;
      edge += Math.abs(pixels[idx]! - pixels[idx - 1]!);
    }
    colScore[x] = edge / Math.max(1, y1 - y0 - 2);
  }
  const peak = colScore.reduce((best, v) => Math.max(best, v), 0);
  if (peak <= 0) return 0;
  const probeW = Math.max(8, Math.round(width * (20 / 640)));
  for (let x = 0; x < width - probeW; x += 1) {
    const runs = horizontalRuleInkRunsInColumn(pixels, width, height, x, x + probeW, p);
    if (runs.length >= 6) return Math.max(0, x);
  }
  const strictCats = categoriesFromRuledGrid(pixels, width, height, 0, undefined, 8, {
    requireHorizontalRules: true,
  });
  const ruled = strictCats.filter((c) => c.horizontalRuleCount >= p.minHorizontalRulesPerColumn);
  if (ruled[0]) return ruled[0].x0;
  const level = peak * 0.18;
  let runStart = -1;
  for (let x = 0; x < width; x += 1) {
    if (colScore[x]! >= level) {
      if (runStart < 0) runStart = x;
      if (x - runStart >= 2) return Math.max(0, runStart);
    } else if (runStart >= 0 && x - runStart >= 2) {
      return runStart;
    }
  }
  return 0;
}

function matchBoundaryYs(
  candidateYs: number[],
  referenceYs: number[],
  toleranceY: number,
): number {
  let matched = 0;
  for (const ry of referenceYs) {
    if (candidateYs.some((y) => Math.abs(y - ry) <= toleranceY)) matched += 1;
  }
  return matched;
}

/**
 * Left ink edge of the ruled nutrition grid. Matches horizontal rules in the label rail against
 * a reference value column so packaging wrinkles left of the box are not mistaken for the table.
 */
export function nutritionTableLeftAnalysisX(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryX: number,
  valueRightX?: number,
  params: Partial<RuledTableGridParams> = {},
): number {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  if (labelBoundaryX < 12) return ruledGridContentLeftX(pixels, width, height, p);

  const tableRight = Math.min(width, valueRightX ?? width);
  const probeW = Math.max(10, Math.round((tableRight - labelBoundaryX) / 18));
  const refX1 = Math.min(tableRight, labelBoundaryX + probeW);
  const refRuns =
    refX1 > labelBoundaryX + 2
      ? horizontalRuleInkRunsInColumn(pixels, width, height, labelBoundaryX, refX1, p)
      : [];
  const refYs = refRuns.map((run) => run.boundaryY);
  const yTol = Math.max(2, Math.round(height * (4 / 640)));
  const minMatched =
    refYs.length >= 5 ? Math.max(4, Math.round(refYs.length * 0.5)) : 0;

  const minRailW = Math.max(8, Math.round(labelBoundaryX * p.nutritionTableMinLabelRailWidthFraction));
  const maxLeftX = Math.max(0, labelBoundaryX - minRailW);
  const seed = ruledGridContentLeftX(pixels, width, height, p);

  const { y0, y1 } = ruledGridScanBandY(height, p);
  const verticalEdgeScoreAt = (x: number): number => {
    let edge = 0;
    for (let y = y0 + 1; y < y1 - 1; y += 1) {
      const idx = y * width + x;
      edge += Math.abs(pixels[idx]! - pixels[idx - 1]!);
    }
    return edge / Math.max(1, y1 - y0 - 2);
  };

  const stripW = Math.max(8, Math.min(probeW, Math.round(labelBoundaryX * 0.22)));
  const ruleValidated = (x: number): boolean => {
    if (minMatched <= 0) return true;
    const runs = horizontalRuleInkRunsInColumn(pixels, width, height, x, x + stripW, p);
    return (
      matchBoundaryYs(
        runs.map((run) => run.boundaryY),
        refYs,
        yTol,
      ) >= minMatched
    );
  };

  const searchStart = Math.max(1, Math.min(seed, maxLeftX));
  const searchEnd = Math.min(maxLeftX, width - 2);
  let bestX = searchStart;
  let bestScore = verticalEdgeScoreAt(searchStart);
  for (let x = searchStart; x <= searchEnd; x += 1) {
    if (!ruleValidated(x)) continue;
    const score = verticalEdgeScoreAt(x);
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }
  if (bestX <= seed && searchEnd > seed) {
    for (let x = seed + 1; x <= searchEnd; x += 1) {
      const score = verticalEdgeScoreAt(x);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
  }
  const railLo = Math.max(0, labelBoundaryX - minRailW);
  const anchored = Math.max(railLo, Math.min(maxLeftX, Math.max(seed, bestX)));
  if (minMatched <= 0 && refYs.length < 5) {
    return Math.max(railLo, Math.min(maxLeftX, anchored));
  }
  return anchored;
}

/** Right edge of the nutrient grid in analysis x (drops trailing unruled / irregular strips). */
export function nutritionTableRightAnalysisX(
  pixels: Uint8Array,
  width: number,
  height: number,
  valueStartX: number,
): number {
  const loose = categoriesFromRuledGrid(pixels, width, height, valueStartX, undefined, 32, {
    requireHorizontalRules: false,
  });
  if (loose.length === 0) return width;
  const { segments } = trimTrailingIrregularValueColumns(
    loose.map((s) => ({ x0: s.x0, x1: s.x1 })),
    loose.map((s) => ({ horizontalRuleCount: s.horizontalRuleCount })),
  );
  const last = segments[segments.length - 1];
  return last !== undefined ? last.x1 : width;
}

/** @deprecated Prefer {@link nutritionTableRightAnalysisX}. */
export function ruledGridValueRegionRightX(
  pixels: Uint8Array,
  width: number,
  height: number,
  valueStartX: number,
): number {
  return nutritionTableRightAnalysisX(pixels, width, height, valueStartX);
}

export function valueColumnsFromRuledGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  valueStartX: number,
  params: Partial<RuledTableGridParams> = {},
  maxColumns: number = OCR_IMPORT_MAX_PRODUCT_COLUMNS,
): RuledGridSegment[] {
  return categoriesFromRuledGrid(pixels, width, height, valueStartX, params, maxColumns, {
    requireHorizontalRules: true,
  }).map(({ x0, x1 }) => ({ x0, x1 }));
}

export type HorizontalRuleInkRun = {
  startY: number;
  endY: number;
  thickness: number;
  peakY: number;
  boundaryY: number;
  /** Strongest row edge in the run, divided by the column edge peak (structural, not luminance thresholds). */
  peakFraction: number;
};

/** Median vertical spacing between rule boundaries — row pitch for thickness caps. */
export function estimateRowPitchFromRuleRuns(runs: HorizontalRuleInkRun[]): number {
  if (runs.length < 2) return 0;
  const sorted = [...runs].sort((a, b) => a.boundaryY - b.boundaryY);
  const ys = sorted.map((r) => r.boundaryY);
  const coarse = medianConsecutiveSpacing(ys);
  if (coarse <= 0) return 0;
  const tight = sorted.filter((r) => r.thickness <= coarse * 1.05);
  const from = tight.length >= 2 ? tight : sorted;
  return medianConsecutiveSpacing(from.map((r) => r.boundaryY)) || coarse;
}

/** Nutrient separators in the main body: ≤ {@link RuledTableGridParams.horizontalRuleMaxThicknessPitchFraction} × pitch. */
export function retainNutrientRowRuleRuns(
  runs: HorizontalRuleInkRun[],
  params: Partial<RuledTableGridParams> = {},
): HorizontalRuleInkRun[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  if (runs.length === 0) return runs;
  const pitch = estimateRowPitchFromRuleRuns(runs);
  if (pitch <= 0) return runs;
  return runs.filter((run) => run.thickness <= nutrientRuleThicknessMax(pitch, p));
}

/** Header / title rules may be thick; only gate thickness below {@link bodyTopAnalysisY}. */
export function retainBodyNutrientRowRuleRuns(
  runs: HorizontalRuleInkRun[],
  bodyTopAnalysisY: number,
  analysisH: number,
  params: Partial<RuledTableGridParams> = {},
): HorizontalRuleInkRun[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const margin = bodyRuleMarginY(analysisH, p);
  const header = runs.filter((run) => run.startY <= bodyTopAnalysisY + margin);
  const body = runs.filter((run) => run.startY > bodyTopAnalysisY + margin);
  return [...header, ...retainNutrientRowRuleRuns(body, params)].sort(
    (a, b) => a.boundaryY - b.boundaryY,
  );
}

function horizontalRuleInkRunsInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  params: Partial<RuledTableGridParams> = {},
): HorizontalRuleInkRun[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const roles = classifyBandLuminance(pixels, width, height, x0, x1, y0, y1);
  const profile = horizontalEdgeProfileInColumn(
    pixels,
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    roles.glareCap,
    p.horizontalRuleScanRowGlareBrightFraction,
  );
  const peak = profile.reduce((best, row) => Math.max(best, row.strength), 0);
  if (peak <= 0) return [];
  const median = medianOf(new Float64Array(profile.map((row) => row.strength)));
  const levelMin = Math.max(
    median * p.horizontalRuleMedianMultiplier,
    peak * p.horizontalRuleThresholdFraction * p.horizontalRulePeakLevelFraction,
  );
  const runs: HorizontalRuleInkRun[] = [];
  let runStart = -1;
  let runEnd = -1;
  let peakInRun = -1;
  let peakStrength = 0;
  const flush = () => {
    if (runStart < 0 || runEnd < runStart) return;
    const runH = runEnd - runStart + 1;
    const boundary = runEnd + Math.max(0, Math.round(runH * p.horizontalRuleBoundaryWithinRunFraction));
    const peakFraction = peak > 0 ? peakStrength / peak : 0;
    runs.push({
      startY: runStart,
      endY: runEnd,
      thickness: runH,
      peakY: peakInRun >= 0 ? peakInRun : Math.round((runStart + runEnd) / 2),
      boundaryY: boundary,
      peakFraction,
    });
    runStart = -1;
    runEnd = -1;
    peakInRun = -1;
    peakStrength = 0;
  };
  for (const row of profile) {
    const high = row.strength >= levelMin;
    if (high) {
      if (runStart < 0) runStart = row.y;
      runEnd = row.y;
      if (row.strength >= peakStrength) {
        peakStrength = row.strength;
        peakInRun = row.y;
      }
    } else if (runStart >= 0) flush();
  }
  flush();
  return runs.filter((run) => run.peakFraction >= p.horizontalRuleRunMinPeakFraction);
}

/** Analysis-space y indices for horizontal rule row peaks inside a column. */
export function horizontalRuleRowYsInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  return horizontalRuleInkRunsInColumn(pixels, width, height, x0, x1, params).map((run) => run.peakY);
}

/** Row separator y at the lower edge of each ruled ink run (keeps text out of thick lines). */
export function horizontalRuleRowBoundaryYsInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  return horizontalRuleInkRunsInColumn(pixels, width, height, x0, x1, params).map((run) => run.boundaryY);
}

/** Row-band interior edge at the **top** of rule ink — nutrient text sits above, not through the line. */
export function horizontalRuleRowSliceEdgeYsInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  params: Partial<RuledTableGridParams> = {},
  bodyTopAnalysisY?: number,
): number[] {
  const runs = horizontalRuleInkRunsInColumn(pixels, width, height, x0, x1, params);
  const gated =
    bodyTopAnalysisY !== undefined
      ? retainBodyNutrientRowRuleRuns(runs, bodyTopAnalysisY, height, params)
      : runs;
  return gated.map((run) => run.startY);
}

/** Left/right substrips detect row ink at different y on curved product columns. */
export function horizontalRuleRowSliceEdgeYsInColumnSubstrips(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  params: Partial<RuledTableGridParams> = {},
  bodyTopAnalysisY?: number,
): { left: number[]; right: number[] } {
  const colW = Math.max(1, x1 - x0);
  const probeFraction = colW <= 52 ? 0.48 : 0.3;
  const probeW = Math.max(
    3,
    Math.min(Math.round(colW * probeFraction), Math.floor((colW - 2) / 2)),
  );
  const leftX1 = Math.max(x0 + 2, Math.min(x1, x0 + probeW));
  const rightX0 = Math.min(x1 - 2, Math.max(x0, x1 - probeW));
  if (rightX0 <= leftX1 + 1) {
    const ys = horizontalRuleRowSliceEdgeYsInColumn(
      pixels,
      width,
      height,
      x0,
      x1,
      params,
      bodyTopAnalysisY,
    );
    return { left: ys, right: ys };
  }
  return {
    left: horizontalRuleRowSliceEdgeYsInColumn(
      pixels,
      width,
      height,
      x0,
      leftX1,
      params,
      bodyTopAnalysisY,
    ),
    right: horizontalRuleRowSliceEdgeYsInColumn(
      pixels,
      width,
      height,
      rightX0,
      x1,
      params,
      bodyTopAnalysisY,
    ),
  };
}

/** Deepest horizontal rule ink in any column (and label rail) below {@link bodyTopY}. */
export function maxBodyHorizontalRuleYAnalysis(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryX: number,
  valueColumns: RuledGridSegment[],
  bodyTopY: number,
  params: Partial<RuledTableGridParams> = {},
): number | null {
  let maxY: number | null = null;
  const consider = (x0: number, x1: number) => {
    for (const y of horizontalRuleRowSliceEdgeYsInColumn(pixels, width, height, x0, x1, params)) {
      if (y > bodyTopY + 2 && (maxY === null || y > maxY)) maxY = y;
    }
  };
  consider(0, Math.max(1, labelBoundaryX));
  for (const col of valueColumns) consider(col.x0, col.x1);
  return maxY;
}

export function consensusRuleInkRuns(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): HorizontalRuleInkRun[] {
  if (columns.length === 0) return [];
  const perColumn = columns.map((col) =>
    horizontalRuleInkRunsInColumn(pixels, width, height, col.x0, col.x1, params),
  );
  const buckets = new Map<
    number,
    { votes: number; thickness: number[]; runs: HorizontalRuleInkRun[] }
  >();
  for (const runs of perColumn) {
    for (const run of runs) {
      let bucketY = run.boundaryY;
      for (const key of buckets.keys()) {
        if (Math.abs(key - run.boundaryY) <= maxJitterPx) {
          bucketY = key;
          break;
        }
      }
      const prev = buckets.get(bucketY) ?? { votes: 0, thickness: [], runs: [] };
      prev.votes += 1;
      prev.thickness.push(run.thickness);
      prev.runs.push(run);
      buckets.set(bucketY, prev);
    }
  }
  const minVotes = Math.max(1, Math.ceil(columns.length * 0.45));
  return [...buckets.entries()]
    .filter(([, b]) => b.votes >= minVotes)
    .map(([boundaryY, b]) => {
      const thickness = medianOf(new Float64Array(b.thickness));
      const sample = b.runs[0]!;
      return {
        startY: sample.startY,
        endY: sample.endY,
        thickness: Math.round(thickness),
        peakY: sample.peakY,
        boundaryY,
        peakFraction: sample.peakFraction,
      };
    })
    .sort((a, b) => a.boundaryY - b.boundaryY);
}

/** Thick solid ink bars between label sections (e.g. main grid vs vitamins) — not nutrient row separators. */
export function sectionDividerBoundaryYsFromRuns(
  runs: HorizontalRuleInkRun[],
  bodyTopY: number,
  params: Partial<RuledTableGridParams> = {},
  analysisH?: number,
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const bandH =
    analysisH ??
    Math.max(bodyTopY + 1, ...runs.map((r) => r.boundaryY), Math.round(IMAGE_ANALYSIS_WIDTH));
  const margin = bodyRuleMarginY(bandH, p);
  const bodyRuns = runs.filter((r) => r.boundaryY >= bodyTopY - margin);
  if (bodyRuns.length === 0) return [];
  const nutrientRuns = retainNutrientRowRuleRuns(bodyRuns, p);
  const pitch = analysisSpanY(nutrientRuns.length >= 2 ? nutrientRuns : bodyRuns, bodyTopY, bandH, p);
  const rowMaxThick = nutrientRuleThicknessMax(pitch, p);
  const preamblePitch = analysisSpanY(bodyRuns, bodyTopY, bandH, p);
  const maxPreambleY = bodyTopY + Math.round(preamblePitch * p.bodyPreambleMaxHeightPitchFraction);
  return bodyRuns
    .filter((r) => r.thickness > rowMaxThick)
    .filter((r) => r.boundaryY >= maxPreambleY)
    .filter((r) => r.peakFraction >= p.ruleSectionDividerMinPeakFraction)
    .map((r) => r.boundaryY);
}

function analysisSpanY(
  bodyRuns: HorizontalRuleInkRun[],
  bodyTopY: number,
  analysisH: number,
  p: RuledTableGridParams,
): number {
  const ys = bodyRuns.map((r) => r.boundaryY);
  if (ys.length < 2) return fallbackRowPitchY(analysisH, p);
  const margin = bodyRuleMarginY(analysisH, p);
  const inBody = ys.filter((y) => y > bodyTopY + margin);
  return (
    medianConsecutiveSpacing(inBody.length >= 2 ? inBody : ys) || fallbackRowPitchY(analysisH, p)
  );
}

export function isBoundaryNearYs(y: number, excluded: number[], jitter = 3): boolean {
  return excluded.some((ex) => Math.abs(ex - y) <= jitter);
}

export function splitHeaderBodyFromRuleInkRuns(
  runs: HorizontalRuleInkRun[],
  analysisH: number,
  params: Partial<RuledTableGridParams> = {},
): { bodyTopY: number; headerBoundaryYs: number[]; bodyBoundaryYs: number[] } {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  if (runs.length === 0) {
    return { bodyTopY: 0, headerBoundaryYs: [], bodyBoundaryYs: [] };
  }
  const thicknesses = runs.map((r) => r.thickness);
  const medianThickness = medianOf(new Float64Array(thicknesses));
  const thickLevel = Math.max(1, medianThickness * p.ruleThickVsMedianThicknessRatio);
  const headerLimitY = Math.round(analysisH * p.headerSectionMaxHeightFraction);
  const thick = runs.filter((r) => r.thickness >= thickLevel);
  const thin = runs.filter((r) => r.thickness < thickLevel);
  const headerThick = thick.filter((r) => r.boundaryY <= headerLimitY);
  const headerBoundaryYs = headerThick.map((r) => r.boundaryY).sort((a, b) => a - b);

  let bodyTopY: number;
  if (headerThick.length > 0) {
    bodyTopY = Math.max(...headerThick.map((r) => r.boundaryY));
    const nextThin = thin.find((r) => r.boundaryY > bodyTopY);
    if (nextThin && nextThin.boundaryY - bodyTopY < medianThickness * 2) {
      bodyTopY = nextThin.boundaryY;
    }
  } else if (thin.length > 0) {
    bodyTopY = thin[0]!.boundaryY;
  } else {
    bodyTopY = runs[0]!.boundaryY;
  }

  const sectionDividers = new Set(sectionDividerBoundaryYsFromRuns(runs, bodyTopY, p, analysisH));
  const margin = bodyRuleMarginY(analysisH, p);
  const bodyRuns = runs.filter(
    (r) => r.startY > bodyTopY + margin && !sectionDividers.has(r.boundaryY),
  );
  const pitch = estimateRowPitchFromRuleRuns(bodyRuns);
  const maxBodyThick = nutrientRuleThicknessMax(pitch, p);
  const bodyBoundaryYs = bodyRuns
    .filter((r) => r.thickness <= maxBodyThick)
    .map((r) => r.startY);

  return { bodyTopY, headerBoundaryYs, bodyBoundaryYs: consolidateSortedYs(bodyBoundaryYs, 2) };
}

function consolidateSortedYs(ys: number[], minSpacing: number): number[] {
  const sorted = [...ys].sort((a, b) => a - b);
  const out: number[] = [];
  for (const y of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || y - last >= minSpacing) out.push(y);
  }
  return out;
}

export function consensusBodyTopY(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  params: Partial<RuledTableGridParams> = {},
  minAgreeingColumns: number = 2,
  maxJitterPx: number = 4,
): number | null {
  const runs = consensusRuleInkRuns(pixels, width, height, columns, maxJitterPx, params);
  if (runs.length > 0) {
    const split = splitHeaderBodyFromRuleInkRuns(runs, height, params);
    if (split.bodyTopY > 0) return split.bodyTopY;
  }
  const firstRules: number[] = [];
  for (const col of columns) {
    const ys = horizontalRuleRowYsInColumn(pixels, width, height, col.x0, col.x1, params);
    if (ys.length > 0) firstRules.push(ys[0]!);
  }
  if (firstRules.length < minAgreeingColumns) return null;
  firstRules.sort((a, b) => a - b);
  return firstRules[Math.floor(firstRules.length / 2)]!;
}

export function consensusHeaderRowBandYs(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  bodyTopY: number,
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const runs = consensusRuleInkRuns(pixels, width, height, columns, maxJitterPx, params);
  const split = splitHeaderBodyFromRuleInkRuns(runs, height, params);
  const fromThickness = split.headerBoundaryYs.filter((y) => y > 2 && y < bodyTopY + 2);
  if (fromThickness.length >= 2) return fromThickness;
  return consensusRowBandYs(pixels, width, height, columns, maxJitterPx, params).filter(
    (y) => y < bodyTopY - 2,
  );
}

function augmentBodyRowBandYsWithPreamble(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  bodyTopY: number,
  rules: number[],
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const pitch = medianConsecutiveSpacing(rules) || Math.max(8, Math.round(height / 14));
  const limit = bodyTopY + Math.round(pitch * p.bodyPreambleMaxHeightPitchFraction);
  const tightJitter = Math.max(1, Math.min(3, maxJitterPx));
  const tightRuns = consensusRuleInkRuns(pixels, width, height, columns, tightJitter, p);
  const tightSplit = splitHeaderBodyFromRuleInkRuns(tightRuns, height, p);
  const preamble = tightSplit.bodyBoundaryYs.filter((y) => {
    if (y <= bodyTopY + 1 || y >= limit) return false;
    if (isBoundaryNearYs(y, rules, 3)) return false;
    // % Daily Value lives in the header band; skip thin rules in the first body pitch unless value cols already have a rule there.
    const nearBodyHeader = y <= bodyTopY + Math.round(pitch * 0.55);
    if (nearBodyHeader && !rules.some((r) => Math.abs(r - y) <= 3)) return false;
    return true;
  });
  return consolidateSortedYs([...rules, ...preamble], 2);
}

/**
 * Value columns often skip ruled ink on label-only rows (% Daily Value, added sugars).
 * Merge label-rail rule edges into the body mesh when they are absent from value consensus.
 */
export function augmentBodyRowBandYsWithLabelRail(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryAnalysisX: number,
  bodyTopY: number,
  valueColumnRules: number[],
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const labelX1 = Math.max(1, labelBoundaryAnalysisX);
  const runs = horizontalRuleInkRunsInColumn(pixels, width, height, 0, labelX1, p);
  const bodyRuns = retainBodyNutrientRowRuleRuns(runs, bodyTopY, height, p);
  const dividers = new Set(sectionDividerBoundaryYsFromRuns(runs, bodyTopY, p, height));
  const labelYs = bodyRuns
    .filter((r) => r.startY > bodyTopY + 2 && !dividers.has(r.boundaryY))
    .map((r) => r.startY)
    .sort((a, b) => a - b);
  if (labelYs.length === 0) return [...valueColumnRules].sort((a, b) => a - b);
  const jitter = Math.max(2, maxJitterPx);
  const pitch =
    medianConsecutiveSpacing(valueColumnRules) ||
    medianConsecutiveSpacing(labelYs) ||
    8;
  const minDistinctGap = Math.max(jitter, Math.round(pitch * 0.32));
  const merged = [...valueColumnRules];
  for (const y of labelYs) {
    const nearIdx = merged.findIndex((existing) => Math.abs(existing - y) <= jitter);
    if (nearIdx >= 0) {
      // Prefer label-rail rule y when value consensus is a hair off (e.g. % Daily Value band).
      merged[nearIdx] = y;
      continue;
    }
    const tooClose = merged.some(
      (existing) => Math.abs(existing - y) < minDistinctGap && Math.abs(existing - y) > jitter,
    );
    if (!tooClose) merged.push(y);
  }
  merged.sort((a, b) => a - b);
  const dedupeGap = Math.max(2, Math.min(jitter, Math.round(pitch * 0.18)));
  return consolidateSortedYs(merged, dedupeGap);
}

/**
 * When the last nutrient row is taller than one pitch (missing consensus rule), inject
 * deepest column/label rules and a pitch step before the footer.
 */
export function augmentBodyRowBandYsWithTailAnchors(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryX: number,
  valueColumns: RuledGridSegment[],
  bodyTopY: number,
  bodyBottomY: number,
  valueColumnRules: number[],
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const sorted = [...valueColumnRules].sort((a, b) => a - b);
  if (sorted.length === 0) return sorted;
  const pitch = medianConsecutiveSpacing(sorted) || 8;
  const lastRule = sorted[sorted.length - 1]!;
  if (bodyBottomY - lastRule < pitch * 1.18) return sorted;

  const tailYs: number[] = [];
  const minTail = lastRule + Math.round(pitch * 0.45);
  const consider = (x0: number, x1: number) => {
    for (const y of horizontalRuleRowSliceEdgeYsInColumn(pixels, width, height, x0, x1, p)) {
      if (y > minTail && y < bodyBottomY - 2) tailYs.push(y);
    }
  };
  consider(0, Math.max(1, labelBoundaryX));
  for (const col of valueColumns) consider(col.x0, col.x1);

  const merged = [...sorted];
  if (tailYs.length > 0) {
    const deepest = Math.max(...tailYs);
    const nearIdx = merged.findIndex((y) => Math.abs(y - deepest) <= maxJitterPx);
    if (nearIdx >= 0) merged[nearIdx] = deepest;
    else merged.push(deepest);
  }

  merged.sort((a, b) => a - b);
  const tailRule = merged[merged.length - 1]!;
  if (bodyBottomY - tailRule > pitch * 1.22) {
    const step = tailRule + Math.round(pitch);
    if (step < bodyBottomY - 4) merged.push(step);
  }

  const dedupeGap = Math.max(2, Math.min(maxJitterPx, Math.round(pitch * 0.16)));
  return consolidateSortedYs(merged, dedupeGap);
}

export function consensusBodyRowBandYs(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  bodyTopY: number,
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const runs = consensusRuleInkRuns(pixels, width, height, columns, maxJitterPx, params);
  const split = splitHeaderBodyFromRuleInkRuns(runs, height, params);
  const fromThickness = split.bodyBoundaryYs.filter((y) => y >= bodyTopY - 2);
  if (fromThickness.length >= 2) {
    return augmentBodyRowBandYsWithPreamble(
      pixels,
      width,
      height,
      columns,
      bodyTopY,
      fromThickness,
      maxJitterPx,
      params,
    );
  }
  const fallback = consensusRowBandYs(pixels, width, height, columns, maxJitterPx, params).filter(
    (y) => y >= bodyTopY - 2,
  );
  return augmentBodyRowBandYsWithPreamble(
    pixels,
    width,
    height,
    columns,
    bodyTopY,
    fallback,
    maxJitterPx,
    params,
  );
}

export function consensusRowBandYs(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  if (columns.length === 0) return [];
  const perColumn = columns.map((col) =>
    horizontalRuleRowYsInColumn(pixels, width, height, col.x0, col.x1, params),
  );
  const counts = new Map<number, number>();
  for (const ys of perColumn) {
    for (const y of ys) {
      let bucket = y;
      for (const key of counts.keys()) {
        if (Math.abs(key - y) <= maxJitterPx) {
          bucket = key;
          break;
        }
      }
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  const minVotes = Math.max(1, Math.ceil(columns.length * 0.45));
  return [...counts.entries()]
    .filter(([, votes]) => votes >= minVotes)
    .map(([y]) => y)
    .sort((a, b) => a - b);
}

function columnMeanBrightness(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  roles: BandLuminanceRoles,
): Float64Array {
  const glareCap = roles.glareCap;
  const profile = new Float64Array(x1 - x0);
  for (let x = x0; x < x1; x += 1) {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      const v = pixels[y * width + x]!;
      sum += Math.min(v, glareCap);
      count += 1;
    }
    profile[x - x0] = count > 0 ? sum / count : 0;
  }
  return profile;
}

function columnMeanIsGutter(mean: number, level: number): boolean {
  return mean >= level;
}

/** Bright vertical gutter center x positions in full image coordinates. */
export function brightVerticalGutterCentersAbs(
  pixels: Uint8Array,
  width: number,
  height: number,
  scanStartX: number = 0,
  scanEndX: number = width,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  if (scanEndX - scanStartX < 8) return [];
  const roles = classifyBandLuminance(pixels, width, height, scanStartX, scanEndX, y0, y1);
  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, scanEndX, y0, y1, roles);
  const local = findBrightGutterCenters(brightness, p, roles);
  return local.map((x) => scanStartX + x);
}

/** Bright gutter count + 1 ≈ vertical column count in a ruled value region. */
export function estimateValueColumnCountFromGutters(
  pixels: Uint8Array,
  width: number,
  height: number,
  scanStartX: number,
  scanEndX: number = width,
  params: Partial<RuledTableGridParams> = {},
): number {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const roles = classifyBandLuminance(pixels, width, height, scanStartX, scanEndX, y0, y1);
  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, scanEndX, y0, y1, roles);
  const gutters = findBrightGutterCenters(brightness, p, roles);
  if (gutters.length < 1) return 0;
  const level = verticalRuledGutterBrightnessLevel(roles, p.gutterBrightnessMinFraction);
  // Value scan often begins inside the label|first-column gutter: N gutters delimit N columns.
  const scanStartsInGutter = brightness[0]! >= level;
  return scanStartsInGutter ? gutters.length : gutters.length + 1;
}

function findBrightGutterCenters(
  brightness: Float64Array,
  params: RuledTableGridParams,
  roles: BandLuminanceRoles,
): number[] {
  const level = verticalRuledGutterBrightnessLevel(roles, params.gutterBrightnessMinFraction);
  if (level <= 0) return [];
  const minSpacing = Math.max(2, Math.round(brightness.length * params.gutterMinSpacingFraction));
  const minGutterW = Math.max(1, Math.round(brightness.length * params.gutterMinWidthFraction));

  const centers: number[] = [];
  let runStart = -1;
  for (let x = 0; x < brightness.length; x += 1) {
    const bright = columnMeanIsGutter(brightness[x]!, level);
    if (bright && runStart < 0) runStart = x;
    if ((!bright || x === brightness.length - 1) && runStart >= 0) {
      const runEnd = bright ? x : x - 1;
      const runW = runEnd - runStart + 1;
      if (
        runW >= minGutterW &&
        verticalGutterRunBoundedByInk(brightness, runStart, runEnd, level, minSpacing, params)
      ) {
        const center = Math.round((runStart + runEnd) / 2);
        const last = centers[centers.length - 1];
        if (last === undefined || center - last >= minSpacing) {
          centers.push(center);
        }
      }
      runStart = -1;
    }
  }
  return centers;
}

/** Real vertical gutters sit between ink columns — not in open margin on one side. */
function verticalGutterRunBoundedByInk(
  brightness: Float64Array,
  runStart: number,
  runEnd: number,
  level: number,
  minSpacing: number,
  params: RuledTableGridParams,
): boolean {
  const runW = runEnd - runStart + 1;
  const probe = Math.max(
    4,
    Math.min(minSpacing, Math.round(runW * params.verticalGutterInkProbeGutterWidths)),
  );
  const edgeMargin = Math.max(
    2,
    Math.round(minSpacing * params.verticalGutterInkEdgeMarginOfMinSpacing),
  );

  let inkAfter = false;
  for (let x = runEnd + 1; x < Math.min(brightness.length, runEnd + 1 + probe); x += 1) {
    if (brightness[x]! < level) {
      inkAfter = true;
      break;
    }
  }
  if (!inkAfter) return false;

  if (runStart <= edgeMargin) return true;

  let inkBefore = false;
  for (let x = runStart - 1; x >= Math.max(0, runStart - probe); x -= 1) {
    if (brightness[x]! < level) {
      inkBefore = true;
      break;
    }
  }
  return inkBefore;
}

function horizontalEdgeProfileInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  glareCap = 255,
  rowGlareBrightFraction = 0,
): Array<{ y: number; strength: number }> {
  const colW = Math.max(1, x1 - x0);
  const rows: Array<{ y: number; strength: number }> = [];
  const glareThreshold = Math.max(0, glareCap - 1);
  for (let y = y0 + 1; y < y1; y += 1) {
    let edge = 0;
    let bright = 0;
    let samples = 0;
    for (let x = x0 + 1; x < x1 - 1; x += 1) {
      const idx = y * width + x;
      const v = Math.min(pixels[idx]!, glareCap);
      const vAbove = Math.min(pixels[idx - width]!, glareCap);
      edge += Math.abs(v - vAbove);
      samples += 1;
      if (pixels[idx]! >= glareThreshold) bright += 1;
    }
    const brightFrac = samples > 0 ? bright / samples : 0;
    const strength =
      rowGlareBrightFraction > 0 && brightFrac > rowGlareBrightFraction ? 0 : edge / colW;
    rows.push({ y, strength });
  }
  return rows;
}

function countHorizontalRulesInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  params: RuledTableGridParams,
): number {
  const roles = classifyBandLuminance(pixels, width, height, x0, x1, y0, y1);
  const profile = horizontalEdgeProfileInColumn(
    pixels,
    width,
    height,
    x0,
    x1,
    y0,
    y1,
    roles.glareCap,
    params.horizontalRuleScanRowGlareBrightFraction,
  );
  const peak = profile.reduce((p, row) => Math.max(p, row.strength), 0);
  if (peak <= 0) return 0;
  const median = medianOf(new Float64Array(profile.map((row) => row.strength)));
  const levelMin = Math.max(
    median * params.horizontalRuleMedianMultiplier,
    peak * params.horizontalRuleThresholdFraction * params.horizontalRulePeakLevelFraction,
  );
  let rules = 0;
  let inRun = false;
  for (const row of profile) {
    const high = row.strength >= levelMin;
    if (high && !inRun) {
      rules += 1;
      inRun = true;
    }
    if (!high) inRun = false;
  }
  return rules;
}

function medianOf(values: Float64Array): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] ?? 0;
}

function mergeNarrowest(segments: RuledGridSegment[], target: number): RuledGridSegment[] {
  let current = [...segments];
  while (current.length > target) {
    let narrowest = 0;
    for (let i = 1; i < current.length; i += 1) {
      if (current[i]!.x1 - current[i]!.x0 < current[narrowest]!.x1 - current[narrowest]!.x0) {
        narrowest = i;
      }
    }
    const neighbor = narrowest === 0 ? 1 : narrowest - 1;
    const a = current[narrowest]!;
    const b = current[neighbor]!;
    const merged = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1) };
    current = current.filter((_, i) => i !== narrowest && i !== neighbor);
    current.push(merged);
    current.sort((l, r) => l.x0 - r.x0);
  }
  return current;
}
