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
  /** Accepted label column width as a fraction of analysis width. */
  labelColumnMinWidthFraction: number;
  labelColumnMaxWidthFraction: number;
  /** Minimum product value columns (excluding the shared label column). */
  minValueColumns: number;
  /** Coefficient of variation cap for value column widths (uniform grid). */
  maxValueColumnWidthCv: number;
  /** Optional header band over the value grid (product names). */
  headerBandHeightFraction: number;
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
  valueGutterThresholdRatio: 0.48,
  valueRawGutterSpacingFraction: 3 / W,
  valueColumnMinSpacingFraction: 48 / W,
};
