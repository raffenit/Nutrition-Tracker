import {
  consolidateRowBandRuleYs,
  mapAnalysisYToImageBand,
  medianConsecutiveSpacing,
  nutrientBodyExtents,
  rowBandRuleMinSpacingPx,
} from '../domain/sharedLabelGridLayout.js';
import {
  enforceValueColumnsDisjointFromLabel,
  enforceValueColumnAnalysisBoundsMinWidthVsMedian,
  imageValueColumnStripsFromAnalysisSegments,
  snapValueColumnAnalysisBoundsX0ToBodyInk,
  productValueSegmentsRightOfLabel,
  valueColumnAnalysisBoundsFromSharedVerticalRules,
  valueColumnAnalysisSegmentsAligned,
} from '../domain/sharedLabelColumnSeparation.js';
import { splitColumnSegmentsAtLocalVerticalGutters } from './labelTableLayoutFit.js';
import {
  DEFAULT_SHARED_LABEL_GRID_PARAMS,
  type SharedLabelGridParams,
} from '../domain/sharedLabelGridParams.js';
import { cropWideBandAnalysisToNutritionGrid } from '../domain/cropWideBandAnalysisToNutritionGrid.js';
import { classifyNutritionTableBandLuminance } from '../domain/nutritionTableInkBounds.js';
import {
  DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS,
  type VarietyPackGridPipelineParams,
} from '../domain/varietyPackGridPipelineParams.js';
import {
  gated,
  gatedFail,
  stepValidation,
  type GatedStepResult,
  type VarietyPackGridStepCode,
  type VarietyPackGridCategory,
  type VarietyPackGridPipelineResult,
  type VarietyPackGridStep1,
  type VarietyPackGridStep2,
  type VarietyPackGridStep3,
  type VarietyPackGridStep4,
  type VarietyPackGridStepValidation,
} from '../domain/varietyPackGridPipeline.js';
import { WIDE_PANEL_MIN_ASPECT, type LabelLayoutHint } from '../domain/labelLayout.js';
import { MULTI_COLUMN_FOCUS_MIN_PEAKS } from '../domain/labelFocusParams.js';
import {
  resolveColumnStripParams,
  type ColumnStripDetectOptions,
  type ColumnStripDetectParams,
} from '../domain/columnStripDetectParams.js';
import {
  buildColumnInkProfileFromBand,
  detectColumnStrips,
  prepareWideBandAnalysis,
  ruledGridBandPixels,
} from './labelColumnStrips.js';
import { buildPerColumnRowBandSlicePlan } from '../domain/sharedLabelRowRegions.js';
import {
  categoriesFromRuledGrid,
  augmentBodyRowBandYsWithLabelRail,
  augmentBodyRowBandYsWithTailAnchors,
  consensusBodyRowBandYs,
  maxBodyHorizontalRuleYAnalysis,
  consensusBodyTopY,
  consensusHeaderRowBandYs,
  consensusRuleInkRuns,
  horizontalRuleRowYsInColumn,
  sectionDividerBoundaryYsFromRuns,
} from './ruledTableGridDetect.js';
import { DEFAULT_SPLIT_SINGLE_LABEL_PARAMS } from '../domain/splitSingleLabelParams.js';
import { resolveLabelProcessingImage } from './imageLayoutHint.js';
import {
  columnWidthCv,
  detectEqualWidthColumnPair,
  firstColumnWideVsSiblings,
  medianPositiveWidth,
  trimTrailingIrregularValueColumns,
  type EqualWidthPair,
} from './uniformColumnGeometry.js';
import { DEFAULT_LABEL_TABLE_LAYOUT_PARAMS } from '../domain/labelTableLayoutParams.js';
import {
  collectColumnGeometryWitnesses,
  fitSplitSingleColumns,
  pickLeadingLayoutHypothesis,
  pickVarietyPackSubtype,
  scoreLayoutHypotheses,
} from './labelTableLayoutFit.js';
import {
  profileInkAsymmetryForLayoutScores,
  sharedRailLayoutFromInkProfile,
  type SharedLabelValueGridPlan,
} from './sharedLabelValueGrid.js';
import type { ColumnStripPlan, ColumnStripRegion } from './labelColumnStrips.js';

export type VarietyPackPipelineRunResult = VarietyPackGridPipelineResult & {
  plan: SharedLabelValueGridPlan | null;
  /** Full product-column crops when step 3 layout is `per_column_labels`. */
  perColumnStripPlan: ColumnStripPlan | null;
  ctx: VarietyPackBandContext | null;
};

export type VarietyPackGridPipelineOptions = ColumnStripDetectOptions & {
  sharedGeometry?: Partial<SharedLabelGridParams>;
  pipelineParams?: Partial<VarietyPackGridPipelineParams>;
  requireWideAspect?: boolean;
  /** When set, suppresses variety-pack routing for intentional single-label / split-half photos. */
  layoutHint?: Pick<LabelLayoutHint, 'singleSubjectInFocus' | 'sharpPeakCount'>;
  /** Stop after this step (inclusive). Used by diagnose / tests. */
  stopAfterStep?: 1 | 2 | 3 | 4;
};

export type VarietyPackBandContext = {
  bandAnalysis: NonNullable<Awaited<ReturnType<typeof prepareWideBandAnalysis>>>;
  ocrBand: { left: number; top: number; width: number; height: number };
  stripParams: ColumnStripDetectParams;
  shared: SharedLabelGridParams;
  pipeline: VarietyPackGridPipelineParams;
  maxColumns: number;
};

export async function prepareVarietyPackBandContext(
  bytes: Buffer,
  options?: VarietyPackGridPipelineOptions,
): Promise<VarietyPackBandContext | null> {
  const { bytes: labelBytes } = await resolveLabelProcessingImage(bytes);
  const stripParams = resolveColumnStripParams(options?.geometry);
  const shared = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, ...options?.sharedGeometry };
  const pipeline = { ...DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS, ...options?.pipelineParams };
  const maxColumns = options?.maxColumns ?? stripParams.maxColumns;
  const requireWide = options?.requireWideAspect ?? true;

  const bandAnalysis = await prepareWideBandAnalysis(labelBytes, stripParams, 'detection');
  if (!bandAnalysis) return null;
  if (requireWide && bandAnalysis.fullWidth / bandAnalysis.fullHeight < WIDE_PANEL_MIN_ASPECT) return null;

  const ocrBandAnalysis = await prepareWideBandAnalysis(labelBytes, stripParams, 'ocr');
  const ocrBand = ocrBandAnalysis?.band ?? bandAnalysis.band;

  const croppedDetection = cropWideBandAnalysisToNutritionGrid(bandAnalysis, shared);

  return { bandAnalysis: croppedDetection, ocrBand, stripParams, shared, pipeline, maxColumns };
}

/** Every product stack is ruled and there is no wide, low-rule left rail. */
function isPerColumnLabelLayout(step1: VarietyPackGridStep1, pipeline: VarietyPackGridPipelineParams): boolean {
  if (step1.productColumns.length < pipeline.minProductColumns) return false;
  const productWidths = step1.productColumns.map((col) => col.x1 - col.x0);
  if (columnWidthCv(productWidths) > pipeline.maxProductColumnWidthCv) return false;
  if (
    !step1.productColumns.every(
      (col) => col.horizontalRuleCount >= pipeline.minHorizontalRulesPerProductColumn,
    )
  ) {
    return false;
  }
  const first = step1.categories[0];
  if (!first) return false;
  const medianProduct = medianPositiveWidth(productWidths);
  const firstWidth = first.x1 - first.x0;
  const railLikeFirst =
    first.horizontalRuleCount < pipeline.minHorizontalRulesPerProductColumn &&
    firstColumnWideVsSiblings(firstWidth, productWidths, pipeline.sharedRailWidthRatioMin);
  const wideLeftRail = firstColumnWideVsSiblings(
    firstWidth,
    productWidths,
    pipeline.sharedRailWidthRatioMin,
  );
  return !railLikeFirst && !wideLeftRail;
}

type InkRailLayout = NonNullable<ReturnType<typeof sharedRailLayoutFromInkProfile>>;

/** True when ink value columns leave an interior gap larger than typical product pitch (ruled bounds needed). */
export function inkValueColumnsNeedRuledBounds(
  columns: Array<{ x0: number; x1: number }>,
  gapToMedianProductRatio: number,
): boolean {
  if (columns.length < 2 || gapToMedianProductRatio <= 0) return false;
  const widths = columns.map((col) => col.x1 - col.x0).filter((w) => w > 0);
  const medianW = medianPositiveWidth(widths);
  if (medianW <= 0) return false;
  const gapThreshold = Math.max(4, Math.round(medianW * gapToMedianProductRatio));
  for (let i = 0; i < columns.length - 1; i += 1) {
    const gap = columns[i + 1]!.x0 - columns[i]!.x1;
    if (gap > gapThreshold) return true;
  }
  return false;
}

function bodyHorizontalRuleCountInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  bodyTopY: number,
): number {
  return horizontalRuleRowYsInColumn(pixels, width, height, x0, x1).filter((y) => y >= bodyTopY).length;
}

/** True when this label demonstrably has horizontal rules (do not treat “zero rules” as empty gutter). */
function productColumnsUseHorizontalRuleSignal(
  columns: VarietyPackGridCategory[],
  minBodyRules: number,
  ruledPixels: Uint8Array | undefined,
  analysisW: number | undefined,
  analysisH: number | undefined,
  bodyTopY: number,
): boolean {
  if (columns.some((col) => col.horizontalRuleCount >= minBodyRules)) return true;
  if (ruledPixels === undefined || analysisW === undefined || analysisH === undefined) {
    return columns.some((col) => col.horizontalRuleCount > 0);
  }
  let peak = 0;
  for (const col of columns) {
    peak = Math.max(
      peak,
      bodyHorizontalRuleCountInColumn(ruledPixels, analysisW, analysisH, col.x0, col.x1, bodyTopY),
    );
  }
  return peak >= minBodyRules;
}

/**
 * Drop wide product stacks with sparse nutrient-body horizontal rules (empty gutters between products).
 * **Horizontal rules are optional:** if the label has none, stacks are kept and vertical/ink geometry stands alone.
 */
export function dropWideSparseBodyRuledProductStacks(
  columns: VarietyPackGridCategory[],
  pipeline: VarietyPackGridPipelineParams,
  ruledPixels?: Uint8Array,
  analysisW?: number,
  analysisH?: number,
): VarietyPackGridCategory[] {
  const out = columns.map((col) => ({ ...col }));
  const widths = out.map((col) => col.x1 - col.x0).filter((w) => w > 0);
  const medianW = medianPositiveWidth(widths);
  const wideRatio = pipeline.glareGutterWideToMedianRatio;
  const minBodyRules = pipeline.wideRuledSpanMinBodyHorizontalRules;
  const bodyTopY =
    analysisH !== undefined
      ? Math.round(analysisH * pipeline.wideRuledSpanBodyRuleProbeTopFraction)
      : 0;
  const rulesApply = productColumnsUseHorizontalRuleSignal(
    out,
    minBodyRules,
    ruledPixels,
    analysisW,
    analysisH,
    bodyTopY,
  );
  if (!rulesApply) return out;

  for (let i = out.length - 1; i >= 0; i -= 1) {
    const col = out[i]!;
    const w = col.x1 - col.x0;
    if (medianW <= 0 || w <= medianW * wideRatio) continue;
    let bodyRules = 0;
    let probedBody = false;
    if (ruledPixels !== undefined && analysisW !== undefined && analysisH !== undefined) {
      bodyRules = bodyHorizontalRuleCountInColumn(
        ruledPixels,
        analysisW,
        analysisH,
        col.x0,
        col.x1,
        bodyTopY,
      );
      probedBody = true;
    }
    if (!probedBody) {
      bodyRules = col.horizontalRuleCount;
    }
    if (bodyRules === 0) continue;
    if (bodyRules < minBodyRules) {
      out.splice(i, 1);
    }
  }
  return out;
}

function sharedRailStep3FromInkFromRuledProducts(
  inkRail: InkRailLayout,
  step1: VarietyPackGridStep1,
  pipeline: VarietyPackGridPipelineParams,
  ruledPixels?: Uint8Array,
  analysisW?: number,
  analysisH?: number,
): InkRailLayout | null {
  const labelRail = step1.categories[0];
  if (!labelRail) return null;
  const split = dropWideSparseBodyRuledProductStacks(
    sharedRailProductValueColumns(step1.categories, labelRail),
    pipeline,
    ruledPixels,
    analysisW,
    analysisH,
  );
  const { segments: trimmed, ruledMeta: trimmedMeta } = trimTrailingIrregularValueColumns(
    split.map((col) => ({ x0: col.x0, x1: col.x1 })),
    split.map((col) => ({ horizontalRuleCount: col.horizontalRuleCount })),
  );
  const products = trimmed.map((seg, index) => ({
    x0: seg.x0,
    x1: seg.x1,
    horizontalRuleCount: trimmedMeta[index]?.horizontalRuleCount ?? 0,
    index: index + 1,
  }));
  if (products.length < pipeline.minProductColumns) return null;
  const labelBoundaryX = Math.max(labelRail.x1, inkRail.labelBoundaryX);
  return {
    ...inkRail,
    labelColumn: {
      x0: labelRail.x0,
      x1: labelBoundaryX,
      index: 0,
      horizontalRuleCount: labelRail.horizontalRuleCount,
    },
    labelBoundaryX,
    valueColumns: products.map((col) => ({
      x0: col.x0,
      x1: col.x1,
      index: col.index,
      horizontalRuleCount: col.horizontalRuleCount,
    })),
  };
}

function resolveSharedRailInkForStep3(
  inkRail: InkRailLayout,
  step1: VarietyPackGridStep1,
  shared: SharedLabelGridParams,
  pipeline: VarietyPackGridPipelineParams,
  ruledPixels?: Uint8Array,
  analysisW?: number,
  analysisH?: number,
): InkRailLayout {
  const labelRail = step1.categories[0];
  if (!labelRail) return inkRail;
  const ruledTarget = sharedRailProductValueColumns(step1.categories, labelRail).length;
  void shared;
  const inkUnderCounts = inkRail.valueColumns.length + 1 < ruledTarget;
  const inkInteriorGap = inkValueColumnsNeedRuledBounds(
    inkRail.valueColumns,
    pipeline.valueColumnInkInteriorGapToMedianProductRatio,
  );
  if (inkUnderCounts || inkInteriorGap) {
    return (
      sharedRailStep3FromInkFromRuledProducts(inkRail, step1, pipeline, ruledPixels, analysisW, analysisH) ??
      inkRail
    );
  }
  return inkRail;
}

function sharedRailStep3FromInk(
  inkRail: InkRailLayout,
  varietySubtype?: 'shared_rail' | 'per_column_labels' | 'unknown',
): GatedStepResult<VarietyPackGridStep3> {
  const rail = inkRail;
  return gated(
    stepValidation(3, true, 'ok', 'Shared label rail (ink boundary + value grid).', {
      layout: 'shared_rail',
      labelBoundaryX: rail.labelBoundaryX,
      inkAsymmetry: rail.inkAsymmetry,
      valueColumnCount: rail.valueColumns.length,
      via: 'ink_profile',
      ...(varietySubtype !== undefined ? { varietySubtype } : {}),
    }),
    {
      layout: 'shared_rail',
      labelColumn: rail.labelColumn,
      valueColumns: rail.valueColumns,
      labelBoundaryX: rail.labelBoundaryX,
      inkAsymmetry: rail.inkAsymmetry,
    },
  );
}

function toCategories(segments: Array<{ x0: number; x1: number; horizontalRuleCount?: number }>): VarietyPackGridCategory[] {
  return segments.map((segment, index) => ({
    index,
    x0: segment.x0,
    x1: segment.x1,
    horizontalRuleCount: segment.horizontalRuleCount ?? 0,
  }));
}

export function runVarietyPackGridStep1(ctx: VarietyPackBandContext): GatedStepResult<VarietyPackGridStep1> {
  const { bandAnalysis, pipeline, maxColumns } = ctx;
  const { analysisW, analysisH } = bandAnalysis;
  const ruledPixels = ruledGridBandPixels(bandAnalysis);

  const ruled = categoriesFromRuledGrid(ruledPixels, analysisW, analysisH, 0, undefined, maxColumns + 1, {
    requireHorizontalRules: false,
  });
  const method: VarietyPackGridStep1['detectionMethod'] = 'ruled';

  const categories = toCategories(ruled);
  const ruledProducts = categories.filter(
    (col) => col.horizontalRuleCount >= pipeline.minHorizontalRulesPerProductColumn,
  );
  const productCols =
    ruledProducts.length >= pipeline.minProductColumns
      ? ruledProducts
      : categories.filter((col) => col.horizontalRuleCount > 0);

  if (productCols.length < pipeline.minProductColumns) {
    return gatedFail<VarietyPackGridStep1>(
      stepValidation(1, false, 'insufficient_ruled_columns', 'Too few ruled product columns.', {
        categoryCount: categories.length,
        productColumnCount: productCols.length,
      }),
    );
  }

  const widths = productColumnsForUniformityWidthCheck(
    categories,
    productCols,
    pipeline.sharedRailWidthRatioMin,
  ).map((col) => col.x1 - col.x0);
  const cv = columnWidthCv(widths);
  if (cv > pipeline.maxProductColumnWidthCv) {
    return gatedFail<VarietyPackGridStep1>(
      stepValidation(1, false, 'column_widths_nonuniform', 'Product column widths are not uniform enough.', {
        columnWidthCv: cv,
        productColumnCount: productCols.length,
      }),
    );
  }

  return gated(
    stepValidation(1, true, 'ok', 'Product columns detected from line geometry.', {
      categoryCount: categories.length,
      productColumnCount: productCols.length,
      detectionMethod: method,
      columnWidthCv: cv,
    }),
    { categories, productColumns: productCols, detectionMethod: method },
  );
}

export function runVarietyPackGridStep2(
  ctx: VarietyPackBandContext,
  step1: VarietyPackGridStep1,
): GatedStepResult<VarietyPackGridStep2> {
  const { bandAnalysis, pipeline } = ctx;
  const { analysisW, analysisH } = bandAnalysis;
  const ruledPixels = ruledGridBandPixels(bandAnalysis);

  const maxJitter = Math.max(1, Math.round(analysisH * pipeline.rowConsensusMaxJitterFraction));
  const bodyTopY = consensusBodyTopY(
    ruledPixels,
    analysisW,
    analysisH,
    step1.productColumns,
    undefined,
    2,
    maxJitter,
  );
  if (bodyTopY === null) {
    return gatedFail<VarietyPackGridStep2>(
      stepValidation(2, false, 'header_band_missing', 'Could not find ruled body start across product columns.'),
    );
  }

  const headerHeightFraction = bodyTopY / Math.max(1, analysisH);
  if (headerHeightFraction < pipeline.headerMinHeightFraction) {
    return gatedFail<VarietyPackGridStep2>(
      stepValidation(2, false, 'header_band_implausible', 'Header band is too short for product names.', {
        headerHeightFraction,
        bodyTopY,
      }),
    );
  }
  if (headerHeightFraction > pipeline.headerMaxHeightFraction) {
    return gatedFail<VarietyPackGridStep2>(
      stepValidation(2, false, 'header_band_implausible', 'Header band is too tall; ruled body start not found.', {
        headerHeightFraction,
        bodyTopY,
      }),
    );
  }

  return gated(
    stepValidation(2, true, 'ok', 'Header band ends where ruled nutrient rows begin.', {
      bodyTopY,
      headerHeightFraction,
    }),
    { bodyTopY, headerHeightFraction },
  );
}

export function runVarietyPackGridStep3(
  ctx: VarietyPackBandContext,
  step1: VarietyPackGridStep1,
): GatedStepResult<VarietyPackGridStep3> {
  const { bandAnalysis, shared } = ctx;
  const profile = buildColumnInkProfileFromBand(
    bandAnalysis.pixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
  );

  const first = step1.categories[0];
  if (!first) {
    return gatedFail<VarietyPackGridStep3>(stepValidation(3, false, 'label_layout_unknown', 'No categories from step 1.'));
  }

  const equalPair = detectEqualWidthColumnPair(
    step1.categories.map((c) => ({ x0: c.x0, x1: c.x1 })),
    bandAnalysis.analysisW,
    DEFAULT_SPLIT_SINGLE_LABEL_PARAMS.widthRatioMin,
  );
  if (equalPair) {
    return gated(
      stepValidation(3, true, 'ok', 'Equal-width pair — split single label, not variety grid.', {
        layout: 'split_single',
        widthRatio: equalPair.widthRatio,
      }),
      splitSingleStep3FromEqualPair(equalPair),
    );
  }

  const witnesses = collectColumnGeometryWitnesses(
    bandAnalysis.pixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    ctx.stripParams,
    ctx.maxColumns,
  );
  const fallbackLabelEndX = first.x0 === 0 ? first.x1 : first.x0;
  const asymmetryEarly = isPerColumnLabelLayout(step1, ctx.pipeline)
    ? undefined
    : profileInkAsymmetryForLayoutScores(profile, fallbackLabelEndX, ctx.shared);
  const scores = scoreLayoutHypotheses(witnesses, undefined, asymmetryEarly);
  const varietySubtype = pickVarietyPackSubtype(scores);
  const sharedScore = scores.find((s) => s.layout === 'shared_rail')?.score ?? 0;
  const perColScore = scores.find((s) => s.layout === 'per_column_labels')?.score ?? 0;

  const inkGridMeta = bandAnalysis.inkGridCropped
    ? {
        labelBoundaryX: bandAnalysis.inkGridCropped.labelBoundaryX,
        analysisW: bandAnalysis.analysisW,
        tableRightAnalysisX: bandAnalysis.inkGridCropped.tableRightAnalysisX,
      }
    : undefined;
  const inkRailCandidate = sharedRailLayoutFromInkProfile(
    ruledGridBandPixels(bandAnalysis),
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    profile,
    ctx.stripParams,
    ctx.shared,
    ctx.maxColumns,
    {
      inkGridCropped: inkGridMeta !== undefined,
      inkGridCroppedMeta: inkGridMeta,
      sharedRailWidthRatioMin: ctx.pipeline.sharedRailWidthRatioMin,
    },
  );
  const inkRailOk =
    inkRailCandidate !== null && inkRailCandidate.valueColumns.length >= ctx.shared.minValueColumns;
  const inkValueCols = inkRailCandidate?.valueColumns.length ?? 0;
  const ruledProductCols = step1.productColumns.length;
  const inkTie = DEFAULT_LABEL_TABLE_LAYOUT_PARAMS.inkRailPreferScoreTieEpsilon;
  const inkAsymmetryScore = inkRailCandidate
    ? profileInkAsymmetryForLayoutScores(profile, inkRailCandidate.labelBoundaryX)
    : undefined;
  const preferSharedRail =
    varietySubtype === 'shared_rail' ||
    (inkRailOk && inkValueCols >= ruledProductCols + 2) ||
    (inkRailOk && varietySubtype !== 'per_column_labels' && sharedScore >= perColScore - inkTie);
  const ruledLabelRail =
    (step1.categories[0]?.horizontalRuleCount ?? 0) < ctx.pipeline.minHorizontalRulesPerProductColumn;
  const inkRailOverridesPerColumn =
    inkRailOk &&
    ruledLabelRail &&
    isPerColumnLabelLayout(step1, ctx.pipeline) &&
    varietySubtype === 'per_column_labels' &&
    (inkAsymmetryScore ?? 0) >= shared.labelInkAsymmetryRatio;
  if (inkRailOverridesPerColumn && inkRailCandidate) {
    return sharedRailStep3FromInk(
      resolveSharedRailInkForStep3(
        inkRailCandidate,
        step1,
        ctx.shared,
        ctx.pipeline,
        ruledGridBandPixels(ctx.bandAnalysis),
        ctx.bandAnalysis.analysisW,
        ctx.bandAnalysis.analysisH,
      ),
      varietySubtype,
    );
  }

  if (isPerColumnLabelLayout(step1, ctx.pipeline) && varietySubtype === 'per_column_labels') {
    const productWidths = step1.productColumns.map((col) => col.x1 - col.x0);
    const labelEndX = 0;
    const leftMean = meanInk(profile, 0, Math.max(1, step1.productColumns[0]?.x1 ?? 1));
    const rightMean = meanInk(profile, labelEndX, profile.length);
    const asymmetry = rightMean > 0 ? leftMean / rightMean : 0;
    return gated(
      stepValidation(3, true, 'ok', 'Labels appear inside each product column.', {
        layout: 'per_column_labels',
        valueColumnCount: step1.productColumns.length,
        varietySubtype,
      }),
      {
        layout: 'per_column_labels',
        labelColumn: null,
        valueColumns: step1.productColumns,
        labelBoundaryX: 0,
        inkAsymmetry: asymmetry,
      },
    );
  }

  if (preferSharedRail && inkRailCandidate) {
    return sharedRailStep3FromInk(
      resolveSharedRailInkForStep3(
        inkRailCandidate,
        step1,
        ctx.shared,
        ctx.pipeline,
        ruledGridBandPixels(ctx.bandAnalysis),
        ctx.bandAnalysis.analysisW,
        ctx.bandAnalysis.analysisH,
      ),
      varietySubtype,
    );
  }

  const productWidths = step1.productColumns.map((col) => col.x1 - col.x0);
  const medianProduct =
    [...productWidths].sort((a, b) => a - b)[Math.floor(productWidths.length / 2)] ?? 0;
  const firstWidth = first.x1 - first.x0;
  const railByWidth = medianProduct > 0 && firstWidth >= medianProduct * ctx.pipeline.sharedRailWidthRatioMin;

  const labelEndX = first.x0 === 0 ? first.x1 : first.x0;
  const leftMean = meanInk(profile, 0, labelEndX);
  const rightMean = meanInk(profile, labelEndX, profile.length);
  const asymmetry = rightMean > 0 ? leftMean / rightMean : 0;
  const railByInk = asymmetry >= shared.labelInkAsymmetryRatio;

  if (railByWidth && railByInk && first.horizontalRuleCount < ctx.pipeline.minHorizontalRulesPerProductColumn) {
    const labelFrac = labelEndX / profile.length;
    if (labelFrac < shared.labelColumnMinWidthFraction || labelFrac > shared.labelColumnMaxWidthFraction) {
      return gatedFail<VarietyPackGridStep3>(
        stepValidation(3, false, 'shared_rail_rejected', 'Shared label rail width out of range.', {
          labelWidthFraction: labelFrac,
        }),
      );
    }

    const valueColumns = sharedRailProductValueColumns(step1.productColumns, first);
    if (valueColumns.length < ctx.shared.minValueColumns) {
      return gatedFail<VarietyPackGridStep3>(
        stepValidation(3, false, 'shared_rail_rejected', 'Too few product value columns after label rail.', {
          valueColumnCount: valueColumns.length,
        }),
      );
    }
    return gated(
      stepValidation(3, true, 'ok', 'Shared label rail with product value columns.', {
        layout: 'shared_rail',
        labelBoundaryX: labelEndX,
        inkAsymmetry: asymmetry,
        valueColumnCount: valueColumns.length,
      }),
      {
        layout: 'shared_rail',
        labelColumn: first,
        valueColumns,
        labelBoundaryX: labelEndX,
        inkAsymmetry: asymmetry,
      },
    );
  }

  if (inkRailCandidate) {
    return sharedRailStep3FromInk(
      resolveSharedRailInkForStep3(
        inkRailCandidate,
        step1,
        ctx.shared,
        ctx.pipeline,
        ruledGridBandPixels(ctx.bandAnalysis),
        ctx.bandAnalysis.analysisW,
        ctx.bandAnalysis.analysisH,
      ),
    );
  }

  return gatedFail<VarietyPackGridStep3>(stepValidation(3, false, 'label_layout_unknown', 'Could not classify label layout.'));
}

export function runVarietyPackGridStep4(
  ctx: VarietyPackBandContext,
  step2: VarietyPackGridStep2,
  step3: VarietyPackGridStep3,
): GatedStepResult<VarietyPackGridStep4> {
  const { bandAnalysis, pipeline } = ctx;
  const ruledPixels = ruledGridBandPixels(bandAnalysis);
  const maxJitter = Math.max(1, Math.round(bandAnalysis.analysisH * pipeline.rowConsensusMaxJitterFraction));
  const headerRowBandYs = consensusHeaderRowBandYs(
    ruledPixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    step3.valueColumns,
    step2.bodyTopY,
    maxJitter,
  );
  const rowBandYs = consensusBodyRowBandYs(
    ruledPixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    step3.valueColumns,
    step2.bodyTopY,
    maxJitter,
  );

  if (rowBandYs.length < pipeline.minRowBands) {
    return gatedFail<VarietyPackGridStep4>(
      stepValidation(4, false, 'insufficient_row_bands', 'Not enough horizontal row bands for nutrient stitching.', {
        rowBandCount: rowBandYs.length,
      }),
    );
  }

  return gated(
    stepValidation(4, true, 'ok', 'Row band grid ready for value/label alignment.', {
      rowBandCount: rowBandYs.length,
      headerRowBandCount: headerRowBandYs.length,
    }),
    { rowBandYs, headerRowBandYs, planReady: true },
  );
}

export function buildPerColumnVarietyPackPlanFromPipeline(
  ctx: VarietyPackBandContext,
  step3: VarietyPackGridStep3,
): ColumnStripPlan | null {
  if (step3.layout !== 'per_column_labels') return null;

  const { bandAnalysis, ocrBand, stripParams } = ctx;
  const { band: detectionBand, fullWidth, analysisW } = bandAnalysis;
  const mapX = (analysisX: number) =>
    detectionBand.left + Math.round((analysisX / analysisW) * detectionBand.width);
  const minOutputWidth = Math.max(1, Math.round(fullWidth * stripParams.minOutputStripWidthFraction));
  const strips: ColumnStripRegion[] = step3.valueColumns.map((segment, index) => {
    const left = mapX(segment.x0);
    const right = mapX(segment.x1);
    const width = Math.max(minOutputWidth, right - left);
    return { index, left, top: ocrBand.top, width, height: ocrBand.height };
  });
  if (strips.length < 2) return null;
  return { band: ocrBand, strips };
}

export function buildSharedLabelPlanFromPipeline(
  ctx: VarietyPackBandContext,
  step2: VarietyPackGridStep2,
  step3: VarietyPackGridStep3,
  step4: VarietyPackGridStep4,
): SharedLabelValueGridPlan | null {
  if (step3.layout !== 'shared_rail' || !step3.labelColumn) return null;

  const { bandAnalysis, ocrBand, stripParams } = ctx;
  const { band: detectionBand, fullWidth, analysisW, analysisH } = bandAnalysis;
  const ruledPixels = ruledGridBandPixels(bandAnalysis);
  const shared = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const mapX = (analysisX: number) =>
    detectionBand.left + Math.round((analysisX / analysisW) * detectionBand.width);

  const labelRight = mapX(step3.labelBoundaryX);
  const geometryBand = detectionBand;
  const rowPitchAnalysis =
    step4.rowBandYs.length >= 2 ? medianConsecutiveSpacing(step4.rowBandYs) : Math.max(4, Math.round(analysisH / 14));
  const bodyTopBiasAnalysis = Math.round(
    rowPitchAnalysis * shared.nutrientBodyBelowFirstRulePitchFraction,
  );
  const filteredBodyRules = step4.rowBandYs.filter(
    (y) =>
      !sectionDividerBoundaryYsFromRuns(
        consensusRuleInkRuns(ruledPixels, analysisW, analysisH, step3.valueColumns, 4),
        step2.bodyTopY + bodyTopBiasAnalysis,
        {},
        analysisH,
      ).some((div) => Math.abs(div - y) <= 3),
  );
  const valueBodyRules =
    filteredBodyRules.length >= 2 ? filteredBodyRules : step4.rowBandYs;
  const maxJitter = Math.max(1, Math.round(analysisH * ctx.pipeline.rowConsensusMaxJitterFraction));
  let bodyRowBandYsAnalysis = augmentBodyRowBandYsWithLabelRail(
    ruledPixels,
    analysisW,
    analysisH,
    step3.labelBoundaryX,
    step2.bodyTopY + bodyTopBiasAnalysis,
    valueBodyRules,
    maxJitter,
  );
  const bodyTopAnalysis = step2.bodyTopY + bodyTopBiasAnalysis;
  const bodyBottomGuess = Math.round(
    analysisH * (1 - shared.bodyFooterMarginFraction * 0.85),
  );
  bodyRowBandYsAnalysis = augmentBodyRowBandYsWithTailAnchors(
    ruledPixels,
    analysisW,
    analysisH,
    step3.labelBoundaryX,
    step3.valueColumns,
    bodyTopAnalysis,
    bodyBottomGuess,
    bodyRowBandYsAnalysis,
    maxJitter,
  );
  const meshDedupeGap = rowBandRuleMinSpacingPx(rowPitchAnalysis, shared);
  bodyRowBandYsAnalysis = consolidateRowBandRuleYs(bodyRowBandYsAnalysis, meshDedupeGap);
  const deepestRuleAnalysis = maxBodyHorizontalRuleYAnalysis(
    ruledPixels,
    analysisW,
    analysisH,
    step3.labelBoundaryX,
    step3.valueColumns,
    bodyTopAnalysis,
  );
  const deepestRuleImage =
    deepestRuleAnalysis !== null
      ? mapAnalysisYToImageBand(deepestRuleAnalysis, analysisH, geometryBand.top, geometryBand.height)
      : undefined;
  const bodyLayout = nutrientBodyExtents(
    analysisH,
    bodyTopAnalysis,
    bodyRowBandYsAnalysis,
    geometryBand.top,
    geometryBand.height,
    shared,
    deepestRuleImage !== undefined ? { extendThroughRuleYImage: deepestRuleImage } : undefined,
  );

  const nutrientBodyBottom = bodyLayout.top + bodyLayout.height;
  const labelColumn: ColumnStripRegion = {
    index: 0,
    left: geometryBand.left,
    top: geometryBand.top,
    width: Math.max(1, labelRight - geometryBand.left),
    height: Math.max(bodyLayout.height, nutrientBodyBottom - geometryBand.top),
  };

  const bodyTopImageY = bodyLayout.top;
  const headerBand = {
    left: labelRight,
    top: geometryBand.top,
    width: Math.max(1, geometryBand.left + geometryBand.width - labelRight),
    height: Math.max(8, bodyTopImageY - geometryBand.top),
  };

  const minAnalysisWidth = Math.max(
    2,
    Math.round(analysisW * stripParams.minStripWidthFraction * 0.5),
  );
  let productSegments = productValueSegmentsRightOfLabel(
    step3.valueColumns,
    step3.labelBoundaryX,
    minAnalysisWidth,
  );
  productSegments = splitColumnSegmentsAtLocalVerticalGutters(
    bandAnalysis.pixels,
    analysisW,
    analysisH,
    productSegments,
    minAnalysisWidth,
    1.15,
  );
  if (productSegments.length < shared.minValueColumns) return null;

  const valueColumnsBeforeDisjoint: ColumnStripRegion[] = productSegments.map((segment, index) => {
    const left = mapX(segment.x0);
    const right = mapX(segment.x1);
    return {
      index,
      left,
      top: bodyLayout.top,
      width: Math.max(1, right - left),
      height: bodyLayout.height,
    };
  });

  const valueColumnsDisjoint = enforceValueColumnsDisjointFromLabel(labelColumn, valueColumnsBeforeDisjoint);
  if (valueColumnsDisjoint.length < shared.minValueColumns) return null;

  let valueColumnAnalysisSegments =
    productSegments.length === valueColumnsDisjoint.length
      ? productSegments.map((s) => ({ x0: s.x0, x1: s.x1 }))
      : valueColumnAnalysisSegmentsAligned(
          productSegments,
          valueColumnsBeforeDisjoint,
          valueColumnsDisjoint,
          labelColumn,
          geometryBand,
          analysisW,
          step3.labelBoundaryX,
        );
  if (valueColumnAnalysisSegments.length !== valueColumnsDisjoint.length) {
    throw new Error(
      `value column geometry: ${valueColumnAnalysisSegments.length} analysis segments vs ${valueColumnsDisjoint.length} image strips`,
    );
  }

  const ruledStackGutters = valueColumnAnalysisSegments.map((s) => ({ ...s }));
  const valueColumnSharedVertical = valueColumnAnalysisBoundsFromSharedVerticalRules(
    ruledStackGutters,
    step3.labelBoundaryX,
    analysisW,
  );
  const bodyBottomAnalysis = Math.min(
    analysisH - 1,
    bodyTopAnalysis +
      Math.max(8, Math.round((bodyLayout.height / Math.max(1, geometryBand.height)) * analysisH)),
  );
  const tableLuminanceRoles = classifyNutritionTableBandLuminance(
    bandAnalysis.pixels,
    analysisW,
    analysisH,
    step3.labelBoundaryX,
  );
  const valueColumnSnapped = snapValueColumnAnalysisBoundsX0ToBodyInk(
    bandAnalysis.pixels,
    analysisW,
    analysisH,
    valueColumnSharedVertical,
    bodyTopAnalysis,
    bodyBottomAnalysis,
    tableLuminanceRoles,
    step3.labelBoundaryX,
    shared,
    analysisW,
  );
  const valueColumnInkMerged = valueColumnSharedVertical.map((rule, i) => {
    if (i === 0) {
      const ink = valueColumnSnapped[i] ?? rule;
      const x0 = Math.max(rule.x0, Math.min(ink.x0, rule.x1 - 1));
      return { x0, x1: rule.x1 };
    }
    return { x0: rule.x0, x1: rule.x1 };
  });
  const valueColumnGeometrySegments = enforceValueColumnAnalysisBoundsMinWidthVsMedian(
    valueColumnInkMerged,
    shared.valueColumnAnalysisBoundsMinToMedianWidthFraction,
    step3.labelBoundaryX,
    analysisW,
    ruledStackGutters,
  );
  const valueColumns = imageValueColumnStripsFromAnalysisSegments(
    valueColumnGeometrySegments,
    mapX,
    bodyLayout.top,
    bodyLayout.height,
  );

  const perColumnRows = buildPerColumnRowBandSlicePlan({
    pixels: ruledGridBandPixels(bandAnalysis),
    analysisW,
    analysisH,
    imageBandTop: geometryBand.top,
    imageBandHeight: geometryBand.height,
    bodyTopImage: bodyLayout.top,
    bodyBottomImage: bodyLayout.top + bodyLayout.height,
    labelBoundaryAnalysisX: step3.labelBoundaryX,
    valueColumnSegmentsAnalysis: valueColumnGeometrySegments,
    consensusRowBandYsAnalysis: bodyLayout.rowBandYsAnalysis,
    consensusHeaderRowBandYsAnalysis: step4.headerRowBandYs,
  });

  return {
    band: geometryBand,
    labelColumn,
    headerBand,
    valueColumns,
    valueColumnAnalysisSegments: valueColumnGeometrySegments,
    valueGridAnalysisX: step3.labelBoundaryX,
    nutrientBodyTop: bodyLayout.top,
    nutrientBodyHeight: bodyLayout.height,
    rowSurfaceMode: perColumnRows.rowSurfaceMode,
    rowBandSlices: perColumnRows.consensusRowBandSlices,
    labelRowBandSlices: perColumnRows.labelRowBandSlices,
    valueRowBandSlicesPerColumn: perColumnRows.valueRowBandSlicesPerColumn,
    valueColumnGlareMasks: perColumnRows.valueColumnGlareMasks,
    valueColumnWarpProbes: perColumnRows.valueColumnWarpProbes,
    rowBandReconciledColumns: perColumnRows.rowBandReconciledColumns,
    headerConsensusRowBandSlices: perColumnRows.headerConsensusRowBandSlices,
    headerLabelRowBandSlices: perColumnRows.headerLabelRowBandSlices,
    headerRowBandSlicesPerColumn: perColumnRows.headerRowBandSlicesPerColumn,
    rowPitchPx: bodyLayout.rowPitchPx,
  };
}

export async function detectSharedLabelValueGrid(
  bytes: Buffer,
  options?: VarietyPackGridPipelineOptions,
): Promise<SharedLabelValueGridPlan | null> {
  return (await runVarietyPackGridPipeline(bytes, { ...options, stopAfterStep: 4 })).plan;
}

/** Product stacks only — shared label rail is carried on `labelColumn`, not in value OCR strips. */
export function sharedRailProductValueColumns(
  productColumns: VarietyPackGridCategory[],
  labelRail: VarietyPackGridCategory,
): VarietyPackGridCategory[] {
  return productColumns.filter((col) => col.x0 !== labelRail.x0 || col.x1 !== labelRail.x1);
}

/**
 * Step 1 width CV applies to product value stacks only; the left label rail may be any width.
 */
export function productColumnsForUniformityWidthCheck(
  categories: VarietyPackGridCategory[],
  productColumns: VarietyPackGridCategory[],
  sharedRailWidthRatioMin: number,
): VarietyPackGridCategory[] {
  const labelRail = categories[0];
  if (!labelRail) return productColumns;
  const productWidths = productColumns.map((col) => col.x1 - col.x0);
  const labelWidth = labelRail.x1 - labelRail.x0;
  if (firstColumnWideVsSiblings(labelWidth, productWidths, sharedRailWidthRatioMin)) {
    return sharedRailProductValueColumns(productColumns, labelRail);
  }
  return productColumns;
}

export async function runVarietyPackGridPipeline(
  bytes: Buffer,
  options?: VarietyPackGridPipelineOptions,
): Promise<VarietyPackPipelineRunResult> {
  const stopAfter = options?.stopAfterStep ?? 4;
  const ctx = await prepareVarietyPackBandContext(bytes, options);

  const failAll = (code: VarietyPackGridStepCode, message: string): VarietyPackPipelineRunResult => {
    return {
      steps: {
        1: gatedFail<VarietyPackGridStep1>(stepValidation(1, false, code, message)),
        2: gatedFail<VarietyPackGridStep2>(stepValidation(2, false, code, message)),
        3: gatedFail<VarietyPackGridStep3>(stepValidation(3, false, code, message)),
        4: gatedFail<VarietyPackGridStep4>(stepValidation(4, false, code, message)),
      },
      lastOkStep: 0,
      plan: null,
      perColumnStripPlan: null,
      ctx: null,
    };
  };

  if (!ctx) {
    const splitOnly = await trySplitSingleShortCircuit(bytes, options);
    if (splitOnly) return splitOnly;
    return failAll('band_unavailable', 'Wide band analysis unavailable or aspect rejected.');
  }

  const splitStep3 = await probeSplitSingleBeforeVarietyPack(bytes, ctx, options);
  if (splitStep3) {
    const step3 = gated(
      stepValidation(3, true, 'ok', 'Split single label — not a variety pack.', { layout: 'split_single' }),
      splitStep3,
    );
    return {
      steps: {
        1: skippedStep<VarietyPackGridStep1>(1, 'split_single_label', 'Split single label; variety-pack columns skipped.'),
        2: skippedStep<VarietyPackGridStep2>(2, 'split_single_label', 'Skipped for split single label.'),
        3: step3,
        4: skippedStep<VarietyPackGridStep4>(4, 'split_single_label', 'No shared-row mesh for split single label.'),
      },
      lastOkStep: 3,
      plan: null,
      perColumnStripPlan: null,
      ctx,
    };
  }

  const step1 = runVarietyPackGridStep1(ctx);
  if (!step1.validation.ok || stopAfter === 1) {
    return {
      steps: {
        1: step1,
        2: skippedStep<VarietyPackGridStep2>(2, 'insufficient_categories'),
        3: skippedStep<VarietyPackGridStep3>(3, 'label_layout_unknown'),
        4: skippedStep<VarietyPackGridStep4>(4, 'insufficient_row_bands'),
      },
      lastOkStep: step1.validation.ok ? 1 : 0,
      plan: null,
      perColumnStripPlan: null,
      ctx,
    };
  }

  const step2 = runVarietyPackGridStep2(ctx, step1.data!);
  if (!step2.validation.ok || stopAfter === 2) {
    return {
      steps: {
        1: step1,
        2: step2,
        3: skippedStep<VarietyPackGridStep3>(3, 'label_layout_unknown'),
        4: skippedStep<VarietyPackGridStep4>(4, 'insufficient_row_bands'),
      },
      lastOkStep: 1,
      plan: null,
      perColumnStripPlan: null,
      ctx,
    };
  }

  const step3 = runVarietyPackGridStep3(ctx, step1.data!);
  if (!step3.validation.ok || stopAfter === 3) {
    return {
      steps: { 1: step1, 2: step2, 3: step3, 4: skippedStep<VarietyPackGridStep4>(4, 'insufficient_row_bands') },
      lastOkStep: 2,
      plan: null,
      perColumnStripPlan: null,
      ctx,
    };
  }

  const step4 = runVarietyPackGridStep4(ctx, step2.data!, step3.data!);
  const step4Ok = step4.validation.ok;
  const plan =
    step4Ok && step3.data!.layout === 'shared_rail'
      ? buildSharedLabelPlanFromPipeline(ctx, step2.data!, step3.data!, step4.data!)
      : null;
  const perColumnStripPlan =
    step4Ok && step3.data!.layout === 'per_column_labels'
      ? buildPerColumnVarietyPackPlanFromPipeline(ctx, step3.data!)
      : null;

  return {
    steps: { 1: step1, 2: step2, 3: step3, 4: step4 },
    lastOkStep: step4Ok ? 4 : 3,
    plan,
    perColumnStripPlan,
    ctx,
  };
}

function skippedStep<T>(step: 1 | 2 | 3 | 4, code: VarietyPackGridStepCode, message = 'Skipped.'): GatedStepResult<T> {
  return gatedFail<T>(stepValidation(step, false, code, message));
}

export function formatVarietyPackStepValidation(v: VarietyPackGridStepValidation): string {
  const metrics = v.metrics
    ? ` (${Object.entries(v.metrics)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')})`
    : '';
  return `step ${v.step} ${v.code}: ${v.message}${metrics}`;
}

function splitSingleStep3FromEqualPair(pair: EqualWidthPair): VarietyPackGridStep3 {
  return {
    layout: 'split_single',
    labelColumn: null,
    valueColumns: [
      { ...pair.left, index: 0, horizontalRuleCount: 0 },
      { ...pair.right, index: 1, horizontalRuleCount: 0 },
    ],
    labelBoundaryX: pair.left.x0,
    inkAsymmetry: 0,
  };
}

/** Focus crop can drop below wide aspect; still probe split-single before failing the band gate. */
async function trySplitSingleShortCircuit(
  bytes: Buffer,
  options?: VarietyPackGridPipelineOptions,
): Promise<VarietyPackPipelineRunResult | null> {
  const hint = options?.layoutHint;
  if (!hint?.singleSubjectInFocus || hint.sharpPeakCount >= MULTI_COLUMN_FOCUS_MIN_PEAKS) return null;

  const { bytes: labelBytes } = await resolveLabelProcessingImage(bytes);
  const stripParams = resolveColumnStripParams(options?.geometry);
  const shared = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, ...options?.sharedGeometry };
  const pipeline = { ...DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS, ...options?.pipelineParams };
  const maxColumns = options?.maxColumns ?? stripParams.maxColumns;
  const bandAnalysis = await prepareWideBandAnalysis(labelBytes, stripParams, 'detection');
  if (!bandAnalysis) return null;

  const miniCtx: VarietyPackBandContext = {
    bandAnalysis,
    ocrBand: bandAnalysis.band,
    stripParams,
    shared,
    pipeline,
    maxColumns,
  };
  const step3Data = await probeSplitSingleBeforeVarietyPack(bytes, miniCtx, options);
  if (!step3Data) return null;

  const step3 = gated(
    stepValidation(3, true, 'ok', 'Split single label — not a variety pack.', { layout: 'split_single' }),
    step3Data,
  );
  return {
    steps: {
      1: skippedStep<VarietyPackGridStep1>(1, 'split_single_label', 'Split single label; variety-pack columns skipped.'),
      2: skippedStep<VarietyPackGridStep2>(2, 'split_single_label', 'Skipped for split single label.'),
      3: step3,
      4: skippedStep<VarietyPackGridStep4>(4, 'split_single_label', 'No shared-row mesh for split single label.'),
    },
    lastOkStep: 3,
    plan: null,
    perColumnStripPlan: null,
    ctx: miniCtx,
  };
}

/** One product, two equal vertical halves — must not run multi-product variety-pack logic. */
async function probeSplitSingleBeforeVarietyPack(
  bytes: Buffer,
  ctx: VarietyPackBandContext,
  options?: VarietyPackGridPipelineOptions,
): Promise<VarietyPackGridStep3 | null> {
  const hint = options?.layoutHint;
  if (hint) {
    if (!hint.singleSubjectInFocus) return null;
    if (hint.sharpPeakCount >= MULTI_COLUMN_FOCUS_MIN_PEAKS) return null;
  }

  const { pixels, analysisW, analysisH } = ctx.bandAnalysis;
  const witnesses = collectColumnGeometryWitnesses(pixels, analysisW, analysisH, ctx.stripParams, 8);
  const scores = scoreLayoutHypotheses(witnesses, hint);
  if (pickLeadingLayoutHypothesis(scores) !== 'split_single') return null;

  const segments = fitSplitSingleColumns(witnesses);
  if (!segments) return null;
  return step3FromSplitSegments(segments);
}

function step3FromSplitSegments(segments: Array<{ x0: number; x1: number }>): VarietyPackGridStep3 {
  const [left, right] = segments;
  return {
    layout: 'split_single',
    labelColumn: null,
    valueColumns: [
      { x0: left!.x0, x1: left!.x1, index: 0, horizontalRuleCount: 0 },
      { x0: right!.x0, x1: right!.x1, index: 1, horizontalRuleCount: 0 },
    ],
    labelBoundaryX: left!.x0,
    inkAsymmetry: 0,
  };
}

function meanInk(profile: Float64Array, from: number, to: number): number {
  if (to <= from) return 0;
  let sum = 0;
  let count = 0;
  for (let x = from; x < to; x += 1) {
    sum += profile[x]!;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}
