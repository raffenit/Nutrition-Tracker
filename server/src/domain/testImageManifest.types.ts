/** Schema for local/test-images/manifest.json (gitignored). Example: local.example/test-images-manifest.example.json */
/** Layout vocabulary: docs/label-table-terminology.md */

export type TestImageLayout = 'shared_rail' | 'split_single' | 'single' | 'per_column_labels';

/** Expectations for the variety pack pipeline (`runVarietyPackGridPipeline`) — any step-3 layout. */
export type VarietyPackPipelineExpectation = {
  expectRun?: boolean;
  expectLastOkStep?: 1 | 2 | 3 | 4;
  expectSharedRailPlan?: boolean;
  /** Fail if plan has fewer value columns. */
  minValueColumns?: number;
  /** Slack vs `nutrientRows` total when comparing `plan.rowBandSlices` (default ±1). */
  rowBandSliceCountTolerance?: number;
  /** Step 3 layout must not equal this (e.g. ice cream vs shared_rail). */
  forbidLayout?: 'shared_rail' | 'per_column_labels';
  expectFailStep?: 1 | 2 | 3 | 4;
  expectFailCode?: string;
  notes?: string;
};

export type SplitSingleLabelExpectation = {
  expectDetect?: boolean;
};

/** Ink-envelope + ruled shape gate (`resolveLabelOcrSources` / `applyGatedPortraitPanelCrop`). */
export type PanelShapeGateExpectation = {
  /** Tall single should enter portrait crop path (`shouldTryPortraitPanelCrop`). */
  expectPortraitCropEligible: boolean;
  /** `wideBandInkEnvelopeCropRect` + `assessNutritionFactsLabelShape`. */
  expectInkEnvelopeShapeOk: boolean;
  /** Shape-gated panel applied to page OCR (`resolveLabelOcrSources`). */
  expectGatedPanelCrop: boolean;
  /** When expectGatedPanelCrop, strategy id (e.g. ink_envelope). */
  expectGatedStrategy?: 'ink_envelope' | 'center_band' | 'laplacian_vertical';
  /** Substrings expected in shape reject reasons when ink envelope must fail. */
  expectInkEnvelopeRejectSubstrings?: string[];
};

/**
 * Human-counted nutrient rows on the physical label (not OCR slice count).
 * Shared-rail variety tables: rows in the left label column / grid.
 * Single panels: same sections as a standard Nutrition Facts block.
 */
export type NutrientRowGroundTruth = {
  /** Rows in the primary nutrient block (above the secondary / vitamin-mineral block). */
  mainSectionRows: number;
  /** Rows in the secondary block (vitamins, minerals, etc. below the main block). */
  secondarySectionRows: number;
  /** Optional layout cues (e.g. dot leaders vs ruled grid) — not used by geometry yet. */
  notes?: string;
};

export function totalNutrientRowsFromGroundTruth(rows: NutrientRowGroundTruth): number {
  return rows.mainSectionRows + rows.secondarySectionRows;
}

export type TestImageFixture = {
  file: string;
  description?: string;
  layout: TestImageLayout;
  /** Product value columns only; null when N/A. */
  valueColumnCount: number | null;
  /** Required on every fixture in local/test-images/manifest.json. */
  nutrientRows: NutrientRowGroundTruth;
  varietyPackPipeline?: VarietyPackPipelineExpectation;
  splitSingleLabel?: SplitSingleLabelExpectation;
  panelShapeGate?: PanelShapeGateExpectation;
  nutrientGroundTruthRegression?: Record<string, unknown>;
  /** Wall-clock budget for `ocr:local-test-images`; `trackOnly` logs OVER without failing. */
  ocrPerformanceRegression?: OcrPerformanceRegressionSpec;
};

export type OcrPerformanceRegressionSpec = {
  trackMaxSeconds: number;
  trackOnly?: boolean;
};

export type TestImageManifest = {
  version: number;
  fixtures: TestImageFixture[];
};
