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
  /** Vertical gutter: ink probe spans up to this many gutter run widths. */
  verticalGutterInkProbeGutterWidths: number;
  /** Vertical gutter: leading edge margin as fraction of min gutter spacing. */
  verticalGutterInkEdgeMarginOfMinSpacing: number;
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
  verticalGutterInkProbeGutterWidths: 4,
  verticalGutterInkEdgeMarginOfMinSpacing: 0.35,
};
