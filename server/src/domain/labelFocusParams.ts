import { IMAGE_ANALYSIS_WIDTH, IMAGE_MIN_ANALYSIS_HEIGHT_FRACTION, IMAGE_MIN_ANALYSIS_WIDTH_FRACTION } from './imageAnalysisGeometry.js';

/** When high-sharpness spans less than this fraction of analysis width, treat as one intentional subject. */
export const SINGLE_SUBJECT_FOCUS_MAX_WIDTH_FRACTION = 0.52;

/** Column must reach this fraction of peak sharpness to count as in-focus. */
export const FOCUS_COLUMN_THRESHOLD_RATIO = 0.55;

/** Many separated sharp peaks across the width suggests a multi-column table in focus (variety pack). */
export const MULTI_COLUMN_FOCUS_MIN_PEAKS = 18;

/** Expand in-focus horizontal bounds slightly so label edges stay inside the crop. */
export const FOCUS_REGION_MARGIN_FRACTION = 0.04;

/**
 * Apply horizontal focus crop when the sharp band is narrower than this (variety packs
 * often stay near 0.85–0.95 and should keep full width).
 */
export const FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION = 0.92;

/** Absolute floor — reject focus bounds that would leave a useless sliver (not “sharp band is narrow”). */
export const FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION = 128 / IMAGE_ANALYSIS_WIDTH;

export const FOCUS_HINT_ANALYSIS = {
  analysisWidth: IMAGE_ANALYSIS_WIDTH,
  minAnalysisWidthFraction: IMAGE_MIN_ANALYSIS_WIDTH_FRACTION,
  minAnalysisHeightFraction: IMAGE_MIN_ANALYSIS_HEIGHT_FRACTION,
};
