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
  /** Step 3 layout must not equal this (e.g. ice cream vs shared_rail). */
  forbidLayout?: 'shared_rail' | 'per_column_labels';
  expectFailStep?: 1 | 2 | 3 | 4;
  expectFailCode?: string;
  notes?: string;
};

export type SplitSingleLabelExpectation = {
  expectDetect?: boolean;
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
};

export type TestImageManifest = {
  version: number;
  fixtures: TestImageFixture[];
};
