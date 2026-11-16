import type { SharedLabelGridParams } from './sharedLabelGridParams.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from './sharedLabelGridParams.js';
import type { RuledTableGridParams } from './ruledTableGridParams.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from './ruledTableGridParams.js';
import {
  buildColumnInkProfileFromBand,
  ruledGridBandPixels,
  type WideBandAnalysis,
} from '../integrations/labelColumnStrips.js';
import { sharedLabelBoundaryForTest } from '../integrations/sharedLabelValueGrid.js';
import { categoriesFromRuledGrid, nutritionTableRightAnalysisX } from '../integrations/ruledTableGridDetect.js';
import { trimTrailingIrregularValueColumns } from '../integrations/uniformColumnGeometry.js';
import { nutritionTableInkSpanAnalysisX } from './nutritionTableInkBounds.js';

/** Table right edge for detection-band crop (drop packaging margin without losing uniform outer product stacks). */
function nutritionTableCropRightAnalysisX(
  pixels: Uint8Array,
  ruledPixels: Uint8Array,
  width: number,
  height: number,
  labelBoundaryX: number,
): number {
  const inkTrimRight = nutritionTableRightAnalysisX(pixels, width, height, labelBoundaryX);
  const looseRuled = categoriesFromRuledGrid(ruledPixels, width, height, labelBoundaryX, undefined, 32, {
    requireHorizontalRules: false,
  });
  const { segments: ruledSegs } = trimTrailingIrregularValueColumns(
    looseRuled.map((s) => ({ x0: s.x0, x1: s.x1 })),
    looseRuled.map((s) => ({ horizontalRuleCount: s.horizontalRuleCount })),
  );
  const ruledTrimRight = ruledSegs[ruledSegs.length - 1]?.x1 ?? inkTrimRight;
  const slack = Math.max(8, Math.round(width * 0.04));
  const ruledTail = ruledSegs[ruledSegs.length - 1];
  if (
    ruledTrimRight > inkTrimRight + slack &&
    ruledTail &&
    ruledTail.x0 >= inkTrimRight - slack
  ) {
    const tailW = ruledTail.x1 - ruledTail.x0;
    const marginCap = Math.max(16, Math.round((inkTrimRight - labelBoundaryX) * 0.07));
    if (tailW <= marginCap) return inkTrimRight;
  }
  if (inkTrimRight + slack < ruledTrimRight) {
    const looseInk = categoriesFromRuledGrid(pixels, width, height, labelBoundaryX, undefined, 32, {
      requireHorizontalRules: false,
    });
    const { segments: inkSegs } = trimTrailingIrregularValueColumns(
      looseInk.map((s) => ({ x0: s.x0, x1: s.x1 })),
      looseInk.map((s) => ({ horizontalRuleCount: s.horizontalRuleCount })),
    );
    if (ruledSegs.length > inkSegs.length) return ruledTrimRight;
  }
  return Math.min(ruledTrimRight, Math.max(inkTrimRight, width));
}

export function sliceAnalysisBandPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): Uint8Array {
  const cropW = Math.max(1, x1 - x0);
  const out = new Uint8Array(cropW * height);
  for (let y = 0; y < height; y += 1) {
    out.set(pixels.subarray(y * width + x0, y * width + x1), y * cropW);
  }
  return out;
}

/** Drop bright packaging margin on the right when it is not part of the ruled table ink. */
function openBrightMarginRightX(pixels: Uint8Array, width: number, height: number): number {
  const y0 = Math.max(0, Math.round(height * 0.12));
  const y1 = Math.min(height, Math.round(height * 0.88));
  for (let x = width - 1; x >= 0; x -= 1) {
    let bright = 0;
    let total = 0;
    for (let y = y0; y < y1; y += 1) {
      total += 1;
      if (pixels[y * width + x]! >= 205) bright += 1;
    }
    if (total > 0 && bright / total < 0.9) return Math.min(width, x + 1);
  }
  return width;
}

function provisionalLabelBoundaryAnalysisX(
  pixels: Uint8Array,
  analysisW: number,
  analysisH: number,
  shared: SharedLabelGridParams,
): number | null {
  const profile = buildColumnInkProfileFromBand(pixels, analysisW, analysisH);
  return sharedLabelBoundaryForTest(profile, shared);
}

/**
 * Drop packaging / ingredients margins from the greyscale detection band so ruled-grid analysis
 * runs only on the nutrition table ink span.
 */
export function cropWideBandAnalysisToNutritionGrid(
  bandAnalysis: WideBandAnalysis,
  shared: SharedLabelGridParams = DEFAULT_SHARED_LABEL_GRID_PARAMS,
  ruledParams: Partial<RuledTableGridParams> = {},
): WideBandAnalysis {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...ruledParams };
  const { pixels, analysisW, analysisH, band } = bandAnalysis;
  const ruledPixels = ruledGridBandPixels(bandAnalysis);
  // Ruled-only greyscale can truncate horizontal ink on foreshortened outer columns (Costco fan).
  // Crop from contrasted band ink; ruled pixels are still sliced for grid detection after crop.
  const boundary = provisionalLabelBoundaryAnalysisX(pixels, analysisW, analysisH, shared);
  if (boundary === null || boundary < 8) return bandAnalysis;

  const spanInk = nutritionTableInkSpanAnalysisX(pixels, analysisW, analysisH, boundary, p);
  const spanRuled = nutritionTableInkSpanAnalysisX(ruledPixels, analysisW, analysisH, boundary, p);
  const cropRightX = nutritionTableCropRightAnalysisX(pixels, ruledPixels, analysisW, analysisH, boundary);
  const ruledUndercutsInk =
    spanRuled.right < spanInk.right - Math.max(8, Math.round(analysisW * 0.04));
  const tableRight = ruledUndercutsInk
    ? Math.min(analysisW, Math.max(cropRightX, spanInk.right))
    : cropRightX;
  const span = {
    left: Math.min(spanInk.left, spanRuled.left),
    right: tableRight,
  };
  const minLabelKeep = Math.max(8, Math.round(analysisW * shared.labelColumnMinWidthFraction));
  const maxLabelRail = Math.max(
    minLabelKeep,
    Math.round(analysisW * shared.labelColumnMaxWidthFraction),
  );
  const labelRailLeft = Math.max(0, boundary - maxLabelRail);
  const leftCropCap =
    boundary > minLabelKeep ? boundary - minLabelKeep : Math.max(span.left, labelRailLeft);
  const cropLeft = Math.max(labelRailLeft, Math.min(span.left, leftCropCap));
  const cropRight = Math.min(
    span.right,
    openBrightMarginRightX(pixels, analysisW, analysisH),
    openBrightMarginRightX(ruledPixels, analysisW, analysisH),
  );
  const spanW = cropRight - cropLeft;
  const minSpan = Math.max(24, Math.round(analysisW * p.nutritionTableMinCropSpanWidthFraction));
  if (spanW < minSpan) return bandAnalysis;
  if (cropLeft <= 1 && cropRight >= analysisW - 1) return bandAnalysis;

  const croppedPixels = sliceAnalysisBandPixels(pixels, analysisW, analysisH, cropLeft, cropRight);
  const croppedRuledPixels =
    bandAnalysis.ruledGridPixels !== undefined
      ? sliceAnalysisBandPixels(ruledPixels, analysisW, analysisH, cropLeft, cropRight)
      : undefined;
  const mapImageX = (analysisX: number) =>
    band.left + Math.round((analysisX / Math.max(1, analysisW)) * band.width);
  const newLeft = mapImageX(cropLeft);
  const newRight = mapImageX(cropRight);
  const labelBoundaryX = Math.max(1, Math.min(spanW - 1, boundary - cropLeft));
  const tableRightAnalysisX = Math.max(
    labelBoundaryX + 1,
    Math.min(spanW, Math.max(1, cropRightX - cropLeft)),
  );

  return {
    ...bandAnalysis,
    pixels: croppedPixels,
    ...(croppedRuledPixels !== undefined ? { ruledGridPixels: croppedRuledPixels } : {}),
    analysisW: spanW,
    band: {
      ...band,
      left: newLeft,
      width: Math.max(1, newRight - newLeft),
    },
    inkGridCropped: { labelBoundaryX, tableRightAnalysisX },
  };
}