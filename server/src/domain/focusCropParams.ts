import {
  IMAGE_ANALYSIS_WIDTH,
  IMAGE_MIN_ANALYSIS_HEIGHT_FRACTION,
  IMAGE_MIN_ANALYSIS_WIDTH_FRACTION,
  IMAGE_MIN_CROP_SIDE_FRACTION,
  IMAGE_MIN_SIDE_FRACTION,
} from './imageAnalysisGeometry.js';

export type FocusCropParams = {
  analysisWidth: number;
  /** Skip focus variants when width or height is below this fraction of {@link analysisWidth}. */
  minImageSideFraction: number;
  /** Floor on center/laplacian crop width and height. */
  minCropSideFraction: number;
  centerBandHeightFraction: number;
  centerBandWidthFraction: number;
  /** Laplacian row-window height (analysis space), primary fraction of analysis height. */
  laplacianBandHeightFraction: number;
  /** Minimum laplacian window rows as a fraction of analysis height. */
  laplacianBandMinHeightFraction: number;
  laplacianVerticalMarginFraction: number;
  guidedCropWidthFraction: number;
  /** Return no laplacian crop when the box would cover this much of the image. */
  nearFullImageFraction: number;
  minAnalysisWidthFraction: number;
  minAnalysisHeightFraction: number;
};

export const DEFAULT_FOCUS_CROP_PARAMS: FocusCropParams = {
  analysisWidth: IMAGE_ANALYSIS_WIDTH,
  minImageSideFraction: IMAGE_MIN_SIDE_FRACTION,
  minCropSideFraction: IMAGE_MIN_CROP_SIDE_FRACTION,
  centerBandHeightFraction: 0.62,
  centerBandWidthFraction: 0.88,
  laplacianBandHeightFraction: 0.55,
  laplacianBandMinHeightFraction: 8 / IMAGE_ANALYSIS_WIDTH,
  laplacianVerticalMarginFraction: 0.04,
  guidedCropWidthFraction: 0.9,
  nearFullImageFraction: 0.95,
  minAnalysisWidthFraction: IMAGE_MIN_ANALYSIS_WIDTH_FRACTION,
  minAnalysisHeightFraction: IMAGE_MIN_ANALYSIS_HEIGHT_FRACTION,
};

export type FocusCropOptions = {
  /** Keep full image width — variety-pack tables need side columns in OCR. */
  preserveFullWidth?: boolean;
  geometry?: Partial<FocusCropParams>;
};

export function resolveFocusCropParams(geometry?: Partial<FocusCropParams>): FocusCropParams {
  return geometry ? { ...DEFAULT_FOCUS_CROP_PARAMS, ...geometry } : DEFAULT_FOCUS_CROP_PARAMS;
}
