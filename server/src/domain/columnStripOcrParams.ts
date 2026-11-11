/** Minimum strip width (full image coordinates) to run OCR — skips gutter slivers. */
export const COLUMN_STRIP_MIN_OCR_WIDTH_FRACTION = 0.05;

/**
 * Upscale narrow strips toward this width so Tesseract sees readable text.
 * Expressed vs default wide-table OCR target (2500).
 */
export const COLUMN_STRIP_OCR_TARGET_WIDTH = 900;
