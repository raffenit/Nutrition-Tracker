/**
 * Full-page OCR on tall single-panel labels (gated portrait crop). Keeps enough variant
 * diversity for slot merge without wide-table fanout.
 */

/** Upscale target width — lower than default 2200 to cut pixels on panel crops. */
export const PORTRAIT_SINGLE_OCR_TARGET_WIDTH = 1600;

/** Tesseract images in the first pass on portrait singles. */
export const PORTRAIT_SINGLE_TESS_VARIANT_CAP = 5;

/** EasyOCR images when core macros are still missing after the Tess pass. */
export const PORTRAIT_SINGLE_EASY_VARIANT_CAP = 2;

/** EasyOCR images when macros are present but contested / inconsistent — one tie-breaker read. */
export const PORTRAIT_SINGLE_EASY_TIEBREAK_CAP = 1;

/** `OCR_PORTRAIT_SINGLE=0` restores the wide multi-orientation path (A/B benchmarking). */
export function portraitSingleOcrEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OCR_PORTRAIT_SINGLE !== '0' && env.OCR_PORTRAIT_SINGLE !== 'false';
}

export function isPortraitSingleOcrHint(hint: {
  widePanel: boolean;
  width: number;
  height: number;
}): boolean {
  if (hint.widePanel) return false;
  if (hint.width < 1 || hint.height < 1) return false;
  return hint.height / hint.width > 1.1;
}