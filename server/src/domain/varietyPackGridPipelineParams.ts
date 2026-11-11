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
};
