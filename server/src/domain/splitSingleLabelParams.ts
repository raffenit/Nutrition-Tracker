import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

/** Two strips must be within this ratio to count as equal halves of one label. */
export const SPLIT_LABEL_WIDTH_RATIO_MIN = 0.48;

export const SPLIT_LABEL_WIDTH_RATIO_MAX = 1 / SPLIT_LABEL_WIDTH_RATIO_MIN;

/** Minimum value lines when classifying product columns (shared grid stitch). */
export const SHARED_GRID_MIN_VALUE_LINES_PER_COLUMN = 2;

export type SplitSingleLabelParams = {
  widthRatioMin: number;
  widthRatioMax: number;
};

export const DEFAULT_SPLIT_SINGLE_LABEL_PARAMS: SplitSingleLabelParams = {
  widthRatioMin: SPLIT_LABEL_WIDTH_RATIO_MIN,
  widthRatioMax: SPLIT_LABEL_WIDTH_RATIO_MAX,
};
