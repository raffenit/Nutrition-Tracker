import { PDFParse } from 'pdf-parse';
import Tesseract, { PSM } from 'tesseract.js';
import {
  mergeSlotReadingsAcrossCandidates,
  primaryCandidateIndex,
} from '../domain/labelSlotExtract.js';
import type { Nutrients } from '../types.js';
import { extractEasyOcrTextsFromVariants } from './easyOcr.js';
import { buildOcrImageVariants, easyOcrVariantSubset } from './ocrPreprocess.js';

const PSM_MODES = [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN] as const;

/** Cap OCR text candidates while still feeding the per-slot merge pool. */
const MAX_OCR_CANDIDATES = 28;

export type ImageLabelExtraction = {
  text: string;
  /** Best per-row values merged across OCR engines (label + unit driven). */
  slotMergedNutrients: Nutrients | null;
};

export async function extractPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export async function extractImageLabel(
  bytes: Buffer,
  cachePath: string,
  options?: { easyocrModelDir?: string },
): Promise<ImageLabelExtraction> {
  const candidates = await collectOcrCandidateTexts(bytes, cachePath, options?.easyocrModelDir);
  const slotMergedNutrients = mergeSlotReadingsAcrossCandidates(candidates);
  const primaryIdx = primaryCandidateIndex(candidates);
  const text = candidates[primaryIdx] ?? candidates[0] ?? '';
  return { text, slotMergedNutrients };
}

/** Legacy: single string (primary candidate after slot merge scoring). */
export async function extractImageText(
  bytes: Buffer,
  cachePath: string,
  options?: { easyocrModelDir?: string },
): Promise<string> {
  const result = await extractImageLabel(bytes, cachePath, options);
  return result.text;
}

async function collectOcrCandidateTexts(
  bytes: Buffer,
  cachePath: string,
  modelDir?: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  const variants = await buildOcrImageVariants(bytes);

  if (modelDir) {
    const forEasyOcr = easyOcrVariantSubset(variants);
    for (const mlText of await extractEasyOcrTextsFromVariants(forEasyOcr, modelDir)) {
      push(mlText);
      if (out.length >= MAX_OCR_CANDIDATES) return out;
    }
  }

  const worker = await Tesseract.createWorker('eng', 1, { cachePath });
  try {
    for (const image of variants) {
      for (const psm of PSM_MODES) {
        if (out.length >= MAX_OCR_CANDIDATES) return out;
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const result = await worker.recognize(image);
        const text = result.data.text ?? '';
        push(text);
      }
    }
  } finally {
    await worker.terminate();
  }

  if (out.length === 0) push('');
  return out;
}
