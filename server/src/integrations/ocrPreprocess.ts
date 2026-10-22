import sharp, { type Sharp } from 'sharp';
import { adaptiveThresholdVariants } from './adaptiveThreshold.js';
import { focusCropVariants } from './focusCrop.js';

/** Target width for label OCR — upscales phone photos before any engine runs. */
export const OCR_TARGET_WIDTH = 2200;

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

/**
 * Single preprocess pipeline for Tesseract and EasyOCR (PNG buffers, orientations, crops).
 * Order is stable: primary orientation variants first, then rotations, then raw fallback.
 */
export async function buildOcrImageVariants(bytes: Buffer): Promise<Buffer[]> {
  try {
    const orientations = [
      sharp(bytes).rotate(),
      sharp(bytes).rotate().rotate(90),
      sharp(bytes).rotate().rotate(270),
    ];
    const buffers: Buffer[] = [];
    for (const source of orientations) {
      const meta = await source.metadata();
      const width = meta.width ?? OCR_TARGET_WIDTH;
      const scale = width < OCR_TARGET_WIDTH ? OCR_TARGET_WIDTH / width : 1;
      const scaled =
        scale > 1.05
          ? source.clone().resize({ width: Math.round(width * scale), kernel: sharp.kernel.lanczos3 })
          : source.clone();

      await appendOcrVariants(buffers, scaled, PREPROCESSORS);
      if (USE_FOCUS_CROPS) {
        for (const cropped of await focusCropVariants(scaled)) {
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

/** EasyOCR is heavier per image — same variants, capped count (see EASYOCR_MAX_VARIANTS). */
export function easyOcrVariantSubset(variants: Buffer[]): Buffer[] {
  const max = Number(process.env.EASYOCR_MAX_VARIANTS ?? '6');
  const limit = Number.isFinite(max) && max > 0 ? Math.min(max, variants.length) : 6;
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
