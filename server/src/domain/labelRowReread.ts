import { variantLabelSlotFor, type LabelSlotKey } from './labelSlotExtract.js';
import { findVariantLabelAnchors } from './labelVariants.js';

/** Re-read only contested nutrient rows: locate each row's line box, crop it full width. */

export type OcrLineBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type RowCropRect = { left: number; top: number; width: number; height: number };

/** Vertical padding around a row, as a fraction of the detected line height. */
export const ROW_REREAD_PAD_FRACTION = 0.2;

/** Rows shorter than this (px) are noise, not a nutrient line. */
export const ROW_REREAD_MIN_LINE_HEIGHT = 8;

export function findSlotRowLine(lines: OcrLineBox[], slot: LabelSlotKey): OcrLineBox | null {
  const variantSlot = variantLabelSlotFor(slot);
  if (!variantSlot) return null;
  for (const line of lines) {
    if (line.bbox.y1 - line.bbox.y0 < ROW_REREAD_MIN_LINE_HEIGHT) continue;
    if (findVariantLabelAnchors(line.text, variantSlot).length > 0) return line;
  }
  return null;
}

/** Full-width band around the line (amount and %DV sit to the right of the label). */
export function rowCropRect(
  bbox: OcrLineBox['bbox'],
  imageWidth: number,
  imageHeight: number,
  padFraction = ROW_REREAD_PAD_FRACTION,
): RowCropRect | null {
  const lineHeight = bbox.y1 - bbox.y0;
  if (lineHeight < ROW_REREAD_MIN_LINE_HEIGHT || imageWidth < 1 || imageHeight < 1) return null;
  const pad = Math.round(lineHeight * padFraction);
  const top = Math.max(0, bbox.y0 - pad);
  const bottom = Math.min(imageHeight, bbox.y1 + pad);
  if (bottom - top < ROW_REREAD_MIN_LINE_HEIGHT) return null;
  return { left: 0, top, width: imageWidth, height: bottom - top };
}
