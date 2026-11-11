import sharp, { type Sharp } from 'sharp';
import type { OcrLayoutProfile } from '../domain/labelLayout.js';
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
};

/**
 * Single preprocess pipeline for Tesseract and EasyOCR (PNG buffers, orientations, crops).
 * Order is stable: primary orientation variants first, then rotations, then raw fallback.
 */
export async function buildOcrImageVariants(bytes: Buffer, options?: BuildOcrVariantOptions): Promise<Buffer[]> {
  try {
    const targetWidth = ocrTargetWidthForProfile(options?.profile);
    const glarePreprocess =
      options?.profile === 'wideTableRetry'
        ? (image: Sharp) => image.greyscale().linear(1.65, -45).median(3).normalize().sharpen({ sigma: 0.5 })
        : null;
    const orientations = [
      sharp(bytes).rotate(),
      sharp(bytes).rotate().rotate(90),
      sharp(bytes).rotate().rotate(270),
    ];
    const buffers: Buffer[] = [];
    for (const [orientationIndex, source] of orientations.entries()) {
      const meta = await source.metadata();
      const width = meta.width ?? targetWidth;
      const scale = width < targetWidth ? targetWidth / width : 1;
      const scaled =
        scale > 1.05
          ? source.clone().resize({ width: Math.round(width * scale), kernel: sharp.kernel.lanczos3 })
          : source.clone();

      await appendOcrVariants(buffers, scaled, PREPROCESSORS);
      if (glarePreprocess && orientationIndex === 0) {
        buffers.push(await glarePreprocess(scaled.clone()).png().toBuffer());
      }
      if (USE_FOCUS_CROPS) {
        for (const cropped of await focusCropVariants(scaled, {
          preserveFullWidth: options?.preserveFullWidthFocus,
        })) {
          await appendOcrVariants(buffers, cropped, FOCUS_PREPROCESSORS);
        }
      }
    }
    buffers.push(bytes);
    return uniqueBuffers(buffers);
  } catch {
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
