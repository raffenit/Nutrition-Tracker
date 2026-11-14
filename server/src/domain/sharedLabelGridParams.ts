import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

/**
 * Geometry for “shared row labels on the left + numeric value columns” variety tables.
 * Fractions are of analysis width or band height — not tied to a particular photo.
 */
export type SharedLabelGridParams = {
  /** Search for label-column boundary in this horizontal range (analysis x). */
  labelSearchMinFraction: number;
  labelSearchMaxFraction: number;
  /** Boundary when ink falls below this fraction of the left-side peak. */
  labelBoundaryInkDropRatio: number;
  /** Mean ink left of boundary must exceed right side by this ratio. */
  labelInkAsymmetryRatio: number;
  /**
   * Accepted label rail width as a fraction of analysis width (independent of product columns).
   * The shared label column is not subject to {@link maxValueColumnWidthCv}.
   */
  labelColumnMinWidthFraction: number;
  labelColumnMaxWidthFraction: number;
  /** Minimum product value columns (excluding the shared label column). */
  minValueColumns: number;
  /** Coefficient of variation cap for **product value** column widths only. */
  maxValueColumnWidthCv: number;
  /** Optional header band over the value grid (product names). */
  headerBandHeightFraction: number;
  /** When row bands are missing, shrink body crop by this fraction of band height (skip footer). */
  bodyFooterMarginFraction: number;
  /** Use row-band slice OCR when at least this many horizontal slices exist. */
  minRowBandSlicesForRowOcr: number;
  /** Collapse consensus rules closer than this fraction of median row pitch (double rules, noise). */
  rowBandRuleMinSpacingPitchFraction: number;
  /** Minimum slice height in full-image px; shorter bands merge with neighbors. */
  minRowBandSliceHeightPx: number;
  /** Minimum slice height as a fraction of median row pitch (used with minRowBandSliceHeightPx, whichever is larger). */
  minRowBandSliceHeightPitchFraction: number;
  /** Row-band OCR only when median slice height is at least this (image px). */
  rowBandOcrMinMedianSliceHeightPx: number;
  /** Row-band OCR only when median slice height ≤ row pitch × this (one nutrient row per band). */
  rowBandMaxMedianSlicePitchRatio: number;
  /** Merge row bands only when shorter than pitch × this (double-rule slivers; not whole rows). */
  rowBandMergeHairlinePitchFraction: number;
  /** Split a slice when height exceeds pitch × this (same scale as {@link rowBandMaxMedianSlicePitchRatio}). */
  rowBandSplitOversizedPitchRatio: number;
  /** Pitch-based chop only when height exceeds pitch × this (clearly multi-row, no interior rules). */
  rowBandPitchSubdivideMinMultiplier: number;
  /** Min readable row-band crop height as a fraction of {@link rowPitchPx}. */
  rowBandMinOcrExtractHeightPitchFraction: number;
  /** Min readable row-band crop width as a fraction of full-image width (see {@link IMAGE_ANALYSIS_WIDTH}). */
  rowBandMinOcrExtractWidthImageFraction: number;
  /** Min row-band crop width as a fraction of {@link rowPitchPx} (whichever is larger with image fraction, capped at column width). */
  rowBandMinOcrExtractWidthPitchFraction: number;
  /** Sparse value grid: gutter level as fraction of value-region profile peak. */
  valueGutterThresholdRatio: number;
  /** Minimum spacing between raw gutter candidates (fraction of value profile length). */
  valueRawGutterSpacingFraction: number;
  /** Minimum spacing between accepted product gutters (fraction of value profile length). */
  valueColumnMinSpacingFraction: number;
};

const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_SHARED_LABEL_GRID_PARAMS: SharedLabelGridParams = {
  labelSearchMinFraction: 32 / W,
  labelSearchMaxFraction: 288 / W,
  labelBoundaryInkDropRatio: 0.52,
  labelInkAsymmetryRatio: 1.08,
  labelColumnMinWidthFraction: 48 / W,
  labelColumnMaxWidthFraction: 288 / W,
  minValueColumns: 3,
  maxValueColumnWidthCv: 0.95,
  headerBandHeightFraction: 0.14,
  bodyFooterMarginFraction: 0.1,
  minRowBandSlicesForRowOcr: 3,
  rowBandRuleMinSpacingPitchFraction: 0.36,
  minRowBandSliceHeightPx: 12,
  minRowBandSliceHeightPitchFraction: 0.42,
  rowBandOcrMinMedianSliceHeightPx: 16,
  rowBandMaxMedianSlicePitchRatio: 1.22,
  rowBandMergeHairlinePitchFraction: 0.38,
  rowBandSplitOversizedPitchRatio: 1.22,
  rowBandPitchSubdivideMinMultiplier: 2.35,
  rowBandMinOcrExtractHeightPitchFraction: 0.55,
  rowBandMinOcrExtractWidthImageFraction: 48 / W,
  rowBandMinOcrExtractWidthPitchFraction: 0.65,
  valueGutterThresholdRatio: 0.48,
  valueRawGutterSpacingFraction: 3 / W,
  valueColumnMinSpacingFraction: 48 / W,
};
