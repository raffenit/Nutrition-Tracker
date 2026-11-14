import { PDFParse } from 'pdf-parse';
import { PSM, type Worker } from 'tesseract.js';
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
import { OCR_IMPORT_MAX_PRODUCT_COLUMNS } from '../domain/columnStripDetectParams.js';
import { separateSharedLabelValueTexts } from '../domain/sharedLabelColumnSeparation.js';
import { countSharedLabelMacroColumns } from '../domain/sharedLabelGridStageReport.js';
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
import {
  extractSharedLabelColumnPngsByRowBands,
  extractSharedLabelGridBuffers,
  rowBandMinExtractSize,
  useRowBandSliceOcrForPlan,
} from './sharedLabelValueGrid.js';
import type { ColumnStripRegion } from './labelColumnStrips.js';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
  type VarietyPackPipelineRunResult,
} from './varietyPackGridPipeline.js';
import { detectSplitSingleLabel, extractSplitSingleLabelBuffers } from './splitSingleLabel.js';
import {
  buildColumnStripOcrVariants,
  buildRowBandOcrVariants,
  buildOcrImageVariants,
  easyOcrVariantSubset,
  tesseractVariantSubset,
  type BuildOcrVariantOptions,
} from './ocrPreprocess.js';
import {
  openTesseractWorker,
  recognizeImagesOnWorker,
  recognizeTesseractBatch,
  resetTesseractRunCounter,
} from './tesseractOcr.js';

/** Cap OCR text candidates while still feeding the per-slot merge pool. */
const MAX_OCR_CANDIDATES = 28;

function tesseractPsmModes(): PSM[] {
  if (process.env.TESSERACT_DUAL_PSM === '1') {
    return [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN];
  }
  return [PSM.SINGLE_BLOCK];
}

/** Value cells: one horizontal line per crop. */
function tesseractRowBandValuePsmModes(): PSM[] {
  return [PSM.SINGLE_LINE];
}

/** Shared label column: nutrient names may wrap — block mode reads better. */
function tesseractRowBandLabelPsmModes(): PSM[] {
  return [PSM.SINGLE_BLOCK];
}

export type ImageLabelExtraction = {
  text: string;
  /** Best per-row values merged across OCR engines (label + unit driven). */
  slotMergedNutrients: Nutrients | null;
  /** Value columns from variety-pack geometry when column-strip OCR ran. */
  varietyPackExpectedColumns?: number;
};

type StitchedColumnOcrResult = {
  text: string;
  expectedColumns: number;
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
  resetTesseractRunCounter();
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

  let varietyPackPreflight: VarietyPackPipelineRunResult | null = null;
  if (activeHint.widePanel) {
    varietyPackPreflight = await runVarietyPackGridPipeline(ocrBytes, {
      maxColumns: OCR_IMPORT_MAX_PRODUCT_COLUMNS,
      layoutHint: {
        singleSubjectInFocus: activeHint.singleSubjectInFocus,
        sharpPeakCount: activeHint.sharpPeakCount,
      },
    });
    for (const step of [1, 2, 3, 4] as const) {
      appendImportJobDebug(`geometry preflight: ${formatVarietyPackStepValidation(varietyPackPreflight.steps[step].validation)}`);
    }
  }
  const geometryStep4Ok = varietyPackPreflight?.lastOkStep === 4;
  const sharedRailPlan = varietyPackPreflight?.plan ?? null;
  const skipFullPageForSharedRail = Boolean(sharedRailPlan && geometryStep4Ok);

  const profiles: OcrLayoutProfile[] = [initialOcrLayoutProfile(activeHint)];
  let candidates: string[] = [];
  let layout = inferLabelLayoutFromText(['']);

  if (skipFullPageForSharedRail) {
    appendImportJobDebug(
      `geometry: shared-rail plan (${sharedRailPlan!.valueColumns.length} value cols) — skip full-page OCR`,
    );
    layout = {
      kind: 'multi_column_table',
      bestCandidateIndex: 0,
      multiProductColumnCount: sharedRailPlan!.valueColumns.length,
      nutritionFactsCount: 1,
    };
  } else {
    reportImportJobStep('OCR', 'Reading the Nutrition Facts panel…', 'Neural OCR and Tesseract on preprocessed variants.');
    candidates = await collectOcrCandidateTexts(
      ocrBytes,
      cachePath,
      options?.easyocrModelDir,
      activeHint,
      profiles[0]!,
      'full',
    );
    layout = inferLabelLayoutFromText(candidates);
    if (shouldRetryWideTableOcr(activeHint, layout) && !geometryStep4Ok) {
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
    } else if (shouldRetryWideTableOcr(activeHint, layout) && geometryStep4Ok) {
      appendImportJobDebug('geometry: skip wideTableRetry — variety-pack steps 1–4 OK');
    }
  }

  if (activeHint.singleSubjectInFocus && layout.kind === 'single') {
    const splitLabel = await ocrSplitSingleLabel(ocrBytes, cachePath, options?.easyocrModelDir, activeHint);
    if (splitLabel) {
      candidates = mergeCandidateLists([splitLabel], candidates);
      layout = inferLabelLayoutFromText(candidates);
    }
  }

  let varietyPackExpectedColumns: number | undefined;
  let structuredTableCandidateIndex: number | undefined;
  const runStructuredOcr = skipFullPageForSharedRail || shouldRunColumnStripOcr(activeHint, layout);
  if (runStructuredOcr) {
    const stitched = varietyPackPreflight
      ? await ocrStitchedFromVarietyPackPipeline(
          ocrBytes,
          varietyPackPreflight,
          cachePath,
          options?.easyocrModelDir,
          activeHint,
        )
      : await ocrAndStitchColumnStrips(ocrBytes, cachePath, options?.easyocrModelDir, activeHint);
    if (stitched) {
      structuredTableCandidateIndex = 0;
      candidates = mergeCandidateLists([stitched.text], candidates);
      varietyPackExpectedColumns = stitched.expectedColumns;
      layout = inferLabelLayoutFromText(candidates);
    } else if (sharedRailPlan) {
      varietyPackExpectedColumns = sharedRailPlan.valueColumns.length;
      appendImportJobDebug(
        `geometry: shared-rail stitch unavailable — import will pad ${varietyPackExpectedColumns} placeholder panel(s)`,
      );
    } else if (varietyPackPreflight?.perColumnStripPlan) {
      varietyPackExpectedColumns = varietyPackPreflight.perColumnStripPlan.strips.length;
      appendImportJobDebug(
        `geometry: per-column stitch unavailable — import will pad ${varietyPackExpectedColumns} placeholder panel(s)`,
      );
    }
  }

  reportImportJobStep('Parse', 'Matching label rows…', 'Selecting the best OCR candidate and merging nutrients.');
  const slotMergedNutrients = mergeSlotReadingsAcrossCandidates(candidates);
  const textIdx = pickImportTextCandidateIndex(candidates, layout, {
    varietyPackExpectedColumns,
    structuredTableCandidateIndex,
  });
  const text = candidates[textIdx] ?? candidates[0] ?? '';
  reportImportJobStep('Draft', 'Building your draft…', 'Combining structured import fields.');
  return { text, slotMergedNutrients, varietyPackExpectedColumns };
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

type CollectOcrOptions = {
  tessWorker?: Worker;
  /** Default: skip on columnStrip unless EASYOCR_COLUMN_STRIPS=1 */
  allowEasyOcr?: boolean;
};

async function collectTesseractCandidateTexts(
  images: Buffer[],
  cachePath: string,
  logLabel: string,
  existingWorker?: Worker,
): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  const psm = tesseractPsmModes();
  const texts = existingWorker
    ? (await recognizeImagesOnWorker(existingWorker, images, psm, logLabel)).texts
    : (await recognizeTesseractBatch(images, cachePath, psm, logLabel)).texts;
  mergeUniqueCandidates(seen, out, texts);
  return out;
}

function columnStripTesseractVariantCount(): number {
  const raw = Number(process.env.TESSERACT_COLUMN_STRIP_VARIANTS ?? '1');
  return Number.isFinite(raw) && raw > 0 ? Math.min(4, Math.round(raw)) : 1;
}

function easyOcrAllowedForMode(mode: 'full' | 'columnStrip' | 'rowBand', allowEasyOcr?: boolean): boolean {
  if (mode === 'rowBand') return false;
  if (allowEasyOcr === false) return false;
  if (mode === 'columnStrip' && process.env.EASYOCR_COLUMN_STRIPS !== '1') return false;
  return true;
}

async function collectOcrCandidateTexts(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
  profile: OcrLayoutProfile,
  mode: 'full' | 'columnStrip' | 'rowBand',
  options?: CollectOcrOptions,
): Promise<string[]> {
  const variantOptions: BuildOcrVariantOptions = {
    profile,
    preserveFullWidthFocus: hint.widePanel || profile !== 'default',
  };
  const variants =
    mode === 'rowBand'
      ? await buildRowBandOcrVariants(bytes)
      : mode === 'columnStrip'
        ? await buildColumnStripOcrVariants(bytes)
        : await buildOcrImageVariants(bytes, variantOptions);

  appendImportJobDebug(`ocr ${mode}: ${variants.length} variant(s) for profile ${profile}`);

  const stripLike = mode === 'columnStrip' || mode === 'rowBand';
  const cap = stripLike ? { tess: 0, easy: 1 } : variantCapBoost(profile);
  const forEasyOcr =
    modelDir && easyOcrAllowedForMode(mode, options?.allowEasyOcr)
      ? easyOcrVariantSubset(variants, cap.easy)
      : [];
  const tessExtra =
    mode === 'rowBand' ? 1 : mode === 'columnStrip' ? columnStripTesseractVariantCount() : cap.tess;
  const forTesseract = tesseractVariantSubset(variants, tessExtra);

  const [easyTexts, tessTexts] = await Promise.all([
    forEasyOcr.length > 0 ? extractEasyOcrTextsFromVariants(forEasyOcr, modelDir!) : Promise.resolve([]),
    forTesseract.length > 0
      ? collectTesseractCandidateTexts(
          forTesseract,
          cachePath,
          `${mode}-${profile}`,
          options?.tessWorker,
        )
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
): Promise<StitchedColumnOcrResult | null> {
  const variety = await ocrAndStitchVarietyPack(bytes, cachePath, modelDir, hint);
  if (variety) return variety;

  const plan = await detectColumnStrips(bytes, { maxColumns: OCR_IMPORT_MAX_PRODUCT_COLUMNS });
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

async function ocrStitchedFromVarietyPackPipeline(
  bytes: Buffer,
  pipeline: VarietyPackPipelineRunResult,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<StitchedColumnOcrResult | null> {
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

async function ocrAndStitchVarietyPack(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<StitchedColumnOcrResult | null> {
  const pipeline = await runVarietyPackGridPipeline(bytes, {
    maxColumns: OCR_IMPORT_MAX_PRODUCT_COLUMNS,
    layoutHint: {
      singleSubjectInFocus: hint.singleSubjectInFocus,
      sharpPeakCount: hint.sharpPeakCount,
    },
  });
  for (const step of [1, 2, 3, 4] as const) {
    appendImportJobDebug(`variety grid ${formatVarietyPackStepValidation(pipeline.steps[step].validation)}`);
  }
  return ocrStitchedFromVarietyPackPipeline(bytes, pipeline, cachePath, modelDir, hint);
}

async function ocrStitchedFromColumnStripPlan(
  bytes: Buffer,
  plan: ColumnStripPlan,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
  logPrefix: string,
): Promise<StitchedColumnOcrResult | null> {
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
  if (parsed && parsed.length >= 2) {
    appendImportJobDebug(`${logPrefix}: stitch OK — ${parsed.length} products`);
    return { text: stitched, expectedColumns: plan.strips.length };
  }
  if (stitched.trim().length > 0 && eligible.length >= 2) {
    appendImportJobDebug(
      `${logPrefix}: partial stitch — parse saw ${parsed?.length ?? 0} columns; returning OCR table`,
    );
    return { text: stitched, expectedColumns: plan.strips.length };
  }
  appendImportJobDebug(`${logPrefix}: stitch did not parse as multi-product (${parsed?.length ?? 0} columns)`);
  return null;
}

type SharedLabelColumnTexts = {
  labelText: string;
  headerText: string;
  valueTexts: string[];
  usedRowBand: boolean;
};

async function ocrSharedLabelGridColumns(
  bytes: Buffer,
  plan: NonNullable<Awaited<ReturnType<typeof runVarietyPackGridPipeline>>['plan']>,
  crops: Awaited<ReturnType<typeof extractSharedLabelGridBuffers>>,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
  rowBandOcr: boolean,
): Promise<SharedLabelColumnTexts> {
  const ocrStripText = async (png: Buffer, label: string, ocrMode: 'columnStrip' | 'rowBand' = 'columnStrip'): Promise<string> => {
    const candidates = await collectOcrCandidateTexts(
      png,
      cachePath,
      modelDir,
      hint,
      'wideTable',
      ocrMode,
    );
    const best = pickBestStripCandidate(candidates);
    appendImportJobDebug(`${label}: ${best.trim().length} chars`);
    return best;
  };

  const preprocessRowBandSlices = async (slicePngs: Buffer[]): Promise<Buffer[]> => {
    const images: Buffer[] = [];
    for (const png of slicePngs) {
      const variants = await buildRowBandOcrVariants(png);
      images.push(variants[0] ?? png);
    }
    return images;
  };

  const imageMeta = await sharp(bytes).rotate().metadata();
  const fullImageWidth = imageMeta.width ?? 0;

  const ocrColumnByRowBandsWithWorker = async (
    worker: Awaited<ReturnType<typeof openTesseractWorker>>,
    column: Pick<ColumnStripRegion, 'left' | 'width'>,
    fallbackPng: Buffer,
    label: string,
    psmModes: PSM[],
  ): Promise<string> => {
    const minSize = rowBandMinExtractSize(plan, column.width, fullImageWidth);
    appendImportJobDebug(
      `${label} row-band: min extract ${minSize.minWidthPx}×${minSize.minHeightPx}px (column ${column.width}px)`,
    );
    const slicePngs = await extractSharedLabelColumnPngsByRowBands(bytes, column, plan.rowBandSlices, minSize);
    if (slicePngs.length === 0) {
      return ocrStripText(fallbackPng, `${label} body`);
    }
    for (let sliceIndex = 0; sliceIndex < slicePngs.length; sliceIndex += 1) {
      const sliceMeta = await sharp(slicePngs[sliceIndex]).metadata();
      const w = sliceMeta.width ?? 0;
      const h = sliceMeta.height ?? 0;
      if (w < minSize.minWidthPx || h < minSize.minHeightPx) {
        appendImportJobDebug(`${label} slice ${sliceIndex + 1}: ${w}×${h}px (below min)`);
      }
    }
    const images = await preprocessRowBandSlices(slicePngs);
    const { texts } = await recognizeImagesOnWorker(worker, images, psmModes, `${label}-rows`);
    return texts
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
  };

  let labelText: string;
  let headerText: string;
  const valueTexts: string[] = [];

  if (rowBandOcr) {
    const worker = await openTesseractWorker(cachePath, 'shared-label-grid');
    try {
      appendImportJobDebug(
        `shared-label grid: batched row-band OCR (${plan.rowBandSlices.length} slices × ${1 + plan.valueColumns.length} columns, one worker)`,
      );
      labelText = await ocrColumnByRowBandsWithWorker(
        worker,
        plan.labelColumn,
        crops.labelColumn,
        'label',
        tesseractRowBandLabelPsmModes(),
      );
      appendImportJobDebug(`shared-label grid: label OCR ${labelText.trim().length} chars`);
      const headerPrep = await buildRowBandOcrVariants(crops.headerBand);
      const headerImages = [headerPrep[0] ?? crops.headerBand];
      const headerMeta = await sharp(headerImages[0]).metadata();
      appendImportJobDebug(`header row-band prep: ${headerMeta.width ?? 0}×${headerMeta.height ?? 0}px`);
      const { texts: headerTexts } = await recognizeImagesOnWorker(
        worker,
        headerImages,
        tesseractRowBandLabelPsmModes(),
        'header',
      );
      headerText = headerTexts.map((line) => line.trim()).filter(Boolean).join('\n');
      appendImportJobDebug(`shared-label grid: header OCR ${headerText.trim().length} chars`);
      for (let index = 0; index < plan.valueColumns.length; index += 1) {
        const col = plan.valueColumns[index]!;
        appendImportJobDebug(`shared-label grid value ${index + 1}/${plan.valueColumns.length}`);
        valueTexts.push(
          await ocrColumnByRowBandsWithWorker(
            worker,
            col,
            crops.valueColumns[index]!,
            `value ${index + 1}`,
            tesseractRowBandValuePsmModes(),
          ),
        );
      }
    } finally {
      await worker.terminate();
    }
  } else {
    const worker = await openTesseractWorker(cachePath, 'shared-label-grid-body');
    const tessOpts = { tessWorker: worker };
    try {
      const ocrBodyColumn = async (png: Buffer, label: string) => {
        const candidates = await collectOcrCandidateTexts(
          png,
          cachePath,
          modelDir,
          hint,
          'wideTable',
          'columnStrip',
          tessOpts,
        );
        const best = pickBestStripCandidate(candidates);
        appendImportJobDebug(`${label}: ${best.trim().length} chars`);
        return best;
      };
      appendImportJobDebug('shared-label grid: body-column OCR (one Tesseract worker, tess-only strips)');
      labelText = await ocrBodyColumn(crops.labelColumn, 'label body');
      appendImportJobDebug(`shared-label grid: label OCR ${labelText.trim().length} chars`);
      headerText = await ocrBodyColumn(crops.headerBand, 'header');
      appendImportJobDebug(`shared-label grid: header OCR ${headerText.trim().length} chars`);
      for (let index = 0; index < plan.valueColumns.length; index += 1) {
        appendImportJobDebug(`shared-label grid value ${index + 1}/${plan.valueColumns.length}`);
        valueTexts.push(await ocrBodyColumn(crops.valueColumns[index]!, `value ${index + 1} body`));
      }
    } finally {
      await worker.terminate();
    }
  }

  return { labelText, headerText, valueTexts, usedRowBand: rowBandOcr };
}

async function ocrAndStitchSharedLabelPlan(
  bytes: Buffer,
  plan: NonNullable<Awaited<ReturnType<typeof runVarietyPackGridPipeline>>['plan']>,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<StitchedColumnOcrResult | null> {
  let expectedColumns = plan.valueColumns.length;

  reportImportJobStep('OCR', 'Reading shared label table…', `Label column + ${expectedColumns} value columns.`);
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
  const rowBandOcr = useRowBandSliceOcrForPlan(plan);
  appendImportJobDebug(
    `shared-label grid: body ${plan.nutrientBodyHeight}px @ y=${plan.nutrientBodyTop}, row slices=${plan.rowBandSlices.length}, rowPitch=${plan.rowPitchPx}px, rowOcr=${rowBandOcr}`,
  );

  let columnTexts = await ocrSharedLabelGridColumns(
    bytes,
    plan,
    crops,
    cachePath,
    modelDir,
    hint,
    rowBandOcr,
  );
  let { labelText, headerText, valueTexts } = columnTexts;
  const separated = separateSharedLabelValueTexts(labelText, valueTexts);
  if (separated.droppedIndexes.length > 0) {
    appendImportJobDebug(
      `shared-label grid: dropped value column OCR at index [${separated.droppedIndexes.join(', ')}] — label rail text in value strip`,
    );
    valueTexts = separated.valueColumnTexts;
    if (valueTexts.length >= 2 && valueTexts.length !== expectedColumns) {
      appendImportJobDebug(
        `shared-label grid: product value column count ${valueTexts.length} (plan ${expectedColumns})`,
      );
      expectedColumns = valueTexts.length;
    }
  }

  let stitched = stitchSharedLabelGridTexts(labelText, valueTexts, headerText);
  let parsed = stitched ? parseMultiProductLabelTable(stitched) : null;
  let macroCount = countSharedLabelMacroColumns(parsed);

  if (columnTexts.usedRowBand && macroCount < 1) {
    appendImportJobDebug(
      'shared-label grid: row-band yielded no macro columns — fallback to body-column OCR',
    );
    columnTexts = await ocrSharedLabelGridColumns(bytes, plan, crops, cachePath, modelDir, hint, false);
    labelText = columnTexts.labelText;
    headerText = columnTexts.headerText;
    const separatedFallback = separateSharedLabelValueTexts(labelText, columnTexts.valueTexts);
    if (separatedFallback.droppedIndexes.length > 0) {
      appendImportJobDebug(
        `shared-label grid: dropped value column OCR at index [${separatedFallback.droppedIndexes.join(', ')}] — label rail text in value strip`,
      );
    }
    valueTexts = separatedFallback.valueColumnTexts;
    stitched = stitchSharedLabelGridTexts(labelText, valueTexts, headerText);
    parsed = stitched ? parseMultiProductLabelTable(stitched) : null;
    macroCount = countSharedLabelMacroColumns(parsed);
    appendImportJobDebug(`shared-label grid: body-column fallback macroColumns=${macroCount}`);
  }

  const stitchDiagFinal = diagnoseSharedLabelGridStitch(labelText, valueTexts, headerText);
  const rowBandOcrFinal = columnTexts.usedRowBand;
  if (!stitched) {
    appendImportJobDebug(`shared-label grid: stitch failed — ${formatSharedLabelStitchFailure(stitchDiagFinal)}`);
    return null;
  }
  if (parsed && parsed.length >= 2) {
    appendImportJobDebug(`shared-label grid: stitch OK — ${parsed.length} products (${macroCount} with macros)`);
    return { text: stitched, expectedColumns };
  }
  if (stitchDiagFinal.ok) {
    const parsedCount = parsed?.length ?? 0;
    appendImportJobDebug(
      `shared-label grid: stitch structurally OK; parse saw ${parsedCount} columns — returning stitched OCR`,
    );
    appendImportJobDebug(
      `shared-label grid: stitch metrics ${JSON.stringify({
        rowLabels: stitchDiagFinal.rowLabelCount,
        rowCount: stitchDiagFinal.rowCount,
        confidentProductCols: stitchDiagFinal.productColumnCount,
        valueLinesPerCol: stitchDiagFinal.valueLineCounts,
        parsedColumns: parsedCount,
        macroColumns: macroCount,
        labelChars: labelText.trim().length,
        headerChars: headerText.trim().length,
        valueCharsPerCol: valueTexts.map((t) => t.trim().length),
        rowBandOcr: rowBandOcrFinal,
        rowSlices: plan.rowBandSlices.length,
        rowPitchPx: plan.rowPitchPx,
      })}`,
    );
    return { text: stitched, expectedColumns };
  }
  appendImportJobDebug(
    `shared-label grid: stitch did not parse as multi-product (${parsed?.length ?? 0} columns)`,
  );
  return null;
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
