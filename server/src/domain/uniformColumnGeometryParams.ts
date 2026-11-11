import { IMAGE_ANALYSIS_WIDTH } from './imageAnalysisGeometry.js';

export type UniformColumnGeometryParams = {
  maxWideToNominalRatio: number;
  maxWidthCv: number;
  minHorizontalRulesPerColumn: number;
};

const W = IMAGE_ANALYSIS_WIDTH;

export const DEFAULT_UNIFORM_COLUMN_GEOMETRY_PARAMS: UniformColumnGeometryParams = {
  maxWideToNominalRatio: 1.55,
  maxWidthCv: 22 / W,
  minHorizontalRulesPerColumn: 3,
};
