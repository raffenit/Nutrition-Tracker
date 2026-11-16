import sharp from 'sharp';
import type { LabelLayoutHint } from '../domain/labelLayout.js';
import { resolveCenterBandCropFractions } from '../domain/labelImageCropPolicy.js';
import {
  PORTRAIT_CROP_TOP_EXPAND_MAX_FRACTION,
  PORTRAIT_CROP_TOP_EXPAND_STEP_FRACTION,
  PORTRAIT_PANEL_CROP_LAPLACIAN_TARGET_WIDTH,
  PORTRAIT_PANEL_CROP_MIN_HEIGHT_WIDTH_RATIO,
} from '../domain/portraitPanelCropParams.js';
import { wideBandInkEnvelopeCropRect } from './labelWideBandCropRect.js';
import { appendImportJobDebug } from '../import/importJobProgress.js';
import {
  centerBandCropRect,
  laplacianFocusRectForTest,
  type FocusCropRect,
} from './focusCrop.js';
import {
  assessNutritionFactsLabelShape,
  type NutritionFactsLabelShapeAssessment,
} from './nutritionFactsLabelShape.js';

export type PortraitPanelCropResult = {
  bytes: Buffer;
  applied: boolean;
  strategy?: 'ink_envelope' | 'center_band' | 'laplacian_vertical';
  shape?: NutritionFactsLabelShapeAssessment;
};

type CropStrategy = {
  id: PortraitPanelCropResult['strategy'];
  rect: FocusCropRect;
};

function portraitCropEnabled(): boolean {
  const v = process.env.PORTRAIT_PANEL_CROP;
  return v !== '0' && v !== 'false';
}

export function shouldTryPortraitPanelCrop(hint: Pick<LabelLayoutHint, 'widePanel' | 'width' | 'height'>): boolean {
  if (!portraitCropEnabled()) return false;
  if (hint.widePanel || hint.width < 1 || hint.height < 1) return false;
  return hint.height / hint.width >= PORTRAIT_PANEL_CROP_MIN_HEIGHT_WIDTH_RATIO;
}

function clampRect(rect: FocusCropRect, width: number, height: number): FocusCropRect | null {
  const left = Math.max(0, Math.min(rect.left, width - 1));
  const top = Math.max(0, Math.min(rect.top, height - 1));
  const cropW = Math.min(rect.width, width - left);
  const cropH = Math.min(rect.height, height - top);
  if (cropW < 48 || cropH < 48) return null;
  return { left, top, width: cropW, height: cropH };
}

async function extractCropPng(bytes: Buffer, rect: FocusCropRect): Promise<Buffer> {
  return sharp(bytes).rotate().extract(rect).png().toBuffer();
}

async function laplacianVerticalBandCropRect(bytes: Buffer): Promise<FocusCropRect | null> {
  const meta = await sharp(bytes).rotate().metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;
  if (fullWidth < 80 || fullHeight < 80) return null;

  const scaledW = Math.max(PORTRAIT_PANEL_CROP_LAPLACIAN_TARGET_WIDTH, fullWidth);
  const scaledH = Math.round(fullHeight * (scaledW / fullWidth));
  const { data } = await sharp(bytes)
    .rotate()
    .resize({ width: scaledW, height: scaledH, fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rect = laplacianFocusRectForTest(new Uint8Array(data), scaledW, scaledH, {
    preserveFullWidth: true,
  });
  if (!rect) return null;

  const scale = scaledW / fullWidth;
  return {
    left: Math.max(0, Math.round(rect.left / scale)),
    top: Math.max(0, Math.round(rect.top / scale)),
    width: Math.min(fullWidth, Math.round(rect.width / scale)),
    height: Math.min(fullHeight, Math.round(rect.height / scale)),
  };
}

function portraitCenterBandRect(
  width: number,
  height: number,
  hint: LabelLayoutHint,
): FocusCropRect {
  const frac = resolveCenterBandCropFractions(hint);
  return centerBandCropRect(width, height, frac);
}

/** Nudge crop top upward when shape fails on missing heading / high first rule (curved bottle crops). */
async function refineRectUntilPanelShape(
  bytes: Buffer,
  rect: FocusCropRect,
  fullWidth: number,
  fullHeight: number,
): Promise<{ rect: FocusCropRect; shape: NutritionFactsLabelShapeAssessment } | null> {
  const maxExpand = Math.max(1, Math.round(fullHeight * PORTRAIT_CROP_TOP_EXPAND_MAX_FRACTION));
  const step = Math.max(4, Math.round(fullHeight * PORTRAIT_CROP_TOP_EXPAND_STEP_FRACTION));

  let direct: NutritionFactsLabelShapeAssessment | null = null;
  try {
    const png = await extractCropPng(bytes, rect);
    direct = await assessNutritionFactsLabelShape(png);
    if (direct.looksLikePanel) return { rect, shape: direct };
  } catch {
  }

  for (let expand = step; expand <= maxExpand; expand += step) {
    const top = Math.max(0, rect.top - expand);
    const height = Math.min(fullHeight - top, rect.height + (rect.top - top));
    const refined = clampRect({ ...rect, top, height }, fullWidth, fullHeight);
    if (!refined) continue;
    try {
      const png = await extractCropPng(bytes, refined);
      const shape = await assessNutritionFactsLabelShape(png);
      if (shape.looksLikePanel) return { rect: refined, shape };
    } catch {
      continue;
    }
  }
  return null;
}

async function buildPortraitCropStrategies(bytes: Buffer, hint: LabelLayoutHint): Promise<CropStrategy[]> {
  const meta = await sharp(bytes).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1) return [];

  const strategies: CropStrategy[] = [];
  const envelopeRaw = await wideBandInkEnvelopeCropRect(bytes);
  const envelope = envelopeRaw ? clampRect(envelopeRaw, width, height) : null;
  if (envelope) strategies.push({ id: 'ink_envelope', rect: envelope });

  const center = clampRect(portraitCenterBandRect(width, height, hint), width, height);
  if (center) strategies.push({ id: 'center_band', rect: center });

  const laplacian = await laplacianVerticalBandCropRect(bytes);
  if (laplacian) {
    const clamped = clampRect(laplacian, width, height);
    if (clamped) strategies.push({ id: 'laplacian_vertical', rect: clamped });
  }
  return strategies;
}

/**
 * For tall portrait singles: try conservative panel crops, geometry probe, keep crop only when
 * the region still looks like a full Nutrition Facts panel; otherwise leave bytes unchanged.
 */
export async function applyGatedPortraitPanelCrop(
  bytes: Buffer,
  _cachePath: string,
  hint: LabelLayoutHint,
): Promise<PortraitPanelCropResult> {
  if (!shouldTryPortraitPanelCrop(hint)) {
    return { bytes, applied: false };
  }

  const strategies = await buildPortraitCropStrategies(bytes, hint);
  if (strategies.length === 0) {
    appendImportJobDebug('portrait panel crop: no candidate rectangles');
    return { bytes, applied: false };
  }

  const meta = await sharp(bytes).rotate().metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;

  for (const strategy of strategies) {
    const refined = await refineRectUntilPanelShape(bytes, strategy.rect, fullWidth, fullHeight);
    if (!refined) {
      appendImportJobDebug(`portrait panel crop: reject ${strategy.id} (shape: no refinement passed gate)`);
      continue;
    }

    let cropPng: Buffer;
    try {
      cropPng = await extractCropPng(bytes, refined.rect);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      appendImportJobDebug(`portrait panel crop: ${strategy.id} extract failed (${reason})`);
      continue;
    }

    const { shape } = refined;
    const expandedTop = strategy.rect.top - refined.rect.top;
    const croppedMeta = await sharp(cropPng).metadata();
    appendImportJobDebug(
      `portrait panel crop: apply ${strategy.id} → ${croppedMeta.width ?? refined.rect.width}×${croppedMeta.height ?? refined.rect.height}px` +
        `${expandedTop > 0 ? ` (expanded top ${expandedTop}px)` : ''}` +
        ` rules=${shape.horizontalRuleCount} header=${shape.headerBandEdgeFractionOfPeak.toFixed(2)}`,
    );
    return {
      bytes: cropPng,
      applied: true,
      strategy: strategy.id,
      shape,
    };
  }

  appendImportJobDebug('portrait panel crop: no strategy passed shape gate — full frame');
  return { bytes, applied: false };
}