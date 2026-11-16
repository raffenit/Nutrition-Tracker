import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';
import { LABEL_PANEL_MIN_HORIZONTAL_RULES } from './labelImageCropPolicy.js';

export type NutritionFactsLabelShapeParams = {
  analysisWidth: number;
  minHorizontalRules: number;
  /** Top band of the crop where a full panel should show the Nutrition Facts heading block. */
  headerBandTopFraction: number;
  /** Header-band row edge must reach this fraction of the crop’s peak row edge. */
  headerBandMinEdgeFractionOfPeak: number;
  /** First prominent horizontal rule should sit in this band (below heading, above mid-body). */
  firstRuleMinYFraction: number;
  firstRuleMaxYFraction: number;
  /** Skip profiling near footer (DV footnote). */
  scanBottomSkipFraction: number;
  rowEdgeThresholdFractionOfPeak: number;
  minRulePeakFractionOfRun: number;
};

export const DEFAULT_NUTRITION_FACTS_LABEL_SHAPE_PARAMS: NutritionFactsLabelShapeParams = {
  analysisWidth: IMAGE_ANALYSIS_WIDTH,
  minHorizontalRules: LABEL_PANEL_MIN_HORIZONTAL_RULES,
  headerBandTopFraction: 0.14,
  headerBandMinEdgeFractionOfPeak: 0.32,
  firstRuleMinYFraction: 0.1,
  firstRuleMaxYFraction: 0.45,
  scanBottomSkipFraction: 0.08,
  rowEdgeThresholdFractionOfPeak: 0.38,
  minRulePeakFractionOfRun: 0.45,
};

export function resolveNutritionFactsLabelShapeParams(
  partial?: Partial<NutritionFactsLabelShapeParams>,
): NutritionFactsLabelShapeParams {
  return partial ? { ...DEFAULT_NUTRITION_FACTS_LABEL_SHAPE_PARAMS, ...partial } : DEFAULT_NUTRITION_FACTS_LABEL_SHAPE_PARAMS;
}