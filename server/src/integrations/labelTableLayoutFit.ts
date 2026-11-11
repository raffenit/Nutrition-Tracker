import type { LabelLayoutHint } from '../domain/labelLayout.js';
import { MULTI_COLUMN_FOCUS_MIN_PEAKS } from '../domain/labelFocusParams.js';
import {
  DEFAULT_LABEL_TABLE_LAYOUT_PARAMS,
  type LabelTableLayoutParams,
} from '../domain/labelTableLayoutParams.js';
import type { VarietyPackLabelLayout } from '../domain/varietyPackGridPipeline.js';
import type { ColumnStripDetectParams } from '../domain/columnStripDetectParams.js';
import { DEFAULT_SPLIT_SINGLE_LABEL_PARAMS } from '../domain/splitSingleLabelParams.js';
import { classifyBandLuminanceInScanBand } from './bandLuminanceCluster.js';
import {
  buildColumnInkProfileFromBand,
  columnBoundariesFromInkProfile,
} from './labelColumnStrips.js';
import { brightVerticalGutterCentersAbs, categoriesFromRuledGrid } from './ruledTableGridDetect.js';
import { sharedLabelBoundaryForTest } from './sharedLabelValueGrid.js';
import {
  columnWidthCv,
  detectEqualWidthColumnPair,
  firstColumnWideVsSiblings,
  fitEqualWidthColumnGrid,
  medianPositiveWidth,
  nominalUniformColumnWidth,
} from './uniformColumnGeometry.js';

function mergeLayoutParams(params: Partial<LabelTableLayoutParams> = {}): LabelTableLayoutParams {
  return {
    ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS,
    ...params,
    hypothesisScores: {
      ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS.hypothesisScores,
      ...params.hypothesisScores,
    },
  };
}

export type ColumnSegment = { x0: number; x1: number; horizontalRuleCount?: number };

export type ColumnGeometryWitnesses = {
  analysisW: number;
  analysisH: number;
  inkProfile: Float64Array;
  ruled: ColumnSegment[];
  inkLegacy: ColumnSegment[];
  inkLuminance: ColumnSegment[];
  /** Ink projection with max two columns (split-single witness). */
  inkLegacySplitPair: ColumnSegment[];
  /** Bright vertical gutter centers (analysis-space x). */
  verticalGutterCenters: number[];
};

export type LayoutHypothesisScore = {
  layout: VarietyPackLabelLayout | 'single';
  score: number;
};

export function collectColumnGeometryWitnesses(
  pixels: Uint8Array,
  analysisW: number,
  analysisH: number,
  stripParams: ColumnStripDetectParams,
  maxColumns: number,
): ColumnGeometryWitnesses {
  const profile = buildColumnInkProfileFromBand(pixels, analysisW, analysisH);
  const roles = classifyBandLuminanceInScanBand(pixels, analysisW, analysisH, 0, analysisW);
  const base = { ...stripParams, maxColumns };
  const inkLegacy = columnBoundariesFromInkProfile(profile, base, undefined);
  const inkLuminance = columnBoundariesFromInkProfile(profile, base, roles);
  const inkLegacySplitPair = columnBoundariesFromInkProfile(profile, { ...base, maxColumns: 2 }, undefined);
  const ruled = categoriesFromRuledGrid(pixels, analysisW, analysisH, 0, undefined, maxColumns + 1, {
    requireHorizontalRules: false,
  }).map((segment) => ({
    x0: segment.x0,
    x1: segment.x1,
    horizontalRuleCount: segment.horizontalRuleCount,
  }));

  const verticalGutterCenters = brightVerticalGutterCentersAbs(pixels, analysisW, analysisH, 0, analysisW);

  return {
    analysisW,
    analysisH,
    inkProfile: profile,
    ruled,
    inkLegacy,
    inkLuminance,
    inkLegacySplitPair,
    verticalGutterCenters,
  };
}

export function scoreLayoutHypotheses(
  witnesses: ColumnGeometryWitnesses,
  hint?: Pick<LabelLayoutHint, 'singleSubjectInFocus' | 'sharpPeakCount'>,
  profileInkAsymmetry?: number,
  params: Partial<LabelTableLayoutParams> = {},
): LayoutHypothesisScore[] {
  const p = mergeLayoutParams(params);
  const split = applyInteriorGutterDock(
    scoreSplitSingle(witnesses, hint, p),
    'split_single',
    witnesses,
    p,
  );
  const shared = applyInteriorGutterDock(
    scoreSharedRail(witnesses, profileInkAsymmetry, p),
    'shared_rail',
    witnesses,
    p,
  );
  const perColumn = applyInteriorGutterDock(
    scorePerColumnLabels(witnesses, p),
    'per_column_labels',
    witnesses,
    p,
  );
  const scores: LayoutHypothesisScore[] = [
    { layout: 'split_single', score: split },
    { layout: 'shared_rail', score: shared },
    { layout: 'per_column_labels', score: perColumn },
    { layout: 'unknown', score: p.hypothesisScores.unknownFloor },
  ];
  return scores.sort((a, b) => b.score - a.score);
}

/** Columns implied by a layout hypothesis — used to penalize interior vertical gutters. */
export function columnSegmentsForLayout(
  layout: VarietyPackLabelLayout | 'single',
  witnesses: ColumnGeometryWitnesses,
  maxColumns: number = 14,
): ColumnSegment[] {
  if (layout === 'split_single') {
    return fitSplitSingleColumns(witnesses) ?? [];
  }
  if (layout === 'per_column_labels') {
    return witnesses.ruled.filter((s) => (s.horizontalRuleCount ?? 0) >= 4);
  }
  if (layout === 'shared_rail') {
    const boundary = sharedLabelBoundaryForTest(witnesses.inkProfile);
    if (boundary === null || boundary <= 0) return witnesses.ruled;
    const label = { x0: 0, x1: boundary };
    const values = fitUniformValueColumns(witnesses, boundary, witnesses.analysisW, maxColumns, 3);
    return values.length > 0 ? [label, ...values] : [label, ...witnesses.ruled];
  }
  return [];
}

export function countInteriorVerticalGutters(
  gutterCenters: number[],
  segments: ColumnSegment[],
  params: Partial<LabelTableLayoutParams> = {},
): number {
  const p = { ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS, ...params };
  if (gutterCenters.length === 0 || segments.length === 0) return 0;
  let hits = 0;
  for (const g of gutterCenters) {
    const onBoundary = segments.some((seg) => {
      const w = seg.x1 - seg.x0;
      const edgeTol = Math.max(2, Math.round(w * p.gutterBoundaryToleranceFraction));
      return g <= seg.x0 + edgeTol || g >= seg.x1 - edgeTol;
    });
    if (onBoundary) continue;
    const interior = segments.some((seg) => {
      const w = seg.x1 - seg.x0;
      if (w < 4) return false;
      const inset = Math.max(2, Math.round(w * p.interiorGutterInsetFraction));
      return g > seg.x0 + inset && g < seg.x1 - inset;
    });
    if (interior) hits += 1;
  }
  return hits;
}

export function interiorVerticalGutterPenalty(
  gutterCenters: number[],
  segments: ColumnSegment[],
  params: Partial<LabelTableLayoutParams> = {},
): number {
  const p = { ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS, ...params };
  const hits = countInteriorVerticalGutters(gutterCenters, segments, params);
  return Math.min(p.maxInteriorGutterPenalty, hits * p.interiorGutterPenaltyPerHit);
}

function applyInteriorGutterDock(
  score: number,
  layout: VarietyPackLabelLayout,
  witnesses: ColumnGeometryWitnesses,
  params: LabelTableLayoutParams,
): number {
  const segments = columnSegmentsForLayout(layout, witnesses);
  const dock = interiorVerticalGutterPenalty(witnesses.verticalGutterCenters, segments, params);
  return Math.max(0, Math.min(1, score - dock));
}

/** Shared-rail vs per-column only (variety-pack step 3). Ignores split_single / unknown runners. */
export function pickVarietyPackSubtype(
  scores: LayoutHypothesisScore[],
  params: Partial<LabelTableLayoutParams> = {},
): 'shared_rail' | 'per_column_labels' | 'unknown' {
  const p = mergeLayoutParams(params);
  const shared = scores.find((s) => s.layout === 'shared_rail')?.score ?? 0;
  const perCol = scores.find((s) => s.layout === 'per_column_labels')?.score ?? 0;
  const subtypeMin = Math.min(p.minWinningScore, p.subtypePickScoreCeiling);
  const subtypeMargin = Math.min(p.minScoreMargin, p.subtypePickMarginCeiling);
  if (shared >= subtypeMin && shared >= perCol + subtypeMargin) return 'shared_rail';
  if (perCol >= subtypeMin && perCol >= shared + subtypeMargin) return 'per_column_labels';
  if (shared > perCol + p.subtypeScoreTieMargin) return 'shared_rail';
  if (perCol > shared + p.subtypeScoreTieMargin) return 'per_column_labels';
  return 'unknown';
}

export function pickLeadingLayoutHypothesis(
  scores: LayoutHypothesisScore[],
  params: Partial<LabelTableLayoutParams> = {},
): VarietyPackLabelLayout | 'single' | 'unknown' {
  const p = { ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS, ...params };
  const top = scores[0];
  const second = scores[1]?.score ?? 0;
  if (!top || top.layout === 'unknown') return 'unknown';
  if (top.score < p.minWinningScore) return 'unknown';
  if (top.score - second < p.minScoreMargin) return 'unknown';
  return top.layout;
}

export function fitSplitSingleColumns(
  witnesses: ColumnGeometryWitnesses,
  params: Partial<LabelTableLayoutParams> = {},
): ColumnSegment[] | null {
  const { widthRatioMin, widthRatioMax } = DEFAULT_SPLIT_SINGLE_LABEL_PARAMS;
  const W = witnesses.analysisW;
  const p = { ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS, ...params };

  const pair = detectEqualWidthColumnPair(
    witnesses.ruled,
    W,
    widthRatioMin,
  );
  if (pair) {
    return [
      { x0: pair.left.x0, x1: pair.left.x1 },
      { x0: pair.right.x0, x1: pair.right.x1 },
    ];
  }

  if (segmentsMatchSplitSingleRatio(witnesses.inkLegacySplitPair, widthRatioMin, widthRatioMax)) {
    return witnesses.inkLegacySplitPair;
  }

  const equal = fitEqualWidthColumnGrid(0, W, 2);
  if (segmentsMatchSplitSingleRatio(equal, widthRatioMin, widthRatioMax)) {
    return equal;
  }

  const seam = centerSeamFromInkProfile(witnesses.inkProfile, W, p.splitSeamSearchInsetFraction);
  const seamSplit: ColumnSegment[] = [
    { x0: 0, x1: seam },
    { x0: seam, x1: W },
  ];
  if (segmentsMatchSplitSingleRatio(seamSplit, widthRatioMin, widthRatioMax)) {
    return seamSplit;
  }
  return null;
}

export function consensusUniformColumnCount(
  witnesses: ColumnGeometryWitnesses,
  valueStartX: number,
  valueEndX: number,
  maxColumns: number,
  minHorizontalRules: number = 3,
): number {
  const valueW = valueEndX - valueStartX;
  if (valueW < 4) return 0;

  const inValue = (segments: ColumnSegment[]) =>
    segments
      .map((s) => ({ x0: Math.max(s.x0, valueStartX), x1: Math.min(s.x1, valueEndX) }))
      .filter((s) => s.x1 - s.x0 >= Math.max(2, Math.round(valueW * 0.04)));

  const counts = [
    inValue(witnesses.ruled.filter((s) => (s.horizontalRuleCount ?? 0) >= minHorizontalRules)).length,
    inValue(witnesses.ruled).length,
    inValue(witnesses.inkLegacy).length,
    inValue(witnesses.inkLuminance).length,
  ].filter((n) => n >= 2);

  const ruledMeta = witnesses.ruled.map((s) => ({ horizontalRuleCount: s.horizontalRuleCount ?? 0 }));
  const nominal = nominalUniformColumnWidth(witnesses.ruled, minHorizontalRules);
  if (nominal !== null && nominal > 0) {
    counts.push(Math.round(valueW / nominal));
  }

  if (counts.length === 0) return 0;
  counts.sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] ?? 0;
  return Math.min(maxColumns, Math.max(2, median));
}

export function fitUniformValueColumns(
  witnesses: ColumnGeometryWitnesses,
  valueStartX: number,
  valueEndX: number,
  maxColumns: number,
  minHorizontalRules: number = 3,
  params: Partial<LabelTableLayoutParams> = {},
): ColumnSegment[] {
  const p = { ...DEFAULT_LABEL_TABLE_LAYOUT_PARAMS, ...params };
  const n = consensusUniformColumnCount(witnesses, valueStartX, valueEndX, maxColumns, minHorizontalRules);
  if (n < 2) return [];
  const fitted = fitEqualWidthColumnGrid(valueStartX, valueEndX, n);
  const cv = columnWidthCv(fitted.map((s) => s.x1 - s.x0));
  if (cv <= p.sharedRailFitMaxWidthCv) return fitted;
  return [];
}

function scoreSplitSingle(
  witnesses: ColumnGeometryWitnesses,
  hint: Pick<LabelLayoutHint, 'singleSubjectInFocus' | 'sharpPeakCount'> | undefined,
  params: LabelTableLayoutParams,
): number {
  const w = params.hypothesisScores;
  let score = 0;
  if (hint?.singleSubjectInFocus) score += w.splitSingleFocusBoost;
  if (hint && hint.sharpPeakCount < MULTI_COLUMN_FOCUS_MIN_PEAKS) score += w.splitSingleLowPeakBoost;

  const fit = fitSplitSingleColumns(witnesses);
  if (fit) score += w.splitSingleFitBoost;

  const ruledWithRules = witnesses.ruled.filter((s) => (s.horizontalRuleCount ?? 0) >= 4).length;
  if (ruledWithRules >= 3) score -= w.splitSingleManyRuledPenalty;
  if (witnesses.ruled.length >= 4) score -= w.splitSingleExtraColumnPenalty;
  if (!hint?.singleSubjectInFocus) {
    const sharedScore = scoreSharedRail(witnesses, undefined, params);
    if (sharedScore >= w.splitSingleSharedCompeteThreshold) score -= w.splitSingleSharedCompetePenalty;
  }

  return Math.max(0, Math.min(1, score));
}

function scoreSharedRail(
  witnesses: ColumnGeometryWitnesses,
  inkAsymmetry: number | undefined,
  params: LabelTableLayoutParams,
): number {
  const w = params.hypothesisScores;
  let score = w.sharedRailBase;
  const first = witnesses.ruled[0];
  if (!first) return score;

  const stronglyRuled = witnesses.ruled.filter((s) => (s.horizontalRuleCount ?? 0) >= 4);
  if (
    (first.horizontalRuleCount ?? 0) >= 4 &&
    stronglyRuled.length >= 3 &&
    stronglyRuled.length >= witnesses.ruled.length - 1
  ) {
    const widths = stronglyRuled.map((s) => s.x1 - s.x0);
    const uniformCv = columnWidthCv(widths);
    const firstW = first.x1 - first.x0;
    const otherWidths = stronglyRuled.slice(1).map((s) => s.x1 - s.x0);
    const otherMedian = medianPositiveWidth(otherWidths);
    if (
      uniformCv < w.perColumnUniformMaxCv &&
      otherMedian > 0 &&
      firstW <= otherMedian * w.perColumnFirstVsOtherWidthMaxRatio
    ) {
      return w.perColumnUniformSharedCap;
    }
  }

  const productLike = witnesses.ruled.filter((s) => (s.horizontalRuleCount ?? 0) >= 3);
  if (productLike.length >= 3) score += w.sharedRailProductLikeBoost;

  const productLikeWidths = productLike.map((s) => s.x1 - s.x0);
  if (productLikeWidths.length >= 2) {
    const cv = columnWidthCv(productLikeWidths);
    if (cv < w.sharedRailTightCvMax) score += w.sharedRailTightCvBoost;
    else if (cv < w.sharedRailLooseCvMax) score += w.sharedRailLooseCvBoost;
  }

  const productWidths = witnesses.ruled
    .filter((s) => s !== first)
    .map((s) => s.x1 - s.x0)
    .filter((segW) => segW > 0);
  const median = medianPositiveWidth(productWidths);
  const firstW = first.x1 - first.x0;
  if (firstColumnWideVsSiblings(firstW, productWidths, params.labelRailMinWidthRatio)) {
    score += w.sharedRailWideFirstBoost;
  }
  const labelRailFrac = firstW / Math.max(1, witnesses.analysisW);
  const railShaped =
    labelRailFrac >= w.sharedRailLabelRailFracMin &&
    labelRailFrac <= w.sharedRailLabelRailFracMax &&
    median > 0 &&
    firstW < median * w.sharedRailNarrowFirstVsMedianRatio;
  if (railShaped) score += w.sharedRailRailShapedBoost;
  else if (
    median > 0 &&
    firstW >= median * w.sharedRailFirstVsMedianWideRatio &&
    (first.horizontalRuleCount ?? 0) < 3
  ) {
    score += w.sharedRailWideLowRuleBoost;
  }

  if (inkAsymmetry !== undefined && inkAsymmetry >= w.sharedRailInkAsymmetryThresholdLo) {
    score += w.sharedRailInkAsymmetryBoostLo;
  }
  if (inkAsymmetry !== undefined && inkAsymmetry >= w.sharedRailInkAsymmetryThresholdHi) {
    score += w.sharedRailInkAsymmetryBoostHi;
  }
  if (witnesses.ruled.length >= w.sharedRailManyColumnMin) score -= w.sharedRailManyColumnPenalty;
  return Math.max(0, Math.min(1, score));
}

function scorePerColumnLabels(witnesses: ColumnGeometryWitnesses, params: LabelTableLayoutParams): number {
  const w = params.hypothesisScores;
  const ruled = witnesses.ruled.filter((s) => (s.horizontalRuleCount ?? 0) >= 4);
  if (ruled.length < 2) return w.perColumnMinRunner;

  let score = w.perColumnBase;
  if (ruled.length >= 3) score += w.perColumnCountBoost;
  const widths = ruled.map((s) => s.x1 - s.x0);
  const cv = columnWidthCv(widths);
  if (cv < w.perColumnUniformCvMax) score += w.perColumnUniformCvBoost;

  const first = witnesses.ruled[0];
  if (first && (first.horizontalRuleCount ?? 0) >= 4) score += w.perColumnRuledFirstBoost;

  if (first) {
    const firstW = first.x1 - first.x0;
    const median = medianPositiveWidth(widths);
    const labelRailFrac = firstW / Math.max(1, witnesses.analysisW);
    if (
      labelRailFrac >= w.perColumnLabelRailFracMin &&
      labelRailFrac <= w.perColumnLabelRailFracMax &&
      median > 0 &&
      firstW < median * w.perColumnFirstNarrowVsMedianRatio
    ) {
      score -= w.perColumnRailShapedPenalty;
    }
  }

  return Math.max(0, Math.min(1, score));
}

function segmentsMatchSplitSingleRatio(
  segments: ColumnSegment[],
  widthRatioMin: number,
  widthRatioMax: number,
): boolean {
  if (segments.length !== 2) return false;
  const [left, right] = segments;
  const wl = left!.x1 - left!.x0;
  const wr = right!.x1 - right!.x0;
  if (wl <= 0 || wr <= 0) return false;
  const ratio = wl < wr ? wl / wr : wr / wl;
  return ratio >= widthRatioMin && ratio <= widthRatioMax;
}

function centerSeamFromInkProfile(
  profile: Float64Array,
  width: number,
  searchInsetFraction: number,
): number {
  const x0 = Math.round(width * searchInsetFraction);
  const x1 = Math.round(width * (1 - searchInsetFraction));
  const radius = Math.max(1, Math.round(width / 160));
  let bestX = Math.round(width / 2);
  let bestVal = Number.POSITIVE_INFINITY;
  for (let x = x0; x <= x1; x += 1) {
    let sum = 0;
    let count = 0;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const i = x + dx;
      if (i < 0 || i >= width) continue;
      sum += profile[i]!;
      count += 1;
    }
    const value = count > 0 ? sum / count : profile[x]!;
    if (value < bestVal) {
      bestVal = value;
      bestX = x;
    }
  }
  return bestX;
}
