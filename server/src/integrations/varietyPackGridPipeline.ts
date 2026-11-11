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
import { WIDE_PANEL_MIN_ASPECT } from '../domain/labelLayout.js';
import {
  resolveColumnStripParams,
  type ColumnStripDetectOptions,
  type ColumnStripDetectParams,
} from '../domain/columnStripDetectParams.js';
import {
  buildColumnInkProfileFromBand,
  prepareWideBandAnalysis,
} from './labelColumnStrips.js';
import { categoriesFromRuledGrid, consensusBodyTopY, consensusRowBandYs } from './ruledTableGridDetect.js';
import {
  sharedRailLayoutFromInkProfile,
  type SharedLabelValueGridPlan,
} from './sharedLabelValueGrid.js';
import type { ColumnStripRegion } from './labelColumnStrips.js';

export type VarietyPackGridPipelineOptions = ColumnStripDetectOptions & {
  sharedGeometry?: Partial<SharedLabelGridParams>;
  pipelineParams?: Partial<VarietyPackGridPipelineParams>;
  requireWideAspect?: boolean;
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
  const stripParams = resolveColumnStripParams(options?.geometry);
  const shared = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, ...options?.sharedGeometry };
  const pipeline = { ...DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS, ...options?.pipelineParams };
  const maxColumns = options?.maxColumns ?? stripParams.maxColumns;
  const requireWide = options?.requireWideAspect ?? true;

  const bandAnalysis = await prepareWideBandAnalysis(bytes, stripParams, 'detection');
  if (!bandAnalysis) return null;
  if (requireWide && bandAnalysis.fullWidth / bandAnalysis.fullHeight < WIDE_PANEL_MIN_ASPECT) return null;

  const ocrBandAnalysis = await prepareWideBandAnalysis(bytes, stripParams, 'ocr');
  const ocrBand = ocrBandAnalysis?.band ?? bandAnalysis.band;

  return { bandAnalysis, ocrBand, stripParams, shared, pipeline, maxColumns };
}

function coefficientOfVariation(widths: number[]): number {
  if (widths.length < 2) return 0;
  const mean = widths.reduce((sum, w) => sum + w, 0) / widths.length;
  if (mean <= 0) return Number.POSITIVE_INFINITY;
  const variance = widths.reduce((sum, w) => sum + (w - mean) ** 2, 0) / widths.length;
  return Math.sqrt(variance) / mean;
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
  const cv = coefficientOfVariation(widths);
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

  const inkRail = sharedRailLayoutFromInkProfile(
    bandAnalysis.pixels,
    bandAnalysis.analysisW,
    bandAnalysis.analysisH,
    profile,
    ctx.stripParams,
    ctx.shared,
    ctx.maxColumns,
  );
  if (inkRail) {
    return gated(
      stepValidation(3, true, 'ok', 'Shared label rail (ink boundary + value grid).', {
        layout: 'shared_rail',
        labelBoundaryX: inkRail.labelBoundaryX,
        inkAsymmetry: inkRail.inkAsymmetry,
        valueColumnCount: inkRail.valueColumns.length,
        via: 'ink_profile',
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

  if (step1.productColumns.length >= ctx.pipeline.minProductColumns) {
    const uniform = coefficientOfVariation(productWidths) <= ctx.pipeline.maxProductColumnWidthCv;
    if (uniform) {
      return gated(
        stepValidation(3, true, 'ok', 'Labels appear inside each product column.', {
          layout: 'per_column_labels',
          valueColumnCount: step1.productColumns.length,
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
): Promise<VarietyPackGridPipelineResult & { plan: SharedLabelValueGridPlan | null; ctx: VarietyPackBandContext | null }> {
  const stopAfter = options?.stopAfterStep ?? 4;
  const ctx = await prepareVarietyPackBandContext(bytes, options);

  const failAll = (code: VarietyPackGridStepCode, message: string): VarietyPackGridPipelineResult & {
    plan: null;
    ctx: null;
  } => {
    return {
      steps: {
        1: gatedFail<VarietyPackGridStep1>(stepValidation(1, false, code, message)),
        2: gatedFail<VarietyPackGridStep2>(stepValidation(2, false, code, message)),
        3: gatedFail<VarietyPackGridStep3>(stepValidation(3, false, code, message)),
        4: gatedFail<VarietyPackGridStep4>(stepValidation(4, false, code, message)),
      },
      lastOkStep: 0,
      plan: null,
      ctx: null,
    };
  };

  if (!ctx) {
    return failAll('band_unavailable', 'Wide band analysis unavailable or aspect rejected.');
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
      ctx,
    };
  }

  const step3 = runVarietyPackGridStep3(ctx, step1.data!);
  if (!step3.validation.ok || stopAfter === 3) {
    return {
      steps: { 1: step1, 2: step2, 3: step3, 4: skippedStep<VarietyPackGridStep4>(4, 'insufficient_row_bands') },
      lastOkStep: 2,
      plan: null,
      ctx,
    };
  }

  const step4 = runVarietyPackGridStep4(ctx, step3.data!);
  const plan =
    step4.validation.ok && step3.data!.layout === 'shared_rail'
      ? buildSharedLabelPlanFromPipeline(ctx, step2.data!, step3.data!)
      : null;

  return {
    steps: { 1: step1, 2: step2, 3: step3, 4: step4 },
    lastOkStep: step4.validation.ok ? 4 : 3,
    plan,
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
