import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

export type LabelTableLayoutParams = {
  /** Minimum winning hypothesis score (0–1). */
  minWinningScore: number;
  /** Top score must exceed runner-up by at least this much. */
  minScoreMargin: number;
  /** Split-single: center seam search window as fraction of analysis width. */
  splitSeamSearchInsetFraction: number;
  /** Shared-rail value fit: max width CV after uniform snap. */
  sharedRailFitMaxWidthCv: number;
  /** Gutter x must be this far from column edges to count as “interior”. */
  interiorGutterInsetFraction: number;
  /** Score dock per bright vertical gutter found inside a hypothesized column. */
  interiorGutterPenaltyPerHit: number;
  maxInteriorGutterPenalty: number;
  /** Gutter x within this fraction of a column edge is treated as a boundary, not interior. */
  gutterBoundaryToleranceFraction: number;
  /** Cap used with {@link minWinningScore} when picking shared_rail vs per_column subtype. */
  subtypePickScoreCeiling: number;
  subtypePickMarginCeiling: number;
  /** Weak tie-break between shared_rail and per_column_labels scores. */
  subtypeScoreTieMargin: number;
  /** Step 3: prefer ink rail when shared score is within this much of per-column. */
  inkRailPreferScoreTieEpsilon: number;
  /** First ruled segment is a label rail when width ≥ median sibling × this (matches pipeline). */
  labelRailMinWidthRatio: number;
  hypothesisScores: LayoutHypothesisScoreWeights;
};

/** Tunable weights for `scoreLayoutHypotheses` (0–1 scale). */
export type LayoutHypothesisScoreWeights = {
  unknownFloor: number;
  splitSingleFocusBoost: number;
  splitSingleLowPeakBoost: number;
  splitSingleFitBoost: number;
  splitSingleManyRuledPenalty: number;
  splitSingleExtraColumnPenalty: number;
  splitSingleSharedCompetePenalty: number;
  splitSingleSharedCompeteThreshold: number;
  sharedRailBase: number;
  /** Cap shared_rail when every ruled stack (incl. first) is uniform per-column product width. */
  perColumnUniformSharedCap: number;
  perColumnUniformMaxCv: number;
  perColumnFirstVsOtherWidthMaxRatio: number;
  sharedRailProductLikeBoost: number;
  sharedRailTightCvMax: number;
  sharedRailTightCvBoost: number;
  sharedRailLooseCvMax: number;
  sharedRailLooseCvBoost: number;
  sharedRailWideFirstBoost: number;
  sharedRailLabelRailFracMin: number;
  sharedRailLabelRailFracMax: number;
  sharedRailNarrowFirstVsMedianRatio: number;
  sharedRailRailShapedBoost: number;
  sharedRailWideLowRuleBoost: number;
  sharedRailFirstVsMedianWideRatio: number;
  sharedRailInkAsymmetryThresholdLo: number;
  sharedRailInkAsymmetryBoostLo: number;
  sharedRailInkAsymmetryThresholdHi: number;
  sharedRailInkAsymmetryBoostHi: number;
  sharedRailManyColumnPenalty: number;
  sharedRailManyColumnMin: number;
  perColumnMinRunner: number;
  perColumnBase: number;
  perColumnCountBoost: number;
  perColumnUniformCvMax: number;
  perColumnUniformCvBoost: number;
  perColumnRuledFirstBoost: number;
  perColumnRailShapedPenalty: number;
  perColumnLabelRailFracMin: number;
  perColumnLabelRailFracMax: number;
  perColumnFirstNarrowVsMedianRatio: number;
};

const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_LAYOUT_HYPOTHESIS_SCORE_WEIGHTS: LayoutHypothesisScoreWeights = {
  unknownFloor: 0.05,
  splitSingleFocusBoost: 0.38,
  splitSingleLowPeakBoost: 0.22,
  splitSingleFitBoost: 0.28,
  splitSingleManyRuledPenalty: 0.35,
  splitSingleExtraColumnPenalty: 0.12,
  splitSingleSharedCompetePenalty: 0.25,
  splitSingleSharedCompeteThreshold: 0.45,
  sharedRailBase: 0.1,
  perColumnUniformSharedCap: 0.28,
  perColumnUniformMaxCv: 0.15,
  perColumnFirstVsOtherWidthMaxRatio: 1.08,
  sharedRailProductLikeBoost: 0.25,
  sharedRailTightCvMax: 0.08,
  sharedRailTightCvBoost: 0.2,
  sharedRailLooseCvMax: 0.15,
  sharedRailLooseCvBoost: 0.08,
  sharedRailWideFirstBoost: 0.3,
  sharedRailLabelRailFracMin: 0.1,
  sharedRailLabelRailFracMax: 0.32,
  sharedRailNarrowFirstVsMedianRatio: 0.95,
  sharedRailRailShapedBoost: 0.32,
  sharedRailWideLowRuleBoost: 0.28,
  sharedRailFirstVsMedianWideRatio: 0.85,
  sharedRailInkAsymmetryThresholdLo: 1.15,
  sharedRailInkAsymmetryBoostLo: 0.22,
  sharedRailInkAsymmetryThresholdHi: 1.35,
  sharedRailInkAsymmetryBoostHi: 0.12,
  sharedRailManyColumnPenalty: 0.15,
  sharedRailManyColumnMin: 6,
  perColumnMinRunner: 0.08,
  perColumnBase: 0.15,
  perColumnCountBoost: 0.2,
  perColumnUniformCvMax: 0.12,
  perColumnUniformCvBoost: 0.25,
  perColumnRuledFirstBoost: 0.15,
  perColumnRailShapedPenalty: 0.4,
  perColumnLabelRailFracMin: 0.1,
  perColumnLabelRailFracMax: 0.28,
  perColumnFirstNarrowVsMedianRatio: 0.92,
};

export const DEFAULT_LABEL_TABLE_LAYOUT_PARAMS: LabelTableLayoutParams = {
  minWinningScore: 0.42,
  minScoreMargin: 0.1,
  splitSeamSearchInsetFraction: 0.15,
  sharedRailFitMaxWidthCv: 28 / W,
  interiorGutterInsetFraction: 0.14,
  interiorGutterPenaltyPerHit: 0.1,
  maxInteriorGutterPenalty: 0.45,
  gutterBoundaryToleranceFraction: 6 / W,
  subtypePickScoreCeiling: 0.35,
  subtypePickMarginCeiling: 0.08,
  subtypeScoreTieMargin: 0.04,
  inkRailPreferScoreTieEpsilon: 2 / W,
  labelRailMinWidthRatio: 1.35,
  hypothesisScores: DEFAULT_LAYOUT_HYPOTHESIS_SCORE_WEIGHTS,
};
