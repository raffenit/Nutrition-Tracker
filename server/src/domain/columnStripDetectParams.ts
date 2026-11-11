import { IMAGE_ANALYSIS_WIDTH, IMAGE_MIN_SIDE_FRACTION } from './imageAnalysisGeometry.js';

/**
 * Resolution-invariant geometry for variety-pack column-strip detection.
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
  /** Floor on band height as a fraction of full image height. */
  minBandHeightFloorFraction: number;
  /** Gutter minima must sit below this fraction of peak column ink in the profile. */
  gutterThresholdRatio: number;
  /** Minimum spacing between gutter minima, as a fraction of analysis width. */
  minGutterSpacingFraction: number;
  /** Profile smoothing radius, as a fraction of analysis width. */
  smoothRadiusFraction: number;
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
  minBandHeightFloorFraction: 32 / 480,
  gutterThresholdRatio: 0.22,
  minGutterSpacingFraction: 28 / W,
  smoothRadiusFraction: 7 / W,
  minStripWidthFraction: 0.06,
  minSegmentWidthFraction: 4 / W,
  minOutputStripWidthFraction: 8 / W,
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
