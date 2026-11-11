import {
  DEFAULT_SHARED_LABEL_GRID_PARAMS,
  type SharedLabelGridParams,
} from '../domain/sharedLabelGridParams.js';
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
} from './labelColumnStrips.js';
import { categoriesFromRuledGrid, consensusBodyTopY, consensusRowBandYs } from './ruledTableGridDetect.js';
import { DEFAULT_SPLIT_SINGLE_LABEL_PARAMS } from '../domain/splitSingleLabelParams.js';
import { resolveLabelProcessingImage } from './imageLayoutHint.js';
import {
  columnWidthCv,
  detectEqualWidthColumnPair,
  firstColumnWideVsSiblings,
  medianPositiveWidth,
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

  return { bandAnalysis, ocrBand, stripParams, shared, pipeline, maxColumns };
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

function sharedRailStep3FromInk(
  inkRail: InkRailLayout,
  varietySubtype?: 'shared_rail' | 'per_column_labels' | 'unknown',
): GatedStepResult<VarietyPackGridStep3> {
  return gated(
    stepValidation(3, true, 'ok', 'Shared label rail (ink boundary + value grid).', {
      layout: 'shared_rail',
      labelBoundaryX: inkRail.labelBoundaryX,
      inkAsymmetry: inkRail.inkAsymmetry,
      valueColumnCount: inkRail.valueColumns.length,
      via: 'ink_profile',
      ...(varietySubtype !== undefined ? { varietySubtype } : {}),
    }),
    {
      layout: 'shared_rail',
      labelColumn: inkRail.labelColumn,
      valueColumns: inkRail.valueColumns,
      labelBoundaryX: inkRail.labelBoundaryX,
      inkAsymmetry: inkRail.inkAsymmetry,
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
  const { pixels, analysisW, analysisH } = bandAnalysis;

  const ruled = categoriesFromRuledGrid(pixels, analysisW, analysisH, 0, undefined, maxColumns + 1, {
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

  const widths = productCols.map((col) => col.x1 - col.x0);
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
  const { pixels, analysisW, analysisH } = bandAnalysis;

  const bodyTopY = consensusBodyTopY(pixels, analysisW, analysisH, step1.productColumns);
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

  const inkRailCandidate = sharedRailLayoutFromInkProfile(
    bandAnalysis.pixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    profile,
    ctx.stripParams,
    ctx.shared,
    ctx.maxColumns,
  );
  const inkRailOk =
    inkRailCandidate !== null && inkRailCandidate.valueColumns.length >= ctx.shared.minValueColumns;
  const inkValueCols = inkRailCandidate?.valueColumns.length ?? 0;
  const ruledProductCols = step1.productColumns.length;
  const inkTie = DEFAULT_LABEL_TABLE_LAYOUT_PARAMS.inkRailPreferScoreTieEpsilon;
  const preferSharedRail =
    varietySubtype === 'shared_rail' ||
    (inkRailOk && inkValueCols >= ruledProductCols + 2) ||
    (inkRailOk && varietySubtype !== 'per_column_labels' && sharedScore >= perColScore - inkTie);
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
    return sharedRailStep3FromInk(inkRailCandidate, varietySubtype);
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

    const valueColumns = step1.productColumns;
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
    return sharedRailStep3FromInk(inkRailCandidate);
  }

  return gatedFail<VarietyPackGridStep3>(stepValidation(3, false, 'label_layout_unknown', 'Could not classify label layout.'));
}

export function runVarietyPackGridStep4(
  ctx: VarietyPackBandContext,
  step3: VarietyPackGridStep3,
): GatedStepResult<VarietyPackGridStep4> {
  const { bandAnalysis, pipeline } = ctx;
  const maxJitter = Math.max(1, Math.round(bandAnalysis.analysisH * pipeline.rowConsensusMaxJitterFraction));
  const rowBandYs = consensusRowBandYs(
    bandAnalysis.pixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    step3.valueColumns,
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
    }),
    { rowBandYs, planReady: true },
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
): SharedLabelValueGridPlan | null {
  if (step3.layout !== 'shared_rail' || !step3.labelColumn) return null;

  const { bandAnalysis, ocrBand, stripParams } = ctx;
  const { band: detectionBand, fullWidth, analysisW } = bandAnalysis;
  const mapX = (analysisX: number) =>
    detectionBand.left + Math.round((analysisX / analysisW) * detectionBand.width);

  const labelRight = mapX(step3.labelBoundaryX);
  const labelColumn: ColumnStripRegion = {
    index: 0,
    left: detectionBand.left,
    top: ocrBand.top,
    width: Math.max(1, labelRight - detectionBand.left),
    height: ocrBand.height,
  };

  const bodyTopImageY =
    ocrBand.top + Math.round((step2.bodyTopY / bandAnalysis.analysisH) * ocrBand.height);
  const headerBand = {
    left: labelRight,
    top: ocrBand.top,
    width: Math.max(1, detectionBand.left + detectionBand.width - labelRight),
    height: Math.max(8, bodyTopImageY - ocrBand.top),
  };

  const minOutputWidth = Math.max(1, Math.round(fullWidth * stripParams.minOutputStripWidthFraction));
  const valueColumns: ColumnStripRegion[] = step3.valueColumns.map((segment, index) => {
    const left = mapX(segment.x0);
    const right = mapX(segment.x1);
    const width = Math.max(minOutputWidth, right - left);
    return { index, left, top: ocrBand.top, width, height: ocrBand.height };
  });

  return {
    band: ocrBand,
    labelColumn,
    headerBand,
    valueColumns,
    valueGridAnalysisX: step3.labelBoundaryX,
  };
}

export async function detectSharedLabelValueGrid(
  bytes: Buffer,
  options?: VarietyPackGridPipelineOptions,
): Promise<SharedLabelValueGridPlan | null> {
  return (await runVarietyPackGridPipeline(bytes, { ...options, stopAfterStep: 4 })).plan;
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

  const step4 = runVarietyPackGridStep4(ctx, step3.data!);
  const step4Ok = step4.validation.ok;
  const plan =
    step4Ok && step3.data!.layout === 'shared_rail'
      ? buildSharedLabelPlanFromPipeline(ctx, step2.data!, step3.data!)
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
