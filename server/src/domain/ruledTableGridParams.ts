import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

/**
 * Ruled variety tables: per-column horizontal rules + vertical gutters (bright gaps).
 * Line geometry — not text tokens.
 */
export type RuledTableGridParams = {
  /** Skip top of band when profiling (product names / title). */
  valueRowScanTopSkipFraction: number;
  /** Skip bottom of band (footnotes). */
  valueRowScanBottomSkipFraction: number;
  /** Gutter column means must exceed this fraction of classified paper background luminance. */
  gutterBrightnessMinFraction: number;
  /** Minimum gutter width as fraction of value-region width. */
  gutterMinWidthFraction: number;
  /** Minimum spacing between gutter centers (fraction of value-region width). */
  gutterMinSpacingFraction: number;
  /** Minimum horizontal rule peaks inside a column (validates ruled stack). */
  minHorizontalRulesPerColumn: number;
  /** Horizontal rule: edge strength must exceed this fraction of column peak. */
  horizontalRuleThresholdFraction: number;
  /** Minimum column width as fraction of value-region width. */
  minColumnWidthFraction: number;
  /** Max width CV among product columns before spurious gutter trim is skipped. */
  trimSpuriousColumnMaxUniformCv: number;
  /** Horizontal rule level: median edge strength multiplier. */
  horizontalRuleMedianMultiplier: number;
  /** Horizontal rule level: fraction of column peak (with median term). */
  horizontalRulePeakLevelFraction: number;
  /** Ignore scan rows where this fraction of pixels are at/above {@link BandLuminanceRoles.glareCap}. */
  horizontalRuleScanRowGlareBrightFraction: number;
  /** Drop edge runs whose peak strength is below this fraction of the column peak (glyph vs full-width rule). */
  horizontalRuleRunMinPeakFraction: number;
  /** Section dividers must also meet this peak fraction (thick glyph blocks are not dividers). */
  ruleSectionDividerMinPeakFraction: number;
  /** In the main nutrient body, rule ink is at most this × row pitch (hairlines — typically ≤ ½ row). */
  horizontalRuleMaxThicknessPitchFraction: number;
  /** Compare nutrient thickness with a little extra slack (× pitch). */
  horizontalRuleThicknessSlopPitchFraction: number;
  /** Boundary offset below a rule run, as a fraction of run height. */
  horizontalRuleBoundaryWithinRunFraction: number;
  /** Margin when comparing rule Y to body top / bottom (fraction of analysis band height). */
  bodyRuleYMarginBandFraction: number;
  /** Fallback row pitch when spacing cannot be estimated (fraction of analysis band height). */
  defaultRowPitchBandFraction: number;
  /** Vertical gutter: ink probe spans up to this many gutter run widths. */
  verticalGutterInkProbeGutterWidths: number;
  /** Vertical gutter: leading edge margin as fraction of min gutter spacing. */
  verticalGutterInkEdgeMarginOfMinSpacing: number;
  /** Rule runs at least this thick vs median classify as section boundaries (header). */
  ruleThickVsMedianThicknessRatio: number;
  /** Header zone for thick section rules — fraction of analysis band height from top. */
  headerSectionMaxHeightFraction: number;
  /** Below body top: never treat rules inside this × row pitch as section dividers (% Daily Value zone). */
  bodyPreambleMaxHeightPitchFraction: number;
  /**
   * Minimum width (fraction of label boundary x) kept inside the crop for the shared nutrient-name
   * rail — allows cropping packaging left of the ruled box without clipping into value columns.
   */
  nutritionTableMinLabelRailWidthFraction: number;
  /** Minimum cropped analysis width (fraction of band width) before horizontal grid crop is applied. */
  nutritionTableMinCropSpanWidthFraction: number;
};

const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_RULED_TABLE_GRID_PARAMS: RuledTableGridParams = {
  valueRowScanTopSkipFraction: 0.12,
  valueRowScanBottomSkipFraction: 0.1,
  gutterBrightnessMinFraction: 0.88,
  gutterMinWidthFraction: 2 / W,
  gutterMinSpacingFraction: 40 / W,
  minHorizontalRulesPerColumn: 4,
  horizontalRuleThresholdFraction: 0.42,
  minColumnWidthFraction: 28 / W,
  trimSpuriousColumnMaxUniformCv: 0.14,
  horizontalRuleMedianMultiplier: 2.5,
  horizontalRulePeakLevelFraction: 0.28,
  horizontalRuleScanRowGlareBrightFraction: 72 / W,
  horizontalRuleRunMinPeakFraction: 0.3,
  ruleSectionDividerMinPeakFraction: 0.52,
  horizontalRuleMaxThicknessPitchFraction: 0.5,
  horizontalRuleThicknessSlopPitchFraction: 0.06,
  horizontalRuleBoundaryWithinRunFraction: 0.55,
  bodyRuleYMarginBandFraction: 2 / W,
  defaultRowPitchBandFraction: 12 / W,
  verticalGutterInkProbeGutterWidths: 4,
  verticalGutterInkEdgeMarginOfMinSpacing: 0.35,
  ruleThickVsMedianThicknessRatio: 1.12,
  headerSectionMaxHeightFraction: 200 / W,
  bodyPreambleMaxHeightPitchFraction: 2.4,
  nutritionTableMinLabelRailWidthFraction: 0.28,
  nutritionTableMinCropSpanWidthFraction: 32 / W,
};
