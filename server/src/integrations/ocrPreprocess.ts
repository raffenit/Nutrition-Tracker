import sharp, { type Sharp } from 'sharp';
import { COLUMN_STRIP_OCR_TARGET_WIDTH, ROW_BAND_OCR_MIN_HEIGHT } from '../domain/columnStripOcrParams.js';
import type { OcrLayoutProfile } from '../domain/labelLayout.js';
import { PORTRAIT_SINGLE_OCR_TARGET_WIDTH } from '../domain/portraitSingleOcrParams.js';
import { appendImportJobDebug } from '../import/importJobProgress.js';
import { adaptiveThresholdVariants } from './adaptiveThreshold.js';
import { focusCropVariants } from './focusCrop.js';

/** Target width for label OCR — upscales phone photos before any engine runs. */
export const OCR_TARGET_WIDTH = 2200;
const OCR_WIDE_TABLE_TARGET_WIDTH = 2500;
const OCR_WIDE_TABLE_RETRY_TARGET_WIDTH = 2800;

/** Laplacian-guided + center band crops on each orientation (depth-of-field). */
const USE_FOCUS_CROPS = true;

type Preprocess = (image: Sharp) => Sharp;

/** Contrast / denoise pipelines — adaptive threshold variants added separately. */
const PREPROCESSORS: Preprocess[] = [
  (image) => image.greyscale().normalize(),
  (image) => image.greyscale().normalize().sharpen({ sigma: 1 }),
  (image) => image.greyscale().linear(1.45, -35),
  (image) => image.greyscale().normalize().linear(1.25, -15).sharpen({ sigma: 0.8 }),
  (image) => image.greyscale().gamma(1.15).normalize(),
  (image) => image.greyscale().median(3).normalize().sharpen({ sigma: 0.6 }),
];

/** Lighter stack for focus crops — extra variants without full OCR runtime blow-up. */
const FOCUS_PREPROCESSORS: Preprocess[] = [
  (image) => image.greyscale().normalize(),
  (image) => image.greyscale().normalize().sharpen({ sigma: 1 }),
  (image) => image.greyscale().normalize().linear(1.25, -15).sharpen({ sigma: 0.8 }),
];

export type BuildOcrVariantOptions = {
  profile?: OcrLayoutProfile;
  preserveFullWidthFocus?: boolean;
  /** Portrait panel crops are already tight — nested focus bands break Sharp extract. */
  skipFocusCrops?: boolean;
  /** Single orientation, lighter preprocess — tall single-panel imports. */
  portraitSingle?: boolean;
};

const OCR_VARIANT_MIN_SIDE = 24;

export type OcrVariantMode = 'full' | 'columnStrip';

/**
 * Single preprocess pipeline for Tesseract and EasyOCR (PNG buffers, orientations, crops).
 * Order is stable: primary orientation variants first, then rotations, then raw fallback.
 */
/**
 * Per-column strip OCR — no rotations or focus crops (those break on narrow crops).
 * Upscales the strip, then a small preprocess set tuned for one vertical panel.
 */
/** Upscale uniformly until both minimums are met; never crops or changes the aspect ratio. */
async function upscaleColumnStripSource(source: Sharp, minWidth: number, minHeight = 0): Promise<Sharp> {
  const meta = await source.metadata();
  const width = meta.width ?? minWidth;
  const height = meta.height ?? minHeight;
  const scale = Math.max(1, minWidth / Math.max(1, width), minHeight > 0 ? minHeight / Math.max(1, height) : 1);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);
  if (targetW < width + 4 && targetH < height + 2) return source.clone();
  return source.clone().resize({ width: targetW, height: targetH, fit: 'fill', kernel: sharp.kernel.lanczos3 });
}

export async function buildColumnStripOcrVariants(bytes: Buffer): Promise<Buffer[]> {
  const scaled = await upscaleColumnStripSource(sharp(bytes).rotate(), COLUMN_STRIP_OCR_TARGET_WIDTH);

  const buffers: Buffer[] = [
    await scaled.clone().greyscale().normalize().png().toBuffer(),
    await scaled.clone().greyscale().normalize().sharpen({ sigma: 1 }).png().toBuffer(),
    await scaled.clone().greyscale().linear(1.3, -20).normalize().png().toBuffer(),
  ];
  const meta = await scaled.metadata();
  const h = meta.height ?? 0;
  const w = meta.width ?? 0;
  if (h >= 40 && w >= 24) {
    const adaptive = await adaptiveThresholdVariants(scaled);
    if (adaptive[0]) buffers.push(adaptive[0]);
  }
  return uniqueBuffers(buffers);
}

/** One horizontal nutrient row — upscale height, skip adaptive threshold on tiny crops. */
export async function buildRowBandOcrVariants(bytes: Buffer): Promise<Buffer[]> {
  // Height drives the scale: forcing a wide target width blows tall rows (Calories) up past
  // the glyph sizes Tesseract reads well.
  const scaled = await upscaleColumnStripSource(sharp(bytes).rotate(), 0, ROW_BAND_OCR_MIN_HEIGHT);
  const primary = await scaled.clone().greyscale().normalize().png().toBuffer();
  if (process.env.TESSERACT_ROW_BAND_DUAL_VARIANT === '1') {
    return uniqueBuffers([
      primary,
      await scaled.clone().greyscale().normalize().sharpen({ sigma: 1 }).png().toBuffer(),
    ]);
  }
  return [primary];
}

export async function buildOcrImageVariants(bytes: Buffer, options?: BuildOcrVariantOptions): Promise<Buffer[]> {
  try {
    const portraitSingle = options?.portraitSingle === true;
    const targetWidth = portraitSingle
      ? PORTRAIT_SINGLE_OCR_TARGET_WIDTH
      : ocrTargetWidthForProfile(options?.profile);
    const glarePreprocess =
      options?.profile === 'wideTableRetry'
        ? (image: Sharp) => image.greyscale().linear(1.65, -45).median(3).normalize().sharpen({ sigma: 0.5 })
        : null;
    const orientations = portraitSingle
      ? [sharp(bytes).rotate()]
      : [
          sharp(bytes).rotate(),
          sharp(bytes).rotate().rotate(90),
          sharp(bytes).rotate().rotate(270),
        ];
    const mainPreprocessors = portraitSingle ? PREPROCESSORS.slice(0, 3) : PREPROCESSORS;
    const buffers: Buffer[] = [];
    for (const [orientationIndex, source] of orientations.entries()) {
      const meta = await source.metadata();
      const width = meta.width ?? targetWidth;
      const scale = width < targetWidth ? targetWidth / width : 1;
      const scaled =
        scale > 1.05
          ? source.clone().resize({ width: Math.round(width * scale), kernel: sharp.kernel.lanczos3 })
          : source.clone();

      await appendOcrVariants(buffers, scaled, mainPreprocessors);
      if (orientationIndex === 0) {
        const adaptive = await adaptiveThresholdVariants(scaled);
        if (adaptive[0]) buffers.push(adaptive[0]);
      }
      if (glarePreprocess && orientationIndex === 0) {
        buffers.push(await glarePreprocess(scaled.clone()).png().toBuffer());
      }
      if (USE_FOCUS_CROPS && !options?.skipFocusCrops && !portraitSingle) {
        for (const cropped of await focusCropVariants(scaled, {
          preserveFullWidth: options?.preserveFullWidthFocus,
        })) {
          await appendOcrVariants(buffers, cropped, FOCUS_PREPROCESSORS);
        }
      }
    }
    if (!portraitSingle) buffers.push(bytes);
    return uniqueBuffers(buffers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendImportJobDebug(`ocr preprocess: variant build failed — ${message}`);
    console.error('[ocrPreprocess] buildOcrImageVariants failed:', error);
    return [bytes];
  }
}

function ocrTargetWidthForProfile(profile?: OcrLayoutProfile): number {
  if (profile === 'wideTableRetry') return OCR_WIDE_TABLE_RETRY_TARGET_WIDTH;
  if (profile === 'wideTable') return OCR_WIDE_TABLE_TARGET_WIDTH;
  return OCR_TARGET_WIDTH;
}

/** EasyOCR is heavier per image — same variants, capped count (see EASYOCR_MAX_VARIANTS). */
export function easyOcrVariantSubset(variants: Buffer[], extra = 0): Buffer[] {
  const max = Number(process.env.EASYOCR_MAX_VARIANTS ?? '4');
  const base = Number.isFinite(max) && max > 0 ? max : 4;
  const limit = Math.min(base + extra, variants.length);
  return variants.slice(0, limit);
}

/** Tesseract is cheaper but still scales with variant × PSM count — cap preprocessed images. */
export function tesseractVariantSubset(variants: Buffer[], extra = 0): Buffer[] {
  const max = Number(process.env.TESSERACT_MAX_VARIANTS ?? '12');
  const base = Number.isFinite(max) && max > 0 ? max : 12;
  const limit = Math.min(base + extra, variants.length);
  return variants.slice(0, limit);
}

async function appendOcrVariants(buffers: Buffer[], source: Sharp, preprocessors: Preprocess[]): Promise<void> {
  const meta = await source.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < OCR_VARIANT_MIN_SIDE || height < OCR_VARIANT_MIN_SIDE) {
    appendImportJobDebug(
      `ocr preprocess: skip variants on ${width}×${height}px (min side ${OCR_VARIANT_MIN_SIDE})`,
    );
    return;
  }
  for (const preprocess of preprocessors) {
    buffers.push(await preprocess(source.clone()).png().toBuffer());
  }
  buffers.push(...(await adaptiveThresholdVariants(source)));
}

function uniqueBuffers(buffers: Buffer[]): Buffer[] {
  const seen = new Set<string>();
  const out: Buffer[] = [];
  for (const buffer of buffers) {
    const key = `${buffer.length}:${buffer.subarray(0, 8).toString('hex')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(buffer);
  }
  return out;
}

/** Gap (px) between stacked row crops so EasyOCR detects them as separate lines. */
const STACKED_ROW_GAP = 24;

/** Crop rows from their source images and stack them vertically into one PNG (one EasyOCR call). */
export async function buildStackedRowCrops(
  rows: Array<{ image: Buffer; rect: { left: number; top: number; width: number; height: number } }>,
): Promise<Buffer | null> {
  const crops: Array<{ input: Buffer; width: number; height: number }> = [];
  for (const row of rows) {
    try {
      const input = await sharp(row.image).extract(row.rect).png().toBuffer();
      crops.push({ input, width: row.rect.width, height: row.rect.height });
    } catch {
      /* skip invalid crop */
    }
  }
  if (crops.length === 0) return null;
  const width = Math.max(...crops.map((c) => c.width));
  const height = crops.reduce((sum, c) => sum + c.height, 0) + STACKED_ROW_GAP * (crops.length - 1);
  let top = 0;
  const layers = crops.map((c) => {
    const layer = { input: c.input, left: 0, top };
    top += c.height + STACKED_ROW_GAP;
    return layer;
  });
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(layers)
    .greyscale()
    .png()
    .toBuffer();
}
