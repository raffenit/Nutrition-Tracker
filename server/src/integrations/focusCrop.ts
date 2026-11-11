import type { Sharp } from 'sharp';
import {
  DEFAULT_FOCUS_CROP_PARAMS,
  resolveFocusCropParams,
  type FocusCropOptions,
  type FocusCropParams,
} from '../domain/focusCropParams.js';
import { minCropSidePx, minSideLengthPx } from '../domain/imageAnalysisGeometry.js';
import { bandToAnalysisSize, resampleGreyscaleNearest } from './imageAnalysisResample.js';

export type { FocusCropOptions } from '../domain/focusCropParams.js';
export { DEFAULT_FOCUS_CROP_PARAMS, resolveFocusCropParams } from '../domain/focusCropParams.js';

export type FocusCropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Vertical + horizontal crops biased toward the sharpest region (depth-of-field). */
export async function focusCropVariants(source: Sharp, options?: FocusCropOptions): Promise<Sharp[]> {
  const params = resolveFocusCropParams(options?.geometry);
  const variants: Sharp[] = [];
  const meta = await source.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const minSide = minSideLengthPx(params.analysisWidth);
  if (width < minSide || height < minSide) return variants;

  const widthFraction = options?.preserveFullWidth ? 1 : params.centerBandWidthFraction;
  variants.push(centerBandCrop(source, width, height, params.centerBandHeightFraction, widthFraction, params));

  const guided = await laplacianBandCrop(source, width, height, params, options?.preserveFullWidth);
  if (guided) variants.push(guided);

  return variants;
}

function centerBandCrop(
  source: Sharp,
  width: number,
  height: number,
  heightFraction: number,
  widthFraction: number,
  params: FocusCropParams,
): Sharp {
  const cropH = Math.max(minCropSidePx(height, params.minCropSideFraction), Math.round(height * heightFraction));
  const cropW = Math.max(minCropSidePx(width, params.minCropSideFraction), Math.round(width * widthFraction));
  const top = Math.max(0, Math.round((height - cropH) / 2));
  const left = Math.max(0, Math.round((width - cropW) / 2));
  return source.clone().extract({ left, top, width: cropW, height: cropH });
}

async function laplacianBandCrop(
  source: Sharp,
  fullWidth: number,
  fullHeight: number,
  params: FocusCropParams,
  preserveFullWidth?: boolean,
): Promise<Sharp | null> {
  const { analysisW, analysisH } = bandToAnalysisSize(
    fullWidth,
    fullHeight,
    params.analysisWidth,
    params.minAnalysisWidthFraction,
    params.minAnalysisHeightFraction,
  );

  const { data } = await source
    .clone()
    .resize({ width: analysisW, height: analysisH, fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rect = laplacianFocusRectFromGreyBand(
    new Uint8Array(data),
    analysisW,
    analysisH,
    fullWidth,
    fullHeight,
    params,
    preserveFullWidth,
  );
  if (!rect) return null;

  return source.clone().extract({
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    width: Math.min(rect.width, fullWidth - rect.left),
    height: Math.min(rect.height, fullHeight - rect.top),
  });
}

/** Test hook: laplacian-guided crop in full-image coordinates. */
export function laplacianFocusRectForTest(
  pixels: Uint8Array,
  fullWidth: number,
  fullHeight: number,
  options?: FocusCropOptions,
): FocusCropRect | null {
  const params = resolveFocusCropParams(options?.geometry);
  const { analysisW, analysisH } = bandToAnalysisSize(
    fullWidth,
    fullHeight,
    params.analysisWidth,
    params.minAnalysisWidthFraction,
    params.minAnalysisHeightFraction,
  );
  const normalized = resampleGreyscaleNearest(pixels, fullWidth, fullHeight, analysisW, analysisH);
  return laplacianFocusRectFromGreyBand(
    normalized,
    analysisW,
    analysisH,
    fullWidth,
    fullHeight,
    params,
    options?.preserveFullWidth,
  );
}

function laplacianFocusRectFromGreyBand(
  pixels: Uint8Array,
  analysisW: number,
  analysisH: number,
  fullWidth: number,
  fullHeight: number,
  params: FocusCropParams,
  preserveFullWidth?: boolean,
): FocusCropRect | null {
  const rowScore = new Float64Array(analysisH);
  for (let y = 1; y < analysisH - 1; y += 1) {
    let sum = 0;
    for (let x = 1; x < analysisW - 1; x += 1) {
      const index = y * analysisW + x;
      const gx = Math.abs(pixels[index + 1]! - pixels[index - 1]!);
      const gy = Math.abs(pixels[index + analysisW]! - pixels[index - analysisW]!);
      sum += gx + gy;
    }
    rowScore[y] = sum / analysisW;
  }

  const bandRows = Math.max(
    Math.round(analysisH * params.laplacianBandMinHeightFraction),
    Math.round(analysisH * params.laplacianBandHeightFraction),
  );
  let bestStart = 0;
  let bestTotal = -1;
  for (let start = 0; start <= analysisH - bandRows; start += 1) {
    let total = 0;
    for (let y = start; y < start + bandRows; y += 1) total += rowScore[y]!;
    if (total > bestTotal) {
      bestTotal = total;
      bestStart = start;
    }
  }

  const margin = Math.round(analysisH * params.laplacianVerticalMarginFraction);
  const y1 = Math.max(0, bestStart - margin);
  const y2 = Math.min(analysisH, bestStart + bandRows + margin);
  const top = Math.round((y1 / analysisH) * fullHeight);
  const cropH = Math.max(
    minCropSidePx(fullHeight, params.minCropSideFraction),
    Math.round(((y2 - y1) / analysisH) * fullHeight),
  );
  const cropW = preserveFullWidth
    ? fullWidth
    : Math.max(minCropSidePx(fullWidth, params.minCropSideFraction), Math.round(fullWidth * params.guidedCropWidthFraction));
  const left = preserveFullWidth ? 0 : Math.round((fullWidth - cropW) / 2);

  if (cropH >= fullHeight * params.nearFullImageFraction && cropW >= fullWidth * params.nearFullImageFraction) {
    return null;
  }

  return { left, top, width: cropW, height: cropH };
}
