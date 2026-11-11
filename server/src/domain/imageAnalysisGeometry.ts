/**
 * Shared reference for image-structure heuristics (column strips, focus crop, layout hints).
 * Pixel counts in pipelines should derive from these widths and **fractions**, not bare magic numbers.
 */
export const IMAGE_ANALYSIS_WIDTH = 640;

/** Reject structure heuristics when either image side is below this fraction of {@link IMAGE_ANALYSIS_WIDTH}. */
export const IMAGE_MIN_SIDE_FRACTION = 80 / IMAGE_ANALYSIS_WIDTH;

/** Minimum resampled analysis width, as a fraction of {@link IMAGE_ANALYSIS_WIDTH}. */
export const IMAGE_MIN_ANALYSIS_WIDTH_FRACTION = 48 / IMAGE_ANALYSIS_WIDTH;

/** Minimum resampled analysis height, as a fraction of {@link IMAGE_ANALYSIS_WIDTH}. */
export const IMAGE_MIN_ANALYSIS_HEIGHT_FRACTION = 32 / IMAGE_ANALYSIS_WIDTH;

/** Minimum crop extract width/height, as a fraction of the corresponding full-image side. */
export const IMAGE_MIN_CROP_SIDE_FRACTION = 32 / IMAGE_ANALYSIS_WIDTH;

export function minSideLengthPx(analysisWidth = IMAGE_ANALYSIS_WIDTH): number {
  return Math.max(1, Math.round(analysisWidth * IMAGE_MIN_SIDE_FRACTION));
}

export function minCropSidePx(side: number, fraction = IMAGE_MIN_CROP_SIDE_FRACTION): number {
  return Math.max(1, Math.round(side * fraction));
}
