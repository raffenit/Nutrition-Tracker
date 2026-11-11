import sharp from 'sharp';
import { minCropSidePx } from '../domain/imageAnalysisGeometry.js';
import {
  FOCUS_COLUMN_THRESHOLD_RATIO,
  FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION,
  FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION,
  FOCUS_HINT_ANALYSIS,
  FOCUS_REGION_MARGIN_FRACTION,
  MULTI_COLUMN_FOCUS_MIN_PEAKS,
  SINGLE_SUBJECT_FOCUS_MAX_WIDTH_FRACTION,
} from '../domain/labelFocusParams.js';
import { bandToAnalysisSize } from './imageAnalysisResample.js';

export type FocusRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DepthOfFieldHint = {
  /** Width fraction (0–1) of the analysis canvas that is sharply in focus. */
  sharpFocusWidthFraction: number;
  /** True when depth-of-field implies one intentional label (blur the rest). */
  singleSubjectInFocus: boolean;
  /** Sharp peaks along the width profile (multi-column table in focus when high). */
  sharpPeakCount: number;
  /** Oriented-image crop that keeps the in-focus band when {@link shouldApplyFocusCrop} is true. */
  focusRegion: FocusRegion | null;
};

export type FocusCropGateInput = Pick<
  DepthOfFieldHint,
  'sharpFocusWidthFraction' | 'sharpPeakCount' | 'focusRegion' | 'singleSubjectInFocus'
>;

/** True when trimming soft sides helps OCR without cutting a variety table or over-cropping. */
export function shouldApplyFocusCrop(focus: FocusCropGateInput, fullWidth: number): boolean {
  if (!focus.focusRegion || fullWidth < 1) return false;
  if (focus.sharpFocusWidthFraction >= FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION) return false;
  if (focus.sharpPeakCount >= MULTI_COLUMN_FOCUS_MIN_PEAKS) return false;
  if (
    !focus.singleSubjectInFocus &&
    focus.sharpFocusWidthFraction >= SINGLE_SUBJECT_FOCUS_MAX_WIDTH_FRACTION
  ) {
    return false;
  }
  const retained = focus.focusRegion.width / fullWidth;
  if (retained < FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION) return false;
  if (focus.focusRegion.width < minCropSidePx(fullWidth)) return false;
  return true;
}

/** Depth-of-field from a horizontal sharpness profile — incidental products stay soft. */
export async function inferDepthOfFieldHint(bytes: Buffer): Promise<DepthOfFieldHint> {
  const fallback: DepthOfFieldHint = {
    sharpFocusWidthFraction: 1,
    singleSubjectInFocus: false,
    sharpPeakCount: 0,
    focusRegion: null,
  };
  try {
    const meta = await sharp(bytes).rotate().metadata();
    const fullWidth = meta.width ?? 0;
    const fullHeight = meta.height ?? 0;
    if (fullWidth < 80 || fullHeight < 80) return fallback;

    const { analysisW, analysisH } = bandToAnalysisSize(
      fullWidth,
      fullHeight,
      FOCUS_HINT_ANALYSIS.analysisWidth,
      FOCUS_HINT_ANALYSIS.minAnalysisWidthFraction,
      FOCUS_HINT_ANALYSIS.minAnalysisHeightFraction,
    );

    const { data } = await sharp(bytes)
      .rotate()
      .resize({ width: analysisW, height: analysisH, fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const profile = columnSharpnessProfile(new Uint8Array(data), analysisW, analysisH);
    const bounds = inFocusHorizontalBounds(profile, FOCUS_COLUMN_THRESHOLD_RATIO, FOCUS_REGION_MARGIN_FRACTION);
    const sharpFocusWidthFraction = bounds ? (bounds.x1 - bounds.x0 + 1) / profile.length : 1;
    const sharpPeakCount = countSharpPeaks(profile, 0.75);
    const singleSubjectInFocus =
      sharpFocusWidthFraction < SINGLE_SUBJECT_FOCUS_MAX_WIDTH_FRACTION &&
      sharpPeakCount < MULTI_COLUMN_FOCUS_MIN_PEAKS;

    const mappedRegion =
      bounds !== null
        ? {
            left: Math.round((bounds.x0 / analysisW) * fullWidth),
            top: 0,
            width: Math.max(1, Math.round(((bounds.x1 - bounds.x0 + 1) / analysisW) * fullWidth)),
            height: fullHeight,
          }
        : null;

    const draft: DepthOfFieldHint = {
      sharpFocusWidthFraction,
      singleSubjectInFocus,
      sharpPeakCount,
      focusRegion: mappedRegion,
    };
    const focusRegion =
      mappedRegion && shouldApplyFocusCrop({ ...draft, focusRegion: mappedRegion }, fullWidth)
        ? mappedRegion
        : null;

    return { sharpFocusWidthFraction, singleSubjectInFocus, sharpPeakCount, focusRegion };
  } catch {
    return fallback;
  }
}

/** PNG of the in-focus region when focus crop applies; otherwise the original bytes. */
export async function extractInFocusRegionPng(
  bytes: Buffer,
  focus: DepthOfFieldHint,
): Promise<{ buffer: Buffer; applied: boolean }> {
  if (!focus.focusRegion) return { buffer: bytes, applied: false };
  const region = focus.focusRegion;
  const buffer = await sharp(bytes)
    .rotate()
    .extract({
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    })
    .png()
    .toBuffer();
  return { buffer, applied: true };
}

/** Resolve oriented bytes and layout hint when a focus crop is eligible. */
export async function bytesForFocusAwareOcr(
  bytes: Buffer,
  hint: {
    sharpFocusWidthFraction: number;
    sharpPeakCount: number;
    singleSubjectInFocus: boolean;
    focusRegion: FocusRegion | null;
    width: number;
  },
): Promise<{ bytes: Buffer; applied: boolean }> {
  const focus: DepthOfFieldHint = {
    sharpFocusWidthFraction: hint.sharpFocusWidthFraction,
    singleSubjectInFocus: hint.singleSubjectInFocus,
    sharpPeakCount: hint.sharpPeakCount,
    focusRegion: hint.focusRegion,
  };
  if (!shouldApplyFocusCrop(focus, hint.width)) {
    return { bytes, applied: false };
  }
  const cropped = await extractInFocusRegionPng(bytes, focus);
  return { bytes: cropped.buffer, applied: cropped.applied };
}

function columnSharpnessProfile(pixels: Uint8Array, width: number, height: number): Float64Array {
  const profile = new Float64Array(width);
  for (let x = 1; x < width - 1; x += 1) {
    let sum = 0;
    for (let y = 1; y < height - 1; y += 1) {
      const index = y * width + x;
      const gx = Math.abs(pixels[index + 1]! - pixels[index - 1]!);
      const gy = Math.abs(pixels[index + width]! - pixels[index - width]!);
      sum += gx + gy;
    }
    profile[x] = sum / height;
  }
  return profile;
}

function inFocusHorizontalBounds(
  profile: Float64Array,
  thresholdRatio: number,
  marginFraction: number,
): { x0: number; x1: number } | null {
  const max = profile.reduce((peak, value) => Math.max(peak, value), 0);
  if (max <= 0) return null;
  const threshold = max * thresholdRatio;
  let x0 = -1;
  let x1 = -1;
  for (let x = 0; x < profile.length; x += 1) {
    if (profile[x]! < threshold) continue;
    if (x0 < 0) x0 = x;
    x1 = x;
  }
  if (x0 < 0) return null;
  const margin = Math.max(1, Math.round(profile.length * marginFraction));
  return {
    x0: Math.max(0, x0 - margin),
    x1: Math.min(profile.length - 1, x1 + margin),
  };
}

function countSharpPeaks(profile: Float64Array, peakRatio: number): number {
  const max = profile.reduce((peak, value) => Math.max(peak, value), 0);
  if (max <= 0) return 0;
  const level = max * peakRatio;
  let peaks = 0;
  let inPeak = false;
  for (let x = 0; x < profile.length; x += 1) {
    const high = profile[x]! >= level;
    if (high && !inPeak) {
      peaks += 1;
      inPeak = true;
    }
    if (!high) inPeak = false;
  }
  return peaks;
}
