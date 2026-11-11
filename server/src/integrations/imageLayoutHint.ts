import sharp from 'sharp';
import { WIDE_PANEL_MIN_ASPECT, type LabelLayoutHint } from '../domain/labelLayout.js';
import { bytesForFocusAwareOcr, inferDepthOfFieldHint } from './labelFocusHint.js';

export type LabelProcessingImage = {
  /** Oriented bytes after optional in-focus horizontal crop. */
  bytes: Buffer;
  /** Layout hint for {@link bytes} (re-inferred when crop applies). */
  hint: LabelLayoutHint;
  focusCropApplied: boolean;
  /** Hint on the upload before crop, when {@link focusCropApplied}. */
  hintBeforeFocus: LabelLayoutHint | null;
};

/**
 * Single gate for imports: trim soft packaging / background before geometry and OCR.
 * No-op when the variety table is fully sharp (see {@link shouldApplyFocusCrop}).
 */
export async function resolveLabelProcessingImage(bytes: Buffer): Promise<LabelProcessingImage> {
  const hint = await inferLabelLayoutHint(bytes);
  const focus = await bytesForFocusAwareOcr(bytes, hint);
  if (!focus.applied) {
    return { bytes: focus.bytes, hint, focusCropApplied: false, hintBeforeFocus: null };
  }
  const croppedHint = await inferLabelLayoutHint(focus.bytes);
  return { bytes: focus.bytes, hint: croppedHint, focusCropApplied: true, hintBeforeFocus: hint };
}

/** Cheap geometry hint before OCR variant generation (auto-oriented dimensions). */
export async function inferLabelLayoutHint(bytes: Buffer): Promise<LabelLayoutHint> {
  const fallback: LabelLayoutHint = {
    widePanel: false,
    width: 0,
    height: 0,
    aspectRatio: 1,
    sharpFocusWidthFraction: 1,
    singleSubjectInFocus: false,
    sharpPeakCount: 0,
    focusRegion: null,
  };
  try {
    const meta = await sharp(bytes).rotate().metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < 1 || height < 1) return fallback;
    const aspectRatio = width / height;
    const focus = await inferDepthOfFieldHint(bytes);
    return {
      widePanel: aspectRatio >= WIDE_PANEL_MIN_ASPECT,
      width,
      height,
      aspectRatio,
      sharpFocusWidthFraction: focus.sharpFocusWidthFraction,
      singleSubjectInFocus: focus.singleSubjectInFocus,
      sharpPeakCount: focus.sharpPeakCount,
      focusRegion: focus.focusRegion,
    };
  } catch {
    return fallback;
  }
}
