import sharp from 'sharp';
import { WIDE_PANEL_MIN_ASPECT, type LabelLayoutHint } from '../domain/labelLayout.js';
import { inferDepthOfFieldHint } from './labelFocusHint.js';

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
