import { DEFAULT_FOCUS_CROP_PARAMS, resolveFocusCropParams, type FocusCropParams } from './focusCropParams.js';
import {
  PORTRAIT_CENTER_BAND_HEIGHT_FRACTION,
  PORTRAIT_CENTER_BAND_WIDTH_FRACTION,
} from './portraitPanelCropParams.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from './ruledTableGridParams.js';
import type { LabelLayoutHint } from './labelLayout.js';

/**
 * Shared crop policy across variety-pack (Costco), column strips, and portrait singles.
 * Geometry thresholds live in *Params.ts; this module picks layout-appropriate fractions.
 * Full-page OCR bytes: {@link resolveLabelOcrSources} in `integrations/labelOcrSources.ts`.
 */

/** Same bar as ruled-grid column validation ({@link DEFAULT_RULED_TABLE_GRID_PARAMS}). */
export const LABEL_PANEL_MIN_HORIZONTAL_RULES = DEFAULT_RULED_TABLE_GRID_PARAMS.minHorizontalRulesPerColumn;

export type CenterBandCropFractions = {
  heightFraction: number;
  widthFraction: number;
};

/** Center-band geometry for OCR variants and gated portrait crops. */
export function resolveCenterBandCropFractions(
  hint: Pick<LabelLayoutHint, 'widePanel' | 'width' | 'height'>,
): CenterBandCropFractions {
  const portraitTall =
    !hint.widePanel && hint.width > 0 && hint.height / hint.width >= 1.55;
  if (portraitTall) {
    return {
      heightFraction: PORTRAIT_CENTER_BAND_HEIGHT_FRACTION,
      widthFraction: PORTRAIT_CENTER_BAND_WIDTH_FRACTION,
    };
  }
  const focus = resolveFocusCropParams();
  return {
    heightFraction: focus.centerBandHeightFraction,
    widthFraction: focus.centerBandWidthFraction,
  };
}

export { DEFAULT_FOCUS_CROP_PARAMS, type FocusCropParams };