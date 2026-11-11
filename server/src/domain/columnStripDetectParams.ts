import { IMAGE_ANALYSIS_WIDTH, IMAGE_MIN_SIDE_FRACTION } from './imageAnalysisGeometry.js';

/**
 * Resolution-invariant geometry for wide multi-product column-strip detection (variety packs + fallback strips).
 *
 * Detection always projects ink on a band resampled to {@link analysisWidth} (canonical
 * horizontal space). Thresholds below are ratios of that space or of full-image dimensions —
 * not raw pixel constants tied to a particular photo DPI.
 */
export type ColumnStripDetectParams = {
  /** Canonical analysis canvas width (production resizes bands to this width when larger). */
  analysisWidth: number;
  /** Vertical band height as a fraction of full image height (post-rotate). */
  bandHeightFraction: number;
  /**
   * Wide-table **OCR** band only — detection ink projection stays vertically centered.
   * Fraction of full height from the top where OCR crops start.
   */
  bandTopInsetFraction: number;
  /** Floor on band height as a fraction of full image height. */
  minBandHeightFloorFraction: number;
  /** Gutter minima must sit below this fraction of peak column ink in the profile. */
  gutterThresholdRatio: number;
  /**
   * Gutter ink must be at least this fraction below the weaker neighboring column peak
   * (suppresses ripples inside a dense column).
   */
  gutterProminenceFraction: number;
  /** Floor when relaxing prominence — still need {@link minColumns} product strips. */
  gutterProminenceRelaxFraction: number;
  /** Minimum spacing between gutter minima, as a fraction of analysis width. */
  minGutterSpacingFraction: number;
  /** Local-minimum radius for gutter detection, as a fraction of analysis width. */
  gutterLocalMinimumRadiusFraction: number;
  /** Profile smoothing radius, as a fraction of analysis width. */
  smoothRadiusFraction: number;
  /** Mild linear contrast on the analysis band before ink projection (1 = none). */
  profileContrastSlope: number;
  /** Intercept paired with {@link profileContrastSlope} (0–255 scale). */
  profileContrastIntercept: number;
  /** Smallest column segment width, as a fraction of profile length (analysis width). */
  minStripWidthFraction: number;
  /** Smallest accepted segment after gutter split, as a fraction of analysis width. */
  minSegmentWidthFraction: number;
  /** Smallest strip width when mapped back to full-resolution coordinates. */
  minOutputStripWidthFraction: number;
  /** Reject when image width is below this fraction of {@link analysisWidth}. */
  minImageWidthFraction: number;
  /** Reject when image height is below this fraction of {@link analysisWidth}. */
  minImageHeightFraction: number;
  /** Floor on resampled analysis width, as a fraction of {@link analysisWidth}. */
  minAnalysisWidthFraction: number;
  /** Floor on resampled analysis height, as a fraction of {@link analysisWidth}. */
  minAnalysisHeightFraction: number;
  maxColumns: number;
};

/** Defaults match prior tuned behavior expressed as fractions of the 640px analysis canvas. */
const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_COLUMN_STRIP_DETECT_PARAMS: ColumnStripDetectParams = {
  analysisWidth: W,
  bandHeightFraction: 0.58,
  bandTopInsetFraction: 16 / W,
  minBandHeightFloorFraction: 32 / 480,
  gutterThresholdRatio: 0.52,
  gutterProminenceFraction: 0.35,
  gutterProminenceRelaxFraction: 0.14,
  minGutterSpacingFraction: 12 / W,
  gutterLocalMinimumRadiusFraction: 2 / W,
  smoothRadiusFraction: 2 / W,
  profileContrastSlope: 1.35,
  profileContrastIntercept: -25,
  minStripWidthFraction: 0.04,
  minSegmentWidthFraction: 2 / W,
  minOutputStripWidthFraction: 10 / W,
  minImageWidthFraction: 120 / W,
  minImageHeightFraction: IMAGE_MIN_SIDE_FRACTION,
  minAnalysisWidthFraction: 48 / W,
  minAnalysisHeightFraction: 32 / W,
  maxColumns: 12,
};

export type ColumnStripDetectOptions = {
  minColumns?: number;
  maxColumns?: number;
  minStripWidthFraction?: number;
  /** Skip wide-aspect gate (tests only). */
  requireWideAspect?: boolean;
  geometry?: Partial<ColumnStripDetectParams>;
};

export function resolveColumnStripParams(
  geometry?: Partial<ColumnStripDetectParams>,
): ColumnStripDetectParams {
  return geometry ? { ...DEFAULT_COLUMN_STRIP_DETECT_PARAMS, ...geometry } : DEFAULT_COLUMN_STRIP_DETECT_PARAMS;
}
