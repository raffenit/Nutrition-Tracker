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
  /**
   * Accepted label rail width as a fraction of analysis width (independent of product columns).
   * The shared label column is not subject to {@link maxValueColumnWidthCv}.
   */
  labelColumnMinWidthFraction: number;
  labelColumnMaxWidthFraction: number;
  /** Minimum product value columns (excluding the shared label column). */
  minValueColumns: number;
  /** Coefficient of variation cap for **product value** column widths only. */
  maxValueColumnWidthCv: number;
  /** Optional header band over the value grid (product names). */
  headerBandHeightFraction: number;
  /** Product-name header: at most this many OCR row bands (variety packs are usually one title block). */
  headerMaxRowBandSlices: number;
  /** Ignore header interior rules closer than this × header band height (stops text-line ink → fake rows). */
  headerMinInteriorRuleSpacingSpanFraction: number;
  /** Rules below this fraction of header height are the nutrient grid top rule, not a product-name row. */
  headerMaxInteriorRuleSpanFraction: number;
  /** Keep header rules this close to body top (fraction of header span) — e.g. % Daily Value band. */
  headerKeepRuleNearBodySpanFraction: number;
  /**
   * Add label-rail-only rules to the consensus mesh only when the nearest consensus rules bracket a gap
   * wider than this × row pitch (avoids double hairlines / glyph ink between existing rules).
   */
  labelRailMeshGapFillMinSpanPitchFraction: number;
  /** When row bands are missing, shrink body crop by this fraction of band height (skip footer). */
  bodyFooterMarginFraction: number;
  /** Extend body when this much band (× row pitch) remains below last rule — captures final nutrient row before footnote. */
  nutrientBodyTrailingRowMinGapPitchFraction: number;
  nutrientBodyTrailingRowMaxGapPitchFraction: number;
  /** Use row-band slice OCR when at least this many horizontal slices exist. */
  minRowBandSlicesForRowOcr: number;
  /** When per-column row tops differ by less than pitch × this, use one shared horizontal mesh (straight tables). */
  rowSurfaceStraightSpreadPitchFraction: number;
  /**
   * Keep each column's own row band tops/heights when within pitch × this of consensus (do not clone reference slices).
   */
  rowSurfaceLocalGeometryTolerancePitchFraction: number;
  /** Widen ruled value-column x bounds outward by this fraction of column width (capped at neighbor midpoints). */
  valueColumnAnalysisBoundsExpandFraction: number;
  /** Max per-side x shift when snapping column bounds to body-band ink (× column width). */
  valueColumnAnalysisBoundsInkSnapFraction: number;
  /** Ink column occupancy along x to treat a scan line as “content” during body ink snap. */
  valueColumnAnalysisBoundsInkOccupancyFraction: number;
  /** Nutrient-body vertical span (fractions of body height) for column ink snap — skips preamble/rules. */
  valueColumnAnalysisBoundsInkSnapBodyFraction: { y0: number; y1: number };
  /** Min analysis width vs median product column after ink snap (flags fan/truncation). */
  valueColumnAnalysisBoundsMinToMedianWidthFraction: number;
  /** Max analysis width vs median before ruled stacks are trimmed (foreshortened fan false merge). */
  valueColumnAnalysisBoundsMaxToMedianWidthFraction: number;
  /** Build skewed row quads when left/right rule edges differ by at least this many px. */
  rowSurfaceSkewMinPx: number;
  /** Do not warp when left/right edge delta exceeds pitch × this (spurious substrip ink). */
  rowSurfaceSkewMaxPitchFraction: number;
  /** Curved outer value columns: allow trapezoid skew up to pitch × this (perspective fan). */
  rowSurfaceSkewOuterColumnMaxPitchFraction: number;
  /** Max uniform column vertical shift vs consensus (× row pitch); e.g. 0.5 ≈ half a row on curved packs. */
  rowSurfaceWarpMaxDriftPitchFraction: number;
  /** Min matched mesh/local rule pairs before applying column warp. */
  rowSurfaceWarpMinMatchedRules: number;
  /** Skip row warp when glare cluster mass in the column body exceeds this (see {@link columnBodyGlareMassFraction}). */
  rowSurfaceWarpMaxGlareMassFraction: number;
  /** Skip row warp when this fraction of body pixels sits at/above the glare cap. */
  rowSurfaceWarpMaxGlareBrightPixelFraction: number;
  /** Localized specular: flag when any vertical band in the column exceeds this bright-pixel fraction. */
  rowSurfaceWarpMaxGlareBandBrightPixelFraction: number;
  /** Vertical bands scanned for localized glare along the nutrient body. */
  rowSurfaceGlareBodyBandCount: number;
  /** Ground-truth viz / tests: top fraction of a row band when {@link GlareGroundTruthRowRef} coverage is partial. */
  rowSurfaceGlareGroundTruthPartialBandFraction: number;
  /** Min overlap between an expected glare span and an untrusted mask band for regression checks. */
  rowSurfaceGlareGroundTruthBandOverlapMinFraction: number;
  /** Shift nutrient body top below the first ruled line (thick rule lower edge, not header text). */
  nutrientBodyBelowFirstRulePitchFraction: number;
  /** Value-column % Daily band height in the body preamble (× pitch), anchored from first nutrient rule. */
  nutrientBodyDailyValueBandPitchFraction: number;
  /** Floor height of the value-column % Daily band (× pitch); avoids hairline OCR cells. */
  nutrientBodyDailyValueBandMinPitchFraction: number;
  /** Minimum calories value band height (× pitch) from body top before % Daily row. */
  nutrientBodyCaloriesBandMinPitchFraction: number;
  /** Minimum share of body preamble height reserved for calorie digits (value columns). */
  nutrientBodyCaloriesMinPreambleFraction: number;
  /** Label rail: one text line of “Calories” copy below body top when no interior rule (× pitch). */
  labelBodyCaloriesTextRowPitchFraction: number;
  /** Row slice edges fall below detected rule ink by pitch × this (text stays above the line). */
  rowBandRuleBoundaryBiasPitchFraction: number;
  /** Grow short row bands up to pitch × this so cell-center text is not clipped (small tables). */
  rowBandSliceMinReadableHeightPitchFraction: number;
  /** Floor target height (px) when pitch × fraction is still too small for dense labels. */
  rowBandSliceMinReadableHeightFloorPx: number;
  /** Allow slight overlap into neighbor bands when expanding (px); see {@link rowBandSliceMinReadableHeightPitchFraction}. */
  rowBandSliceExpandOverlapPx: number;
  /** Collapse consensus rules closer than this fraction of median row pitch (double rules, noise). */
  rowBandRuleMinSpacingPitchFraction: number;
  /** Minimum slice height in full-image px; shorter bands merge with neighbors. */
  minRowBandSliceHeightPx: number;
  /** Minimum slice height as a fraction of median row pitch (used with minRowBandSliceHeightPx, whichever is larger). */
  minRowBandSliceHeightPitchFraction: number;
  /** Row-band OCR only when median slice height is at least this (image px). */
  rowBandOcrMinMedianSliceHeightPx: number;
  /** Row-band OCR only when median slice height ≤ row pitch × this (one nutrient row per band). */
  rowBandMaxMedianSlicePitchRatio: number;
  /** Merge row bands only when shorter than pitch × this (double-rule slivers; not whole rows). */
  rowBandMergeHairlinePitchFraction: number;
  /** Warp columns: realign supplemental/footer rows to consensus when drift exceeds pitch × this. */
  warpNutrientTailAlignRowCount: number;
  /** Curved outer columns: only snap vitamin/mineral tail rows to consensus (macros keep ink geometry). */
  warpNutrientSupplementalTailAlignRowCount: number;
  warpNutrientTailMaxTopDriftPitchFraction: number;
  /** Warp finalize: snap rows shorter than pitch × this back to consensus (saturated fat hairlines). */
  warpUndersizedNutrientRowMinPitchFraction: number;
  /** Split a slice when height exceeds pitch × this (same scale as {@link rowBandMaxMedianSlicePitchRatio}). */
  rowBandSplitOversizedPitchRatio: number;
  /** Pitch-based chop only when height exceeds pitch × this (clearly multi-row, no interior rules). */
  rowBandPitchSubdivideMinMultiplier: number;
  /** Min readable row-band crop height as a fraction of {@link rowPitchPx}. */
  rowBandMinOcrExtractHeightPitchFraction: number;
  /** Min readable row-band crop width as a fraction of full-image width (see {@link IMAGE_ANALYSIS_WIDTH}). */
  rowBandMinOcrExtractWidthImageFraction: number;
  /** Min row-band crop width as a fraction of {@link rowPitchPx} (whichever is larger with image fraction, capped at column width). */
  rowBandMinOcrExtractWidthPitchFraction: number;
  /** Deskew row-band OCR crops when mean edge skew implies at least this baseline angle (deg). */
  rowBandDeskewMinAngleDeg: number;
  /** Skip deskew beyond this angle — likely a detection artifact, not pack curvature (deg). */
  rowBandDeskewMaxAngleDeg: number;
  /** Row-band slice edge cleanup: scan this fraction of slice width at each edge for vertical rules. */
  rowBandEdgeRuleScanEdgeFraction: number;
  /** A vertical rule spans at least this fraction of slice rows to count as chrome, not text. */
  rowBandEdgeRuleMinDarkRowFraction: number;
  /** Pixels darker than this luminance count toward a rule's vertical coverage. */
  rowBandEdgeRuleDarkLuminance: number;
  /** Rules wider than this fraction of slice width are not edge chrome (glare/text blocks). */
  rowBandEdgeRuleMaxWidthFraction: number;
  /** Margin around detected label+value grid when cropping previews and OCR bands (fraction of image width). */
  gridEnvelopeMarginImageFraction: number;
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
  headerMaxRowBandSlices: 2,
  headerMinInteriorRuleSpacingSpanFraction: 0.28,
  headerMaxInteriorRuleSpanFraction: 0.72,
  headerKeepRuleNearBodySpanFraction: 0.32,
  labelRailMeshGapFillMinSpanPitchFraction: 1.35,
  bodyFooterMarginFraction: 0.1,
  nutrientBodyTrailingRowMinGapPitchFraction: 0.35,
  nutrientBodyTrailingRowMaxGapPitchFraction: 1.75,
  minRowBandSlicesForRowOcr: 3,
  rowSurfaceStraightSpreadPitchFraction: 0.22,
  rowSurfaceLocalGeometryTolerancePitchFraction: 0.1,
  valueColumnAnalysisBoundsExpandFraction: 0.1,
  valueColumnAnalysisBoundsInkSnapFraction: 0.15,
  valueColumnAnalysisBoundsInkOccupancyFraction: 0.06,
  valueColumnAnalysisBoundsInkSnapBodyFraction: { y0: 0.32, y1: 0.88 },
  valueColumnAnalysisBoundsMinToMedianWidthFraction: 0.85,
  valueColumnAnalysisBoundsMaxToMedianWidthFraction: 1.05,
  rowSurfaceSkewMinPx: 4,
  rowSurfaceSkewMaxPitchFraction: 0.15,
  rowSurfaceSkewOuterColumnMaxPitchFraction: 1.35,
  rowSurfaceWarpMaxDriftPitchFraction: 0.5,
  rowSurfaceWarpMinMatchedRules: 5,
  rowSurfaceWarpMaxGlareMassFraction: 14 / W,
  rowSurfaceWarpMaxGlareBrightPixelFraction: 32 / W,
  rowSurfaceWarpMaxGlareBandBrightPixelFraction: 56 / W,
  rowSurfaceGlareBodyBandCount: 14,
  rowSurfaceGlareGroundTruthPartialBandFraction: 0.35,
  rowSurfaceGlareGroundTruthBandOverlapMinFraction: 0.15,
  nutrientBodyBelowFirstRulePitchFraction: 0.42,
  nutrientBodyDailyValueBandPitchFraction: 0.55,
  nutrientBodyDailyValueBandMinPitchFraction: 0.78,
  nutrientBodyCaloriesBandMinPitchFraction: 1.02,
  nutrientBodyCaloriesMinPreambleFraction: 0.88,
  labelBodyCaloriesTextRowPitchFraction: 0.95,
  rowBandRuleBoundaryBiasPitchFraction: 0.12,
  rowBandSliceMinReadableHeightPitchFraction: 0.9,
  rowBandSliceMinReadableHeightFloorPx: 46,
  rowBandSliceExpandOverlapPx: 4,
  rowBandRuleMinSpacingPitchFraction: 0.5,
  minRowBandSliceHeightPx: 12,
  minRowBandSliceHeightPitchFraction: 0.42,
  rowBandOcrMinMedianSliceHeightPx: 16,
  rowBandMaxMedianSlicePitchRatio: 1.22,
  rowBandMergeHairlinePitchFraction: 0.38,
  warpNutrientTailAlignRowCount: 7,
  warpNutrientSupplementalTailAlignRowCount: 4,
  warpNutrientTailMaxTopDriftPitchFraction: 0.2,
  warpUndersizedNutrientRowMinPitchFraction: 0.72,
  rowBandSplitOversizedPitchRatio: 1.22,
  rowBandPitchSubdivideMinMultiplier: 2.35,
  rowBandMinOcrExtractHeightPitchFraction: 0.55,
  rowBandMinOcrExtractWidthImageFraction: 48 / W,
  rowBandMinOcrExtractWidthPitchFraction: 0.65,
  rowBandDeskewMinAngleDeg: 0.35,
  rowBandDeskewMaxAngleDeg: 6,
  rowBandEdgeRuleScanEdgeFraction: 0.15,
  rowBandEdgeRuleMinDarkRowFraction: 0.7,
  rowBandEdgeRuleDarkLuminance: 140,
  rowBandEdgeRuleMaxWidthFraction: 0.04,
  gridEnvelopeMarginImageFraction: 20 / W,
  valueGutterThresholdRatio: 0.48,
  valueRawGutterSpacingFraction: 3 / W,
  valueColumnMinSpacingFraction: 48 / W,
};
