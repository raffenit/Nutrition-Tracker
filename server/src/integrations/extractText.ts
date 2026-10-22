import { PDFParse } from 'pdf-parse';
import Tesseract, { PSM } from 'tesseract.js';
import sharp, { type Sharp } from 'sharp';
import { scoreLabelExtraction } from '../domain/labelSlots.js';
import { adaptiveThresholdVariants } from './adaptiveThreshold.js';
import { extractEasyOcrText } from './easyOcr.js';
import { focusCropVariants } from './focusCrop.js';

/** Laplacian-guided + center band crops on each orientation (depth-of-field). */
const USE_FOCUS_CROPS = true;

/** Target width for label OCR — upscales phone photos for Tesseract. */
const OCR_TARGET_WIDTH = 2200;

const PSM_MODES = [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN] as const;

export async function extractPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export async function extractImageText(
  bytes: Buffer,
  cachePath: string,
  options?: { easyocrModelDir?: string },
): Promise<string> {
  let best = { text: '', score: -1 };
  const modelDir = options?.easyocrModelDir;
  if (modelDir) {
    const mlText = await extractEasyOcrText(bytes, modelDir);
    if (mlText) {
      const score = scoreLabelExtraction(mlText);
      best = { text: mlText, score };
    }
  }

  const variants = await imageVariants(bytes);
  const worker = await Tesseract.createWorker('eng', 1, { cachePath });
  try {
    for (const image of variants) {
      for (const psm of PSM_MODES) {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const result = await worker.recognize(image);
        const text = result.data.text ?? '';
        const score = scoreLabelExtraction(text);
        if (score > best.score) best = { text, score };
        if (best.score >= 20) return best.text;
      }
    }
    return best.text;
  } finally {
    await worker.terminate();
  }
}

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

async function imageVariants(bytes: Buffer): Promise<Buffer[]> {
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
