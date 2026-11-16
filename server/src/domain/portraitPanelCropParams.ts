/** Tall single-label photos (height ÷ width) above this may try a gated panel crop before full-page OCR. */
export const PORTRAIT_PANEL_CROP_MIN_HEIGHT_WIDTH_RATIO = 1.55;

/** Analysis width for laplacian vertical band (matches default full-page OCR target width). */
export const PORTRAIT_PANEL_CROP_LAPLACIAN_TARGET_WIDTH = 2200;

/**
 * Center band for portrait bottles — slightly tighter than generic focus crops but still clears
 * shape gate (heading band + calories rule position) on fixtures like protein-shake.
 */
export const PORTRAIT_CENTER_BAND_HEIGHT_FRACTION = 0.58;
export const PORTRAIT_CENTER_BAND_WIDTH_FRACTION = 0.92;

/** When shape fails (e.g. first_rule_high), expand crop upward by these steps until shape passes or cap. */
export const PORTRAIT_CROP_TOP_EXPAND_MAX_FRACTION = 0.22;
export const PORTRAIT_CROP_TOP_EXPAND_STEP_FRACTION = 0.035;