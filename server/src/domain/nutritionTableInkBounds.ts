import type { BandLuminanceRoles } from './bandLuminanceRoles.js';
import type { RuledTableGridParams } from './ruledTableGridParams.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from './ruledTableGridParams.js';
import { classifyBandLuminanceInScanBand } from '../integrations/bandLuminanceCluster.js';
import type { InkGridCropMeta } from '../integrations/labelColumnStrips.js';
import {
  nutritionTableLeftAnalysisX,
  nutritionTableRightAnalysisX,
} from '../integrations/ruledTableGridDetect.js';

export type NutritionTableInkSpanContext = {
  inkGridCropped?: InkGridCropMeta;
  analysisW?: number;
};

/** Ruled nutrition grid horizontal extent in analysis x (excludes packaging + ingredients). */
export function nutritionTableInkSpanAnalysisX(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryX: number,
  params: Partial<RuledTableGridParams> = {},
  grid?: NutritionTableInkSpanContext,
): { left: number; right: number } {
  if (grid?.inkGridCropped) {
    const w = grid.analysisW ?? width;
    return { left: 0, right: w };
  }
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const right = nutritionTableRightAnalysisX(pixels, width, height, labelBoundaryX);
  const left = nutritionTableLeftAnalysisX(pixels, width, height, labelBoundaryX, right, p);
  return { left, right };
}

/** Ink/background roles sampled on the ruled table only (all product + label columns, same polarity). */
export function classifyNutritionTableBandLuminance(
  pixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryX: number,
  params: Partial<RuledTableGridParams> = {},
  grid?: NutritionTableInkSpanContext,
): BandLuminanceRoles {
  const { left, right } = nutritionTableInkSpanAnalysisX(
    pixels,
    width,
    height,
    labelBoundaryX,
    params,
    grid,
  );
  return classifyBandLuminanceInScanBand(pixels, width, height, left, Math.max(left + 1, right));
}