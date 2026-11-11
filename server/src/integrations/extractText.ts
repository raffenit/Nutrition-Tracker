import { PDFParse } from 'pdf-parse';
import { PSM } from 'tesseract.js';
import sharp from 'sharp';
import {
  initialOcrLayoutProfile,
  inferLabelLayoutFromText,
  pickImportTextCandidateIndex,
  shouldRetryWideTableOcr,
  shouldRunColumnStripOcr,
  variantCapBoost,
  type OcrLayoutProfile,
} from '../domain/labelLayout.js';
import {
  COLUMN_STRIP_MIN_OCR_WIDTH_FRACTION,
} from '../domain/columnStripOcrParams.js';
import { parseMultiProductLabelTable } from '../domain/parseMultiProductLabelTable.js';
import { scoreLabelExtraction } from '../domain/labelSlots.js';
import { stitchColumnStripOcrTexts } from '../domain/stitchColumnStripTexts.js';
import {
  diagnoseSharedLabelGridStitch,
  formatSharedLabelStitchFailure,
  stitchSharedLabelGridTexts,
} from '../domain/stitchSharedLabelGridTexts.js';
import { stitchSplitLabelHalves } from '../domain/stitchSplitLabelHalves.js';
import {
  mergeSlotReadingsAcrossCandidates,
} from '../domain/labelSlotExtract.js';
import type { Nutrients } from '../types.js';
import { extractEasyOcrTextsFromVariants } from './easyOcr.js';
import { appendImportJobDebug, reportImportJobStep } from '../import/importJobProgress.js';
import { inferLabelLayoutHint, resolveLabelProcessingImage } from './imageLayoutHint.js';
import {
  detectColumnStrips,
  extractColumnStripBuffers,
  type ColumnStripPlan,
} from './labelColumnStrips.js';
import { extractSharedLabelGridBuffers } from './sharedLabelValueGrid.js';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
} from './varietyPackGridPipeline.js';
import { detectSplitSingleLabel, extractSplitSingleLabelBuffers } from './splitSingleLabel.js';
import {
  buildColumnStripOcrVariants,
  buildOcrImageVariants,
  easyOcrVariantSubset,
  tesseractVariantSubset,
  type BuildOcrVariantOptions,
} from './ocrPreprocess.js';
import { recognizeTesseractBatch } from './tesseractOcr.js';

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
  const resolved = await resolveLabelProcessingImage(bytes);
  const ocrBytes = resolved.bytes;
  const activeHint = resolved.hint;
  if (resolved.focusCropApplied) {
    appendImportJobDebug(
      `focus: label processing on in-focus crop ${activeHint.width}×${activeHint.height}px (${Math.round((resolved.hintBeforeFocus?.sharpFocusWidthFraction ?? 1) * 100)}% sharp, ${resolved.hintBeforeFocus?.sharpPeakCount ?? 0} peaks)`,
    );
    if (resolved.hintBeforeFocus?.widePanel && !activeHint.widePanel) {
      appendImportJobDebug('focus: in-focus crop is not wide — column strips unlikely');
    }
  }

  const profiles: OcrLayoutProfile[] = [initialOcrLayoutProfile(activeHint)];

  reportImportJobStep('OCR', 'Reading the Nutrition Facts panel…', 'Neural OCR and Tesseract on preprocessed variants.');
  let candidates = await collectOcrCandidateTexts(
    ocrBytes,
    cachePath,
    options?.easyocrModelDir,
    activeHint,
    profiles[0]!,
    'full',
  );
  let layout = inferLabelLayoutFromText(candidates);
  if (shouldRetryWideTableOcr(activeHint, layout)) {
    reportImportJobStep('OCR', 'Trying alternate layout passes…', 'Wide label — extra OCR profile.');
    profiles.push('wideTableRetry');
    const retryCandidates = await collectOcrCandidateTexts(
      ocrBytes,
      cachePath,
      options?.easyocrModelDir,
      activeHint,
      'wideTableRetry',
      'full',
    );
    candidates = mergeCandidateLists(candidates, retryCandidates);
    layout = inferLabelLayoutFromText(candidates);
  }

  if (activeHint.singleSubjectInFocus && layout.kind === 'single') {
    const splitLabel = await ocrSplitSingleLabel(ocrBytes, cachePath, options?.easyocrModelDir, activeHint);
    if (splitLabel) {
      candidates = mergeCandidateLists([splitLabel], candidates);
      layout = inferLabelLayoutFromText(candidates);
    }
  }

  if (shouldRunColumnStripOcr(activeHint, layout)) {
    const stitched = await ocrAndStitchColumnStrips(
      ocrBytes,
      cachePath,
      options?.easyocrModelDir,
      activeHint,
    );
    if (stitched) {
      candidates = mergeCandidateLists([stitched], candidates);
      layout = inferLabelLayoutFromText(candidates);
    }
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

async function collectTesseractCandidateTexts(
  images: Buffer[],
  cachePath: string,
  logLabel: string,
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const { texts } = await recognizeTesseractBatch(images, cachePath, tesseractPsmModes(), logLabel);
  mergeUniqueCandidates(seen, out, texts);
  return out;
}

async function collectOcrCandidateTexts(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
  profile: OcrLayoutProfile,
  mode: 'full' | 'columnStrip',
): Promise<string[]> {
  const variantOptions: BuildOcrVariantOptions = {
    profile,
    preserveFullWidthFocus: hint.widePanel || profile !== 'default',
  };
  const variants =
    mode === 'columnStrip'
      ? await buildColumnStripOcrVariants(bytes)
      : await buildOcrImageVariants(bytes, variantOptions);

  appendImportJobDebug(`ocr ${mode}: ${variants.length} variant(s) for profile ${profile}`);

  const cap = mode === 'columnStrip' ? { tess: 0, easy: 1 } : variantCapBoost(profile);
  const forEasyOcr = modelDir ? easyOcrVariantSubset(variants, cap.easy) : [];
  const forTesseract = tesseractVariantSubset(variants, mode === 'columnStrip' ? 3 : cap.tess);

  const [easyTexts, tessTexts] = await Promise.all([
    modelDir ? extractEasyOcrTextsFromVariants(forEasyOcr, modelDir) : Promise.resolve([]),
    forTesseract.length > 0
      ? collectTesseractCandidateTexts(forTesseract, cachePath, `${mode}-${profile}`)
      : Promise.resolve([]),
  ]);

  const seen = new Set<string>();
  const out: string[] = [];
  mergeUniqueCandidates(seen, out, easyTexts);
  mergeUniqueCandidates(seen, out, tessTexts);
  if (out.length === 0) out.push('');
  return out;
}

async function ocrAndStitchColumnStrips(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<string | null> {
  const variety = await ocrAndStitchVarietyPack(bytes, cachePath, modelDir, hint);
  if (variety) return variety;

  const plan = await detectColumnStrips(bytes, { maxColumns: 14 });
  if (!plan || plan.strips.length < 2) {
    appendImportJobDebug(
      plan ? `column-strip: only ${plan.strips.length} strip(s) — skip per-column OCR` : 'column-strip: detect returned null',
    );
    return null;
  }

  reportImportJobStep(
    'OCR',
    'Locating product columns…',
    `Found ${plan.strips.length} vertical strips — ink-projection fallback.`,
  );
  return ocrStitchedFromColumnStripPlan(bytes, plan, cachePath, modelDir, hint, 'column-strip');
}

async function ocrAndStitchVarietyPack(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<string | null> {
  const pipeline = await runVarietyPackGridPipeline(bytes, {
    maxColumns: 14,
    layoutHint: {
      singleSubjectInFocus: hint.singleSubjectInFocus,
      sharpPeakCount: hint.sharpPeakCount,
    },
  });
  for (const step of [1, 2, 3, 4] as const) {
    appendImportJobDebug(`variety grid ${formatVarietyPackStepValidation(pipeline.steps[step].validation)}`);
  }
  if (pipeline.steps[3].data?.layout === 'split_single') {
    appendImportJobDebug('variety pack: split single label — not a multi-product table');
    return null;
  }
  if (pipeline.plan) {
    return ocrAndStitchSharedLabelPlan(bytes, pipeline.plan, cachePath, modelDir, hint);
  }
  if (pipeline.perColumnStripPlan) {
    reportImportJobStep(
      'OCR',
      'Reading per-column labels…',
      `${pipeline.perColumnStripPlan.strips.length} product columns (labels in each column).`,
    );
    appendImportJobDebug(
      `per-column variety pack: ${pipeline.perColumnStripPlan.strips.length} ruled product columns`,
    );
    return ocrStitchedFromColumnStripPlan(
      bytes,
      pipeline.perColumnStripPlan,
      cachePath,
      modelDir,
      hint,
      'per-column variety pack',
    );
  }
  appendImportJobDebug('variety pack: no shared-rail or per-column OCR plan');
  return null;
}

async function ocrStitchedFromColumnStripPlan(
  bytes: Buffer,
  plan: ColumnStripPlan,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
  logPrefix: string,
): Promise<string | null> {
  const meta = await sharp(bytes).rotate().metadata();
  const fullWidth = meta.width ?? 0;
  appendImportJobDebug(`${logPrefix}: ${plan.strips.length} strips detected`);
  const widthSummary = plan.strips
    .map((strip) => (fullWidth > 0 ? `${Math.round((strip.width / fullWidth) * 100)}%` : `${strip.width}px`))
    .join(', ');
  appendImportJobDebug(`${logPrefix} geometry: widths ${widthSummary} of ${fullWidth}px`);
  const minStripWidth = Math.max(32, Math.round(fullWidth * COLUMN_STRIP_MIN_OCR_WIDTH_FRACTION));
  const eligible = plan.strips.filter((strip) => strip.width >= minStripWidth);
  if (eligible.length < 2) {
    appendImportJobDebug(`${logPrefix}: ${eligible.length} strip(s) above min width ${minStripWidth}px`);
    return null;
  }

  const buffers = await extractColumnStripBuffers(bytes, { ...plan, strips: eligible });
  const stripTexts: string[] = [];
  for (let index = 0; index < buffers.length; index += 1) {
    const strip = eligible[index]!;
    const dim = await sharp(buffers[index]!).metadata();
    reportImportJobStep(
      'OCR',
      `Reading column ${index + 1} of ${buffers.length}…`,
      `Strip ${strip.width}×${strip.height}px (crop ${dim.width ?? 0}×${dim.height ?? 0}).`,
    );
    appendImportJobDebug(
      `${logPrefix} ${index + 1}/${buffers.length}: crop ${dim.width ?? 0}×${dim.height ?? 0}px`,
    );

    const stripCandidates = await collectOcrCandidateTexts(
      buffers[index]!,
      cachePath,
      modelDir,
      hint,
      'wideTable',
      'columnStrip',
    );
    const best = pickBestStripCandidate(stripCandidates);
    const score = scoreLabelExtraction(best);
    appendImportJobDebug(`${logPrefix} ${index + 1}: score ${score}, ${best.trim().length} chars`);
    stripTexts.push(best);
  }

  const stitched = stitchColumnStripOcrTexts(stripTexts);
  if (!stitched) {
    appendImportJobDebug(
      `${logPrefix}: stitch returned null (${stripTexts.length} strips, chars ${stripTexts.map((t) => t.trim().length).join(',')})`,
    );
    return null;
  }
  const parsed = parseMultiProductLabelTable(stitched);
  if (!parsed || parsed.length < 2) {
    appendImportJobDebug(`${logPrefix}: stitch did not parse as multi-product (${parsed?.length ?? 0} columns)`);
    return null;
  }
  appendImportJobDebug(`${logPrefix}: stitch OK — ${parsed.length} products`);
  return stitched;
}

async function ocrAndStitchSharedLabelPlan(
  bytes: Buffer,
  plan: NonNullable<Awaited<ReturnType<typeof runVarietyPackGridPipeline>>['plan']>,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<string | null> {

  reportImportJobStep('OCR', 'Reading shared label table…', `Label column + ${plan.valueColumns.length} value columns.`);
  appendImportJobDebug(
    `shared-label grid: label ${plan.labelColumn.width}px, ${plan.valueColumns.length} value columns (ruled-grid detect)`,
  );

  const meta = await sharp(bytes).rotate().metadata();
  const fullWidth = meta.width ?? 0;
  const widthSummary = plan.valueColumns
    .map((col) => (fullWidth > 0 ? `${Math.round((col.width / fullWidth) * 100)}%` : `${col.width}px`))
    .join(', ');
  appendImportJobDebug(`shared-label grid value widths: ${widthSummary}`);

  const crops = await extractSharedLabelGridBuffers(bytes, plan);
  const labelText = pickBestStripCandidate(
    await collectOcrCandidateTexts(crops.labelColumn, cachePath, modelDir, hint, 'wideTable', 'columnStrip'),
  );
  appendImportJobDebug(`shared-label grid: label OCR ${labelText.trim().length} chars`);

  const headerText = pickBestStripCandidate(
    await collectOcrCandidateTexts(crops.headerBand, cachePath, modelDir, hint, 'wideTable', 'columnStrip'),
  );
  appendImportJobDebug(`shared-label grid: header OCR ${headerText.trim().length} chars`);

  const valueTexts: string[] = [];
  for (let index = 0; index < crops.valueColumns.length; index += 1) {
    const buf = crops.valueColumns[index]!;
    appendImportJobDebug(`shared-label grid value ${index + 1}/${crops.valueColumns.length}`);
    const best = pickBestStripCandidate(
      await collectOcrCandidateTexts(buf, cachePath, modelDir, hint, 'wideTable', 'columnStrip'),
    );
    valueTexts.push(best);
  }

  const stitchDiag = diagnoseSharedLabelGridStitch(labelText, valueTexts, headerText);
  const stitched = stitchSharedLabelGridTexts(labelText, valueTexts, headerText);
  if (!stitched) {
    appendImportJobDebug(`shared-label grid: stitch failed — ${formatSharedLabelStitchFailure(stitchDiag)}`);
    return null;
  }
  const parsed = parseMultiProductLabelTable(stitched);
  if (!parsed || parsed.length < 2) {
    appendImportJobDebug(
      `shared-label grid: stitch did not parse as multi-product (${parsed?.length ?? 0} columns)`,
    );
    return null;
  }
  appendImportJobDebug(`shared-label grid: stitch OK — ${parsed.length} products`);
  return stitched;
}

async function ocrSplitSingleLabel(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<string | null> {
  const plan = await detectSplitSingleLabel(bytes, hint);
  if (!plan) {
    appendImportJobDebug('split-single-label: detect returned null');
    return null;
  }
  appendImportJobDebug(
    `split-single-label: two halves ${plan.strips[0]!.width}px + ${plan.strips[1]!.width}px`,
  );
  const [leftBuf, rightBuf] = await extractSplitSingleLabelBuffers(bytes, plan);
  const leftText = pickBestStripCandidate(
    await collectOcrCandidateTexts(leftBuf, cachePath, modelDir, hint, 'default', 'columnStrip'),
  );
  const rightText = pickBestStripCandidate(
    await collectOcrCandidateTexts(rightBuf, cachePath, modelDir, hint, 'default', 'columnStrip'),
  );
  appendImportJobDebug(
    `split-single-label: OCR left ${leftText.trim().length} chars, right ${rightText.trim().length} chars`,
  );
  const merged = stitchSplitLabelHalves(leftText, rightText);
  if (!merged) {
    appendImportJobDebug('split-single-label: stitch returned null');
    return null;
  }
  appendImportJobDebug('split-single-label: stitch OK');
  return merged;
}

function pickBestStripCandidate(candidates: string[]): string {
  let best = candidates[0] ?? '';
  let bestScore = scoreLabelExtraction(best);
  for (const candidate of candidates.slice(1)) {
    const score = scoreLabelExtraction(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
