import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

export type VarietyPackGridPipelineParams = {
  /** Minimum vertical categories (ruled product stacks). */
  minProductColumns: number;
  /** Minimum horizontal rule runs to treat a column as a ruled product stack. */
  minHorizontalRulesPerProductColumn: number;
  /** Product column width CV cap (uniform grid). */
  maxProductColumnWidthCv: number;
  /** Header must occupy at least this fraction of band height. */
  headerMinHeightFraction: number;
  headerMaxHeightFraction: number;
  /** Shared label rail: first category width vs median product width. */
  sharedRailWidthRatioMin: number;
  /** Row mesh: minimum horizontal rule bands for stitch. */
  minRowBands: number;
  /** Row consensus: allowed y jitter across columns (fraction of band height). */
  rowConsensusMaxJitterFraction: number;
  /**
   * When horizontal rules are present on the label: wide spans with sparse body rules may be dropped as gutters.
   * No-op when the table has no horizontal-rule signal (rule-less labels rely on vertical/ink geometry only).
   * @deprecated Used only when ruled pixels are unavailable; prefer body-rule probe below.
   */
  glareGutterRuleShortfallFromMin: number;
  /** Min width vs median product to treat a ruled span as an empty gutter candidate. */
  glareGutterWideToMedianRatio: number;
  /** Min body horizontal rules to keep a wide span when rules are present on this label (ignored when absent). */
  wideRuledSpanMinBodyHorizontalRules: number;
  /** Body band starts below header (fraction of analysis height) for wide-span body rule probe. */
  wideRuledSpanBodyRuleProbeTopFraction: number;
  /** Interior ink gap above this × median product width → use ruled product column bounds. */
  valueColumnInkInteriorGapToMedianProductRatio: number;
};

const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS: VarietyPackGridPipelineParams = {
  minProductColumns: 3,
  minHorizontalRulesPerProductColumn: 3,
  maxProductColumnWidthCv: 0.95,
  headerMinHeightFraction: 4 / W,
  headerMaxHeightFraction: 200 / W,
  sharedRailWidthRatioMin: 1.35,
  minRowBands: 4,
  rowConsensusMaxJitterFraction: 24 / W,
  glareGutterRuleShortfallFromMin: 9,
  glareGutterWideToMedianRatio: 1.25,
  wideRuledSpanMinBodyHorizontalRules: 6,
  wideRuledSpanBodyRuleProbeTopFraction: 24 / W,
  valueColumnInkInteriorGapToMedianProductRatio: 1.15,
};
