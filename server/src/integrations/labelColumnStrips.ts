import sharp, { type Sharp } from 'sharp';
import {
  DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
  resolveColumnStripParams,
  type ColumnStripDetectOptions,
  type ColumnStripDetectParams,
} from '../domain/columnStripDetectParams.js';
import { WIDE_PANEL_MIN_ASPECT } from '../domain/labelLayout.js';
import { bandToAnalysisSize, resampleGreyscaleNearest } from './imageAnalysisResample.js';

export type { ColumnStripDetectOptions } from '../domain/columnStripDetectParams.js';
export { DEFAULT_COLUMN_STRIP_DETECT_PARAMS, resolveColumnStripParams } from '../domain/columnStripDetectParams.js';

export type ColumnStripRegion = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ColumnStripPlan = {
  band: { left: number; top: number; width: number; height: number };
  strips: ColumnStripRegion[];
};

/**
 * Part B — locate vertical column strips on a wide nutrition-facts table image.
 * Returns null when the image is not wide enough or gutters are not separable.
 */
export async function detectColumnStrips(
  bytes: Buffer,
  options?: ColumnStripDetectOptions,
): Promise<ColumnStripPlan | null> {
  const params = resolveColumnStripParams(options?.geometry);
  const minColumns = options?.minColumns ?? 2;
  const maxColumns = options?.maxColumns ?? params.maxColumns;
  const minStripWidthFraction = options?.minStripWidthFraction ?? params.minStripWidthFraction;
  const requireWide = options?.requireWideAspect ?? true;

  const minFullWidth = Math.round(params.analysisWidth * params.minImageWidthFraction);
  const minFullHeight = Math.round(params.analysisWidth * params.minImageHeightFraction);

  const bandAnalysis = await prepareWideBandAnalysis(bytes, params, 'detection');
  if (!bandAnalysis) return null;
  if (requireWide && bandAnalysis.fullWidth / bandAnalysis.fullHeight < WIDE_PANEL_MIN_ASPECT) return null;

  const ocrBandAnalysis = await prepareWideBandAnalysis(bytes, params, 'ocr');
  const ocrBand = ocrBandAnalysis?.band ?? bandAnalysis.band;

  const { band: detectionBand, analysisW } = bandAnalysis;

  const boundaries = columnBoundariesFromGreyBand(bandAnalysis.pixels, bandAnalysis.analysisW, bandAnalysis.analysisH, {
    ...params,
    minStripWidthFraction,
    maxColumns,
  });
  if (boundaries.length < minColumns) return null;

  const minOutputWidth = Math.max(1, Math.round(bandAnalysis.fullWidth * params.minOutputStripWidthFraction));
  const strips: ColumnStripRegion[] = boundaries.map((segment, index) => {
    const left = detectionBand.left + Math.round((segment.x0 / analysisW) * detectionBand.width);
    const right = detectionBand.left + Math.round((segment.x1 / analysisW) * detectionBand.width);
    const width = Math.max(minOutputWidth, right - left);
    const vertical = verticalExtentForOcrCrops(ocrBand);
    return { index, left, top: vertical.top, width, height: vertical.height };
  });

  return { band: ocrBand, strips };
}

/**
 * Greyscale band in analysis space.
 * {@link WideBandPurpose.detection} — centered (ink projection / gutters).
 * {@link WideBandPurpose.ocr} — top-inset on wide panels (strip OCR crops).
 */
export async function prepareWideBandAnalysis(
  bytes: Buffer,
  params: ColumnStripDetectParams = DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
  purpose: WideBandPurpose = 'detection',
): Promise<WideBandAnalysis | null> {
  const minFullWidth = Math.round(params.analysisWidth * params.minImageWidthFraction);
  const minFullHeight = Math.round(params.analysisWidth * params.minImageHeightFraction);

  const source = sharp(bytes).rotate();
  const meta = await source.metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;
  if (fullWidth < minFullWidth || fullHeight < minFullHeight) return null;

  const bandW = fullWidth;
  const bandH = Math.max(
    Math.round(fullHeight * params.minBandHeightFloorFraction),
    Math.round(fullHeight * params.bandHeightFraction),
  );
  const wide = fullWidth / fullHeight >= WIDE_PANEL_MIN_ASPECT;
  const bandTop =
    purpose === 'ocr' && wide
      ? Math.max(0, Math.round(fullHeight * params.bandTopInsetFraction))
      : Math.max(0, Math.round((fullHeight - bandH) / 2));
  const clampedHeight = Math.min(bandH, Math.max(1, fullHeight - bandTop));
  const band = { left: 0, top: bandTop, width: bandW, height: clampedHeight };

  const { analysisW, analysisH } = bandToAnalysisSize(
    bandW,
    bandH,
    params.analysisWidth,
    params.minAnalysisWidthFraction,
    params.minAnalysisHeightFraction,
  );

  let analysisPipeline = source
    .clone()
    .extract({ left: band.left, top: band.top, width: band.width, height: band.height })
    .resize({ width: analysisW, height: analysisH, fit: 'fill' })
    .greyscale();
  analysisPipeline = applyBandContrast(analysisPipeline, params);
  const { data } = await analysisPipeline.raw().toBuffer({ resolveWithObject: true });

  return {
    band,
    fullWidth,
    fullHeight,
    analysisW,
    analysisH,
    pixels: new Uint8Array(data),
  };
}

/** Test + shared-label path: ink projection already in analysis space. */
export function columnBoundariesFromInkProfile(
  profile: Float64Array,
  params: ColumnStripDetectParams & { maxColumns: number; minStripWidthFraction?: number },
): Segment[] {
  const smoothRadius = Math.max(1, Math.round(params.smoothRadiusFraction * profile.length));
  const smoothed = smoothProfile(profile, smoothRadius);
  return splitBoundariesFromProfile(smoothed, {
    ...params,
    minStripWidthFraction: params.minStripWidthFraction ?? DEFAULT_COLUMN_STRIP_DETECT_PARAMS.minStripWidthFraction,
  });
}

export function buildColumnInkProfileFromBand(pixels: Uint8Array, width: number, height: number): Float64Array {
  return buildColumnInkProfile(pixels, width, height);
}

/** Crop each strip to a PNG buffer (for per-column OCR in a later slice). */
export async function extractColumnStripBuffers(bytes: Buffer, plan: ColumnStripPlan): Promise<Buffer[]> {
  const base = sharp(bytes).rotate();
  const meta = await base.metadata();
  const maxW = meta.width ?? 0;
  const maxH = meta.height ?? 0;
  const buffers: Buffer[] = [];
  for (const strip of plan.strips) {
    const width = Math.min(strip.width, Math.max(1, maxW - strip.left));
    const height = Math.min(strip.height, Math.max(1, maxH - strip.top));
    buffers.push(
      await base.clone().extract({ left: strip.left, top: strip.top, width, height }).png().toBuffer(),
    );
  }
  return buffers;
}

type Segment = { x0: number; x1: number };

export type WideBandPurpose = 'detection' | 'ocr';

export type WideBandAnalysis = {
  band: { left: number; top: number; width: number; height: number };
  fullWidth: number;
  fullHeight: number;
  analysisW: number;
  analysisH: number;
  pixels: Uint8Array;
};

function verticalExtentForOcrCrops(
  ocrBand: WideBandAnalysis['band'],
): Pick<ColumnStripRegion, 'top' | 'height'> {
  return { top: ocrBand.top, height: ocrBand.height };
}

export type ColumnBoundariesTestOptions = {
  minStripWidthFraction?: number;
  maxColumns?: number;
  geometry?: Partial<ColumnStripDetectParams>;
};

/** Test hook: same resample + projection path as production, on a greyscale band. */
export function columnBoundariesForTest(
  pixels: Uint8Array,
  width: number,
  height: number,
  options?: ColumnBoundariesTestOptions,
): Segment[] {
  const params = resolveColumnStripParams(options?.geometry);
  const { analysisW, analysisH } = bandToAnalysisSize(
    width,
    height,
    params.analysisWidth,
    params.minAnalysisWidthFraction,
    params.minAnalysisHeightFraction,
  );
  const normalized = enhanceGreyBand(
    resampleGreyscaleNearest(pixels, width, height, analysisW, analysisH),
    params,
  );
  const boundaries = columnBoundariesFromGreyBand(normalized, analysisW, analysisH, {
    ...params,
    minStripWidthFraction: options?.minStripWidthFraction ?? params.minStripWidthFraction,
    maxColumns: options?.maxColumns ?? params.maxColumns,
  });
  return boundaries.map((segment) => ({
    x0: Math.round((segment.x0 / analysisW) * width),
    x1: Math.round((segment.x1 / analysisW) * width),
  }));
}

function columnBoundariesFromGreyBand(
  pixels: Uint8Array,
  analysisW: number,
  analysisH: number,
  params: ColumnStripDetectParams & { maxColumns: number },
): Segment[] {
  const profile = buildColumnInkProfile(pixels, analysisW, analysisH);
  return columnBoundariesFromInkProfile(profile, params);
}

function buildColumnInkProfile(pixels: Uint8Array, width: number, height: number): Float64Array {
  const profile = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      sum += 255 - pixels[y * width + x]!;
    }
    profile[x] = sum / height;
  }
  return profile;
}

function smoothProfile(profile: Float64Array, radius: number): Float64Array {
  const out = new Float64Array(profile.length);
  for (let x = 0; x < profile.length; x += 1) {
    let sum = 0;
    let count = 0;
    for (let dx = -radius; dx <= radius; dx += 1) {
      const i = x + dx;
      if (i < 0 || i >= profile.length) continue;
      sum += profile[i]!;
      count += 1;
    }
    out[x] = count > 0 ? sum / count : 0;
  }
  return out;
}

function splitBoundariesFromProfile(profile: Float64Array, params: ColumnStripDetectParams): Segment[] {
  const max = profile.reduce((peak, value) => Math.max(peak, value), 0);
  if (max <= 0) return [];
  const gutterLevel = max * params.gutterThresholdRatio;
  const minWidth = Math.max(
    1,
    Math.round(profile.length * params.minSegmentWidthFraction),
    Math.round(profile.length * params.minStripWidthFraction),
  );
  const minGutterSpacing = Math.max(1, Math.round(profile.length * params.minGutterSpacingFraction));

  const minRadius = Math.max(
    1,
    Math.round(profile.length * (params.gutterLocalMinimumRadiusFraction ?? 1 / profile.length)),
  );

  const gutterCenters = selectGutterCenters(profile, {
    gutterLevel,
    minRadius,
    minGutterSpacing,
    minWidth,
    maxColumns: params.maxColumns,
    prominence: params.gutterProminenceFraction,
    prominenceRelax: params.gutterProminenceRelaxFraction,
  });

  const edges = [0, ...gutterCenters, profile.length];
  const segments: Segment[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const x0 = edges[i]!;
    const x1 = edges[i + 1]!;
    if (x1 - x0 < minWidth) continue;
    segments.push({ x0, x1 });
  }

  if (segments.length > params.maxColumns) {
    return mergeNarrowestSegments(segments, params.maxColumns);
  }
  return segments;
}

function selectGutterCenters(
  profile: Float64Array,
  options: {
    gutterLevel: number;
    minRadius: number;
    minGutterSpacing: number;
    minWidth: number;
    maxColumns: number;
    prominence: number;
    prominenceRelax: number;
  },
): number[] {
  const minSegments = 2;
  const attemptLevels = uniqueProminenceAttempts(options.prominence, options.prominenceRelax);
  let best: number[] = [];
  for (const prominence of attemptLevels) {
    const centers = collectGutterCenters(profile, options, prominence);
    const segmentCount = countSegmentsForGutters(profile.length, centers, options.minWidth);
    if (segmentCount >= minSegments) {
      if (segmentCount <= options.maxColumns) return centers;
      best = centers;
    }
  }
  if (best.length > 0) return best;
  return collectGutterCenters(profile, options, 0);
}

function uniqueProminenceAttempts(prominence: number, relax: number): number[] {
  const levels = [prominence, prominence * 0.65, relax, 0];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const level of levels) {
    const rounded = Math.round(level * 1000) / 1000;
    if (seen.has(rounded)) continue;
    seen.add(rounded);
    out.push(rounded);
  }
  return out;
}

function collectGutterCenters(
  profile: Float64Array,
  options: {
    gutterLevel: number;
    minRadius: number;
    minGutterSpacing: number;
  },
  prominenceFraction: number,
): number[] {
  const gutterCenters: number[] = [];
  for (let x = options.minRadius; x < profile.length - options.minRadius; x += 1) {
    if (!isGutterMinimum(profile, x, options.gutterLevel, options.minRadius)) continue;
    if (prominenceFraction > 0 && !gutterHasProminence(profile, x, options.minGutterSpacing, prominenceFraction)) {
      continue;
    }
    const last = gutterCenters[gutterCenters.length - 1];
    if (last !== undefined && x - last < options.minGutterSpacing) continue;
    gutterCenters.push(x);
  }
  return gutterCenters;
}

function countSegmentsForGutters(profileLength: number, gutterCenters: number[], minWidth: number): number {
  const edges = [0, ...gutterCenters, profileLength];
  let count = 0;
  for (let i = 0; i < edges.length - 1; i += 1) {
    if (edges[i + 1]! - edges[i]! >= minWidth) count += 1;
  }
  return count;
}

function applyBandContrast(pipeline: Sharp, params: ColumnStripDetectParams): Sharp {
  if (params.profileContrastSlope === 1 && params.profileContrastIntercept === 0) {
    return pipeline;
  }
  return pipeline.linear(params.profileContrastSlope, params.profileContrastIntercept).normalize();
}

function enhanceGreyBand(pixels: Uint8Array, params: ColumnStripDetectParams): Uint8Array {
  if (params.profileContrastSlope === 1 && params.profileContrastIntercept === 0) {
    return pixels;
  }
  const out = new Uint8Array(pixels.length);
  for (let index = 0; index < pixels.length; index += 1) {
    out[index] = Math.max(
      0,
      Math.min(255, Math.round(pixels[index]! * params.profileContrastSlope + params.profileContrastIntercept)),
    );
  }
  let min = 255;
  let max = 0;
  for (const value of out) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (max <= min) return out;
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Math.round(((out[index]! - min) / (max - min)) * 255);
  }
  return out;
}

function isGutterMinimum(profile: Float64Array, x: number, gutterLevel: number, radius: number): boolean {
  const value = profile[x]!;
  if (value > gutterLevel) return false;
  for (let dx = -radius; dx <= radius; dx += 1) {
    if (dx === 0) continue;
    const index = x + dx;
    if (index < 0 || index >= profile.length) continue;
    if (profile[index]! < value) return false;
  }
  return true;
}

function gutterHasProminence(
  profile: Float64Array,
  x: number,
  window: number,
  prominenceFraction: number,
): boolean {
  const value = profile[x]!;
  const leftFrom = Math.max(0, x - window);
  const leftTo = Math.max(leftFrom, x - 1);
  const rightFrom = Math.min(profile.length - 1, x + 1);
  const rightTo = Math.min(profile.length - 1, x + window);

  const leftPeak = peakInRange(profile, leftFrom, leftTo);
  const rightPeak = peakInRange(profile, rightFrom, rightTo);
  const neighborPeak = Math.min(leftPeak, rightPeak);
  if (neighborPeak <= 0) return false;
  return value <= neighborPeak * (1 - prominenceFraction);
}

function peakInRange(profile: Float64Array, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i <= to; i += 1) {
    peak = Math.max(peak, profile[i]!);
  }
  return peak;
}

function mergeNarrowestSegments(segments: Segment[], target: number): Segment[] {
  let current = [...segments];
  while (current.length > target) {
    let narrowest = 0;
    for (let i = 1; i < current.length; i += 1) {
      if (current[i]!.x1 - current[i]!.x0 < current[narrowest]!.x1 - current[narrowest]!.x0) {
        narrowest = i;
      }
    }
    const neighbor = narrowest === 0 ? 1 : narrowest - 1;
    const a = current[narrowest]!;
    const b = current[neighbor]!;
    const merged = {
      x0: Math.min(a.x0, b.x0),
      x1: Math.max(a.x1, b.x1),
    };
    const next = current.filter((_, index) => index !== narrowest && index !== neighbor);
    next.push(merged);
    next.sort((left, right) => left.x0 - right.x0);
    current = next;
  }
  return current;
}
