/** Schema for local/test-images/manifest.json (gitignored). Example: local.example/test-images-manifest.example.json */

export type TestImageLayout = 'shared_rail' | 'split_single' | 'single' | 'per_column_labels';

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

export type TestImageFixture = {
  file: string;
  description?: string;
  layout: TestImageLayout;
  /** Product value columns only; null when N/A. */
  valueColumnCount: number | null;
  varietyPackPipeline?: VarietyPackPipelineExpectation;
  splitSingleLabel?: SplitSingleLabelExpectation;
};

export type TestImageManifest = {
  version: number;
  fixtures: TestImageFixture[];
};
