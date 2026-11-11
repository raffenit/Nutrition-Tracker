import { PDFParse } from 'pdf-parse';
import Tesseract, { PSM } from 'tesseract.js';
import {
  initialOcrLayoutProfile,
  inferLabelLayoutFromText,
  pickImportTextCandidateIndex,
  shouldRetryWideTableOcr,
  variantCapBoost,
  type OcrLayoutProfile,
} from '../domain/labelLayout.js';
import {
  mergeSlotReadingsAcrossCandidates,
} from '../domain/labelSlotExtract.js';
import type { Nutrients } from '../types.js';
import { extractEasyOcrTextsFromVariants } from './easyOcr.js';
import { reportImportJobStep } from '../import/importJobProgress.js';
import { inferLabelLayoutHint } from './imageLayoutHint.js';
import {
  buildOcrImageVariants,
  easyOcrVariantSubset,
  tesseractVariantSubset,
  type BuildOcrVariantOptions,
} from './ocrPreprocess.js';

/** Cap OCR text candidates while still feeding the per-slot merge pool. */
const MAX_OCR_CANDIDATES = 28;

function tesseractPsmModes(): PSM[] {
  if (process.env.TESSERACT_DUAL_PSM === '1') {
    return [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN];
  }
  return [PSM.SINGLE_BLOCK];
}

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
  reportImportJobStep('Preprocess', 'Preparing image for OCR…', 'Auto-rotate, upscale, and layout hints.');
  const hint = await inferLabelLayoutHint(bytes);
  const profiles: OcrLayoutProfile[] = [initialOcrLayoutProfile(hint)];

  reportImportJobStep('OCR', 'Reading the Nutrition Facts panel…', 'Neural OCR and Tesseract on preprocessed variants.');
  let candidates = await collectOcrCandidateTexts(bytes, cachePath, options?.easyocrModelDir, hint, profiles[0]!);
  let layout = inferLabelLayoutFromText(candidates);
  if (shouldRetryWideTableOcr(hint, layout)) {
    reportImportJobStep('OCR', 'Trying alternate layout passes…', 'Wide label — extra OCR profile.');
    profiles.push('wideTableRetry');
    const retryCandidates = await collectOcrCandidateTexts(
      bytes,
      cachePath,
      options?.easyocrModelDir,
      hint,
      'wideTableRetry',
    );
    candidates = mergeCandidateLists(candidates, retryCandidates);
    layout = inferLabelLayoutFromText(candidates);
  }

  reportImportJobStep('Parse', 'Matching label rows…', 'Selecting the best OCR candidate and merging nutrients.');
  const slotMergedNutrients = mergeSlotReadingsAcrossCandidates(candidates);
  const textIdx = pickImportTextCandidateIndex(candidates, layout);
  const text = candidates[textIdx] ?? candidates[0] ?? '';
  reportImportJobStep('Draft', 'Building your draft…', 'Combining structured import fields.');
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

function mergeCandidateLists(primary: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  mergeUniqueCandidates(seen, out, primary);
  mergeUniqueCandidates(seen, out, extra);
  return out;
}

function mergeUniqueCandidates(seen: Set<string>, out: string[], texts: string[]): void {
  for (const text of texts) {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= MAX_OCR_CANDIDATES) return;
  }
}

async function collectTesseractCandidateTexts(bytes: Buffer[], cachePath: string): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const psmModes = tesseractPsmModes();
  const worker = await Tesseract.createWorker('eng', 1, { cachePath });
  try {
    for (const image of bytes) {
      for (const psm of psmModes) {
        if (out.length >= MAX_OCR_CANDIDATES) return out;
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const result = await worker.recognize(image);
        mergeUniqueCandidates(seen, out, [result.data.text ?? '']);
      }
    }
  } finally {
    await worker.terminate();
  }
  return out;
}

async function collectOcrCandidateTexts(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
  profile: OcrLayoutProfile,
): Promise<string[]> {
  const variantOptions: BuildOcrVariantOptions = {
    profile,
    preserveFullWidthFocus: hint.widePanel || profile !== 'default',
  };
  const variants = await buildOcrImageVariants(bytes, variantOptions);
  const cap = variantCapBoost(profile);
  const forEasyOcr = modelDir ? easyOcrVariantSubset(variants, cap.easy) : [];
  const forTesseract = tesseractVariantSubset(variants, cap.tess);

  const [easyTexts, tessTexts] = await Promise.all([
    modelDir ? extractEasyOcrTextsFromVariants(forEasyOcr, modelDir) : Promise.resolve([]),
    collectTesseractCandidateTexts(forTesseract, cachePath),
  ]);

  const seen = new Set<string>();
  const out: string[] = [];
  mergeUniqueCandidates(seen, out, easyTexts);
  mergeUniqueCandidates(seen, out, tessTexts);
  if (out.length === 0) out.push('');
  return out;
}
