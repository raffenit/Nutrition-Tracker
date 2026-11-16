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
import {
  assessSharedLabelRowBandOcrRetry,
  countSharedLabelMacroColumns,
} from '../domain/sharedLabelGridStageReport.js';
import { parseMultiProductLabelTable } from '../domain/parseMultiProductLabelTable.js';
import { scoreLabelExtraction } from '../domain/labelSlots.js';
import { stitchColumnStripOcrTexts } from '../domain/stitchColumnStripTexts.js';
import {
  diagnoseSharedLabelGridStitch,
  formatSharedLabelStitchFailure,
  stitchSharedLabelGridFromRowBandSlices,
  stitchSharedLabelGridTexts,
  type SharedLabelStitchOptions,
} from '../domain/stitchSharedLabelGridTexts.js';
import { stitchSplitLabelHalves } from '../domain/stitchSplitLabelHalves.js';
import { appendDailyValueInferredRows } from '../domain/labelDailyValueRowInference.js';
import {
  mergeSlotReadingsAcrossCandidates,
} from '../domain/labelSlotExtract.js';
import { assessCoreMacroReadiness, type CoreMacroReadiness } from '../domain/labelOcrMacroReadiness.js';
import { findSlotRowLine, rowCropRect } from '../domain/labelRowReread.js';
import type { LabelSlotKey } from '../domain/labelSlotExtract.js';
import type { PipelineStageTiming } from '../domain/ocrPipelineStages.js';
import {
  isPortraitSingleOcrHint,
  PORTRAIT_SINGLE_EASY_TIEBREAK_CAP,
  PORTRAIT_SINGLE_EASY_VARIANT_CAP,
  PORTRAIT_SINGLE_TESS_VARIANT_CAP,
  portraitSingleOcrEnabled,
} from '../domain/portraitSingleOcrParams.js';
import type { Nutrients } from '../types.js';
import { OcrPipelineTimer } from './ocrPipelineTimer.js';
import { extractEasyOcrTextsFromVariants } from './easyOcr.js';
import { appendImportJobDebug, reportImportJobStep } from '../import/importJobProgress.js';
import { inferLabelLayoutHint, resolveLabelProcessingImage } from './imageLayoutHint.js';
import { resolveLabelOcrSources } from './labelOcrSources.js';
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
  type SharedLabelValueGridPlan,
} from './sharedLabelValueGrid.js';
import type { SharedLabelRowBandSlice } from '../domain/sharedLabelGridLayout.js';
import type { ColumnStripRegion } from './labelColumnStrips.js';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
  type VarietyPackPipelineRunResult,
} from './varietyPackGridPipeline.js';
import { detectSplitSingleLabel, extractSplitSingleLabelBuffers } from './splitSingleLabel.js';
import { buildDewarpedStripOcrVariants, dewarpCurvedLabelRules } from './curvedLabelDewarp.js';
import {
  buildColumnStripOcrVariants,
  buildRowBandOcrVariants,
  buildOcrImageVariants,
  buildStackedRowCrops,
  easyOcrVariantSubset,
  tesseractVariantSubset,
  type BuildOcrVariantOptions,
} from './ocrPreprocess.js';
import {
  openTesseractWorker,
  recognizeImagesOnWorker,
  recognizeTesseractBatch,
  type TesseractLineBox,
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
  /** Wall-clock stage breakdown for this extract (all layout classes). */
  pipelineStages?: PipelineStageTiming[];
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
  const timer = new OcrPipelineTimer();
  reportImportJobStep('Preprocess', 'Preparing image for OCR…', 'Auto-rotate, upscale, and layout hints.');
  const resolved = await resolveLabelProcessingImage(bytes);
  timer.lap(
    'preprocess',
    resolved.focusCropApplied ? 'in-focus crop' : `${resolved.hintBeforeFocus?.width ?? '—'}×${resolved.hintBeforeFocus?.height ?? '—'}px`,
  );
  const sources = await resolveLabelOcrSources(resolved, cachePath);
  const geometryBytes = sources.geometryBytes;
  const pageOcrBytes = sources.pageOcrBytes;
  const activeHint = sources.hint;
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
    varietyPackPreflight = await runVarietyPackGridPipeline(geometryBytes, {
      maxColumns: OCR_IMPORT_MAX_PRODUCT_COLUMNS,
      layoutHint: {
        singleSubjectInFocus: activeHint.singleSubjectInFocus,
        sharpPeakCount: activeHint.sharpPeakCount,
      },
    });
    for (const step of [1, 2, 3, 4] as const) {
      appendImportJobDebug(`geometry preflight: ${formatVarietyPackStepValidation(varietyPackPreflight.steps[step].validation)}`);
    }
    timer.lap('geometry', `steps OK through ${varietyPackPreflight.lastOkStep}`);
  }
  const geometryStep4Ok = varietyPackPreflight?.lastOkStep === 4;
  const sharedRailPlan = varietyPackPreflight?.plan ?? null;
  const skipFullPageForSharedRail = Boolean(sharedRailPlan && geometryStep4Ok);

  // The in-focus crop loses the blur contrast that marks a single subject, so split-label
  // detection runs on the upload with the pre-crop hint when a focus crop was applied.
  const splitSource =
    resolved.focusCropApplied && resolved.hintBeforeFocus?.singleSubjectInFocus
      ? { bytes, hint: resolved.hintBeforeFocus }
      : { bytes: geometryBytes, hint: activeHint };
  const splitLabel =
    !skipFullPageForSharedRail && splitSource.hint.singleSubjectInFocus
      ? await ocrSplitSingleLabel(splitSource.bytes, cachePath, options?.easyocrModelDir, splitSource.hint)
      : null;
  if (splitLabel) {
    timer.lap('ocr_split_single', `${splitLabel.candidates.length} stitched candidate(s)`);
  }
  // Full-page EasyOCR over two side-by-side halves reads across the split; skip it when the halves already read well.
  const splitSkipsFullPageEasy = Boolean(
    splitLabel && splitLabel.readiness.missing.length <= SPLIT_LABEL_MAX_MISSING_CORE_FOR_EASY_SKIP,
  );
  const splitSkipsFullPage = Boolean(
    splitLabel && splitLabel.readiness.missing.length <= SPLIT_LABEL_MAX_MISSING_CORE_FOR_PAGE_SKIP,
  );
  if (splitSkipsFullPage) appendImportJobDebug('split-single-label: skip full-page OCR');
  else if (splitSkipsFullPageEasy) appendImportJobDebug('split-single-label: skip full-page EasyOCR');

  const profiles: OcrLayoutProfile[] = [initialOcrLayoutProfile(activeHint)];
  let candidates: string[] = [];
  let layout = inferLabelLayoutFromText(['']);

  if (skipFullPageForSharedRail) {
    appendImportJobDebug(
      `geometry: shared-rail plan (${sharedRailPlan!.valueColumns.length} value cols) — skip full-page OCR`,
    );
    timer.lap('ocr_full_page', 'skipped — shared label table');
    layout = {
      kind: 'multi_column_table',
      bestCandidateIndex: 0,
      multiProductColumnCount: sharedRailPlan!.valueColumns.length,
      nutritionFactsCount: 1,
    };
  } else if (splitSkipsFullPage) {
    timer.lap('ocr_full_page', 'skipped — split label halves read');
  } else {
    reportImportJobStep('OCR', 'Reading the Nutrition Facts panel…', 'Neural OCR and Tesseract on preprocessed variants.');
    candidates = await collectOcrCandidateTexts(
      pageOcrBytes,
      cachePath,
      options?.easyocrModelDir,
      activeHint,
      profiles[0]!,
      'full',
      { timer, fullPageLapId: 'ocr_full_page', ...(splitSkipsFullPageEasy ? { allowEasyOcr: false } : {}) },
    );
    layout = inferLabelLayoutFromText(candidates);
    if (shouldRetryWideTableOcr(activeHint, layout) && !geometryStep4Ok) {
      reportImportJobStep('OCR', 'Trying alternate layout passes…', 'Wide label — extra OCR profile.');
      profiles.push('wideTableRetry');
      const retryCandidates = await collectOcrCandidateTexts(
        pageOcrBytes,
        cachePath,
        options?.easyocrModelDir,
        activeHint,
        'wideTableRetry',
        'full',
        { timer, fullPageLapId: 'ocr_wide_retry' },
      );
      candidates = mergeCandidateLists(candidates, retryCandidates);
      layout = inferLabelLayoutFromText(candidates);
    } else if (shouldRetryWideTableOcr(activeHint, layout) && geometryStep4Ok) {
      appendImportJobDebug('geometry: skip wideTableRetry — variety-pack steps 1–4 OK');
    }
  }

  if (splitLabel && (layout.kind === 'single' || splitSkipsFullPageEasy || candidates.length === 0)) {
    candidates = mergeCandidateLists(splitLabel.candidates, candidates);
    layout = inferLabelLayoutFromText(candidates);
  }

  let varietyPackExpectedColumns: number | undefined;
  let structuredTableCandidateIndex: number | undefined;
  const runStructuredOcr = skipFullPageForSharedRail || shouldRunColumnStripOcr(activeHint, layout);
  if (runStructuredOcr) {
    const structuredStageId = skipFullPageForSharedRail ? 'ocr_shared_rail' : 'ocr_column_strips';
    const stitched = varietyPackPreflight
      ? await ocrStitchedFromVarietyPackPipeline(
          geometryBytes,
          varietyPackPreflight,
          cachePath,
          options?.easyocrModelDir,
          activeHint,
        )
      : await ocrAndStitchColumnStrips(geometryBytes, cachePath, options?.easyocrModelDir, activeHint);
    if (stitched) {
      timer.lap(structuredStageId, `${stitched.expectedColumns} product column(s)`);
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
  timer.lap('parse_select', layout.kind);
  const textIdx = pickImportTextCandidateIndex(candidates, layout, {
    varietyPackExpectedColumns,
    structuredTableCandidateIndex,
  });
  const text = candidates[textIdx] ?? candidates[0] ?? '';
  reportImportJobStep('Draft', 'Building your draft…', 'Combining structured import fields.');
  const pipelineStages = timer.finish('total', layout.kind);
  return { text, slotMergedNutrients, varietyPackExpectedColumns, pipelineStages };
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
  timer?: OcrPipelineTimer;
  /** Aggregate lap for full-page passes (initial vs wide retry). */
  fullPageLapId?: 'ocr_full_page' | 'ocr_wide_retry';
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
  if (mode === 'columnStrip' && allowEasyOcr !== true && process.env.EASYOCR_COLUMN_STRIPS !== '1') return false;
  return true;
}

const SUBROW_SLOTS: Record<string, LabelSlotKey[]> = {
  'carbs<sugar+fiber': ['carbs', 'sugar', 'fiber'],
  'fat<saturated_fat': ['fat', 'saturated_fat'],
};

/** EasyOCR on a stack of only the contested rows (cropped from the Tess images where each row was found). */
async function rereadContestedRows(
  readiness: CoreMacroReadiness,
  images: Buffer[],
  linesPerRun: TesseractLineBox[][],
  psmCount: number,
  modelDir: string,
): Promise<string[]> {
  const slots = new Set<LabelSlotKey>(readiness.contested);
  for (const rule of readiness.inconsistent) for (const slot of SUBROW_SLOTS[rule] ?? []) slots.add(slot);
  const rows: Array<{ image: Buffer; rect: { left: number; top: number; width: number; height: number } }> = [];
  for (const slot of slots) {
    for (let run = 0; run < linesPerRun.length; run += 1) {
      const line = findSlotRowLine(linesPerRun[run] ?? [], slot);
      const image = images[Math.floor(run / Math.max(1, psmCount))];
      if (!line || !image) continue;
      const meta = await sharp(image).metadata();
      const rect = rowCropRect(line.bbox, meta.width ?? 0, meta.height ?? 0);
      if (!rect) continue;
      rows.push({ image, rect });
      break;
    }
  }
  appendImportJobDebug(`ocr progressive: row re-read ${[...slots].join(', ')} — ${rows.length} row crop(s)`);
  if (rows.length === 0) return [];
  const stacked = await buildStackedRowCrops(rows);
  return stacked ? extractEasyOcrTextsFromVariants([stacked], modelDir) : [];
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
  const portraitSingle = mode === 'full' && portraitSingleOcrEnabled() && isPortraitSingleOcrHint(hint);
  const portraitPanel = !hint.widePanel && hint.height > 0 && hint.height / Math.max(hint.width, 1) > 1.1;
  const variantOptions: BuildOcrVariantOptions = {
    profile,
    preserveFullWidthFocus: hint.widePanel || profile !== 'default',
    skipFocusCrops: (portraitPanel || portraitSingle) && mode === 'full',
    portraitSingle,
  };
  const variants =
    mode === 'rowBand'
      ? await buildRowBandOcrVariants(bytes)
      : mode === 'columnStrip'
        ? await buildColumnStripOcrVariants(bytes)
        : await buildOcrImageVariants(bytes, variantOptions);

  appendImportJobDebug(
    `ocr ${mode}: ${variants.length} variant(s) for profile ${profile}${portraitSingle ? ' portrait-single' : ''}`,
  );
  const timer = options?.timer;
  const fullPageLapId = options?.fullPageLapId;
  const passStartedAt = Date.now();
  timer?.lap('ocr_preprocess', `${variants.length} image(s), ${profile}`);

  const stripLike = mode === 'columnStrip' || mode === 'rowBand';
  const cap = stripLike ? { tess: 0, easy: 1 } : variantCapBoost(profile);
  const tessExtra =
    mode === 'rowBand' ? 1 : mode === 'columnStrip' ? columnStripTesseractVariantCount() : cap.tess;
  const forTesseract = portraitSingle
    ? variants.slice(0, PORTRAIT_SINGLE_TESS_VARIANT_CAP)
    : tesseractVariantSubset(variants, tessExtra);
  const easyAllowed = Boolean(modelDir) && easyOcrAllowedForMode(mode, options?.allowEasyOcr);
  const runTesseract = (): Promise<string[]> =>
    forTesseract.length > 0
      ? collectTesseractCandidateTexts(forTesseract, cachePath, `${mode}-${profile}`, options?.tessWorker)
      : Promise.resolve([]);

  const seen = new Set<string>();
  const out: string[] = [];

  if (!portraitSingle) {
    const forEasyOcr = easyAllowed ? easyOcrVariantSubset(variants, cap.easy) : [];
    const [easyTexts, tessTexts] = await Promise.all([
      forEasyOcr.length > 0 ? extractEasyOcrTextsFromVariants(forEasyOcr, modelDir!) : Promise.resolve([]),
      runTesseract(),
    ]);
    timer?.lap('ocr_engines', `Tess ${forTesseract.length} ∥ Easy ${forEasyOcr.length} image(s)`);
    mergeUniqueCandidates(seen, out, easyTexts);
    mergeUniqueCandidates(seen, out, tessTexts);
  } else {
    // Phase A: Tesseract (with line boxes). Phase B: Easy on contested rows only. Phase C: full-page Easy.
    const psmModes = tesseractPsmModes();
    const label = `${mode}-${profile}`;
    const batch =
      forTesseract.length === 0
        ? { texts: [] as string[], lines: [] as TesseractLineBox[][] }
        : options?.tessWorker
          ? await recognizeImagesOnWorker(options.tessWorker, forTesseract, psmModes, label, { withLines: true })
          : await recognizeTesseractBatch(forTesseract, cachePath, psmModes, label, { withLines: true });
    mergeUniqueCandidates(seen, out, batch.texts);
    timer?.lap('ocr_tesseract', `${forTesseract.length} image(s)`);
    if (easyAllowed) {
      let readiness = assessCoreMacroReadiness(out);
      const diverse = out.filter((t) => t.trim()).length;
      let easyCount = 0;
      if (readiness.settled && diverse >= 2) {
        appendImportJobDebug(`ocr progressive: skip Easy — core macros settled across ${diverse} Tess candidates`);
      } else if (readiness.missing.length > 0 || diverse < 2) {
        easyCount = PORTRAIT_SINGLE_EASY_VARIANT_CAP;
        appendImportJobDebug(
          `ocr progressive: Easy ×${easyCount} — missing ${readiness.missing.join(', ') || '—'} (${diverse} Tess candidates)`,
        );
      } else {
        const rowTexts = await rereadContestedRows(readiness, forTesseract, batch.lines ?? [], psmModes.length, modelDir!);
        timer?.lap('ocr_row_reread', `${rowTexts.length} row text(s)`);
        mergeUniqueCandidates(seen, out, rowTexts);
        readiness = assessCoreMacroReadiness(out);
        if (readiness.settled) {
          appendImportJobDebug('ocr progressive: contested rows settled by row re-read — skip full-page Easy');
        } else {
          easyCount = PORTRAIT_SINGLE_EASY_TIEBREAK_CAP;
          appendImportJobDebug(
            `ocr progressive: Easy ×${easyCount} tie-break — contested ${readiness.contested.join(', ') || '—'}; inconsistent ${readiness.inconsistent.join(', ') || '—'}`,
          );
        }
      }
      const forEasyOcr = easyOcrVariantSubset(variants).slice(0, easyCount);
      if (forEasyOcr.length > 0) {
        mergeUniqueCandidates(seen, out, await extractEasyOcrTextsFromVariants(forEasyOcr, modelDir!));
        timer?.lap('ocr_easy', `${forEasyOcr.length} image(s)`);
      }
    }
  }

  if (out.length === 0) out.push('');

  if (timer && fullPageLapId && mode === 'full') {
    timer.lap(fullPageLapId, `${((Date.now() - passStartedAt) / 1000).toFixed(1)}s total pass`);
  }
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
  headerColumnTexts: string[];
  valueTexts: string[];
  usedRowBand: boolean;
  rowBandSliceTexts?: {
    labelSlices: string[];
    valueSlices: string[][];
  };
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

  const rowSurfacesForColumn = (
    sliceList: SharedLabelRowBandSlice[] | undefined,
    kind: string,
    index?: number,
  ): SharedLabelRowBandSlice[] => {
    if (sliceList && sliceList.length > 0) return sliceList;
    if (plan.rowSurfaceMode === 'shared' && plan.rowBandSlices.length > 0) return plan.rowBandSlices;
    appendImportJobDebug(
      `shared-label grid: missing row surfaces for ${kind}${index === undefined ? '' : ` ${index + 1}`}`,
    );
    return plan.rowBandSlices;
  };

  const ocrColumnByRowBandsWithWorker = async (
    worker: Awaited<ReturnType<typeof openTesseractWorker>>,
    column: Pick<ColumnStripRegion, 'left' | 'width'>,
    fallbackPng: Buffer,
    rowBandSlices: SharedLabelValueGridPlan['rowBandSlices'],
    label: string,
    psmModes: PSM[],
  ): Promise<{ text: string; sliceTexts: string[] }> => {
    const minSize = rowBandMinExtractSize(plan, column.width, fullImageWidth);
    appendImportJobDebug(
      `${label} row-band: min extract ${minSize.minWidthPx}×${minSize.minHeightPx}px (column ${column.width}px, ${rowBandSlices.length} slices)`,
    );
    const slicePngs = await extractSharedLabelColumnPngsByRowBands(bytes, column, rowBandSlices, minSize);
    if (slicePngs.length === 0) {
      const text = await ocrStripText(fallbackPng, `${label} body`);
      return { text, sliceTexts: [] };
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
    const sliceTexts = texts.map((line) => line.trim());
    const text = sliceTexts.filter(Boolean).join('\n');
    return { text, sliceTexts };
  };

  let labelText: string;
  let headerText: string;
  const headerColumnTexts: string[] = [];
  const valueTexts: string[] = [];
  let rowBandSliceTexts: SharedLabelColumnTexts['rowBandSliceTexts'];
  if (rowBandOcr) {
    const worker = await openTesseractWorker(cachePath, 'shared-label-grid');
    try {
      const labelRowSlices = rowSurfacesForColumn(plan.labelRowBandSlices, 'label');
      const valueSliceCounts = plan.valueRowBandSlicesPerColumn.map((s) => s.length).join(',');
      appendImportJobDebug(
        `shared-label grid: row surfaces mode=${plan.rowSurfaceMode}, label ${labelRowSlices.length} rows, values [${valueSliceCounts}], one worker`,
      );
      const labelBand = await ocrColumnByRowBandsWithWorker(
        worker,
        plan.labelColumn,
        crops.labelColumn,
        labelRowSlices,
        'label',
        tesseractRowBandLabelPsmModes(),
      );
      labelText = labelBand.text;
      const labelSlices = labelBand.sliceTexts;
      const valueSlices: string[][] = [];
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
      appendImportJobDebug(
        `shared-label grid: reading header stacks (${plan.valueColumns.length} product columns)`,
      );
      for (let index = 0; index < plan.valueColumns.length; index += 1) {
        const headerColText = await ocrStripText(
          crops.headerColumns[index]!,
          `header column ${index + 1}`,
          'columnStrip',
        );
        headerColumnTexts.push(headerColText);
        appendImportJobDebug(
          `shared-label grid: header column ${index + 1}/${plan.valueColumns.length} OCR ${headerColText.trim().length} chars`,
        );
      }
      for (let index = 0; index < plan.valueColumns.length; index += 1) {
        const col = plan.valueColumns[index]!;
        appendImportJobDebug(`shared-label grid value ${index + 1}/${plan.valueColumns.length}`);
        const valueRowSlices = rowSurfacesForColumn(plan.valueRowBandSlicesPerColumn[index], 'value', index);
        const band = await ocrColumnByRowBandsWithWorker(
          worker,
          col,
          crops.valueColumns[index]!,
          valueRowSlices,
          `value ${index + 1}`,
          tesseractRowBandValuePsmModes(),
        );
        valueTexts.push(band.text);
        valueSlices.push(band.sliceTexts);
      }
      if (labelSlices.length > 0 && valueSlices.length >= 2) {
        rowBandSliceTexts = { labelSlices, valueSlices };
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
      appendImportJobDebug(
        `shared-label grid: reading header stacks (${plan.valueColumns.length} product columns)`,
      );
      for (let index = 0; index < plan.valueColumns.length; index += 1) {
        const headerColText = await ocrBodyColumn(crops.headerColumns[index]!, `header column ${index + 1}`);
        headerColumnTexts.push(headerColText);
        appendImportJobDebug(
          `shared-label grid: header column ${index + 1}/${plan.valueColumns.length} OCR ${headerColText.trim().length} chars`,
        );
      }
      for (let index = 0; index < plan.valueColumns.length; index += 1) {
        appendImportJobDebug(`shared-label grid value ${index + 1}/${plan.valueColumns.length}`);
        valueTexts.push(await ocrBodyColumn(crops.valueColumns[index]!, `value ${index + 1} body`));
      }
    } finally {
      await worker.terminate();
    }
  }

  return { labelText, headerText, headerColumnTexts, valueTexts, usedRowBand: rowBandOcr, rowBandSliceTexts };
}

function stitchOptionsFromColumns(
  headerColumnTexts: string[],
  valueColumnTexts?: string[],
): SharedLabelStitchOptions | undefined {
  if (headerColumnTexts.length === 0 && !valueColumnTexts?.length) return undefined;
  return { headerColumnTexts, valueColumnTexts };
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
    `shared-label grid: body ${plan.nutrientBodyHeight}px @ y=${plan.nutrientBodyTop}, labelSlices=${plan.labelRowBandSlices?.length ?? plan.rowBandSlices.length}, consensus=${plan.rowBandSlices.length}, rowPitch=${plan.rowPitchPx}px, rowOcr=${rowBandOcr}`,
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
  let { labelText, headerText, headerColumnTexts, valueTexts } = columnTexts;
  const stitchOpts = stitchOptionsFromColumns(headerColumnTexts, valueTexts);
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

  const stitchFromRowBands =
    columnTexts.usedRowBand && columnTexts.rowBandSliceTexts != null
      ? stitchSharedLabelGridFromRowBandSlices(
          columnTexts.rowBandSliceTexts.labelSlices,
          columnTexts.rowBandSliceTexts.valueSlices,
          headerText,
          stitchOpts,
        )
      : null;
  let stitched =
    stitchFromRowBands ?? stitchSharedLabelGridTexts(labelText, valueTexts, headerText, stitchOpts);
  if (stitchFromRowBands) {
    appendImportJobDebug('shared-label grid: stitch used row-band slice alignment');
  }
  let parsed = stitched ? parseMultiProductLabelTable(stitched) : null;
  let macroCount = countSharedLabelMacroColumns(parsed);

  const rowBandRetry = assessSharedLabelRowBandOcrRetry(stitched, parsed);
  if (columnTexts.usedRowBand && rowBandRetry.shouldRetryBodyColumn) {
    const retryDetail =
      rowBandRetry.reason === 'calories_row_cells_not_numeric'
        ? 'Calories row does not look like kcal amounts.'
        : rowBandRetry.reason === 'no_columns_with_calories'
          ? 'Parsed columns but no plausible calorie values.'
          : 'Row-band pass did not yield enough macros.';
    reportImportJobStep('OCR', 'Retrying with full-column OCR…', retryDetail);
    appendImportJobDebug(
      `shared-label grid: row-band weak macros (${rowBandRetry.reason ?? 'unknown'}, plausibleCalories=${rowBandRetry.caloriesNumericColumnCount}) — fallback to body-column OCR`,
    );
    columnTexts = await ocrSharedLabelGridColumns(bytes, plan, crops, cachePath, modelDir, hint, false);
    labelText = columnTexts.labelText;
    headerText = columnTexts.headerText;
    headerColumnTexts = columnTexts.headerColumnTexts;
    const separatedFallback = separateSharedLabelValueTexts(labelText, columnTexts.valueTexts);
    if (separatedFallback.droppedIndexes.length > 0) {
      appendImportJobDebug(
        `shared-label grid: dropped value column OCR at index [${separatedFallback.droppedIndexes.join(', ')}] — label rail text in value strip`,
      );
    }
    valueTexts = separatedFallback.valueColumnTexts;
    stitched = stitchSharedLabelGridTexts(
      labelText,
      valueTexts,
      headerText,
      stitchOptionsFromColumns(headerColumnTexts, valueTexts),
    );
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

/** Core macros a split-label read may miss and still skip full-page EasyOCR. */
const SPLIT_LABEL_MAX_MISSING_CORE_FOR_EASY_SKIP = 2;
/** Core macros a split-label read may miss and still skip full-page OCR (it reads rows across the split). */
const SPLIT_LABEL_MAX_MISSING_CORE_FOR_PAGE_SKIP = 1;

async function readSplitHalfWithTesseract(half: Buffer, cachePath: string, side: string): Promise<string[]> {
  const variants = await buildDewarpedStripOcrVariants(half);
  const batch = await recognizeTesseractBatch(variants, cachePath, [PSM.SINGLE_BLOCK], `split-${side}`);
  return batch.texts;
}

function stitchSplitHalfCandidates(leftTexts: string[], rightTexts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (stitched: string | null) => {
    const text = stitched ? appendDailyValueInferredRows(stitched) : null;
    if (text && !seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
  };
  const pairs = Math.min(leftTexts.length, rightTexts.length);
  for (let i = 0; i < pairs; i += 1) push(stitchSplitLabelHalves(leftTexts[i]!, rightTexts[i]!));
  if (leftTexts.length > 0 && rightTexts.length > 0) {
    push(stitchSplitLabelHalves(pickBestStripCandidate(leftTexts), pickBestStripCandidate(rightTexts)));
  }
  return out;
}

/**
 * One panel photographed as two side-by-side halves (curved tub). Each half is dewarped so its
 * row rules run straight, read with Tesseract on cheap variants, and EasyOCR runs on the
 * dewarped halves only when the stitched Tesseract reads leave core macros missing or contested.
 */
async function ocrSplitSingleLabel(
  bytes: Buffer,
  cachePath: string,
  modelDir: string | undefined,
  hint: Awaited<ReturnType<typeof inferLabelLayoutHint>>,
): Promise<{ candidates: string[]; readiness: CoreMacroReadiness } | null> {
  const plan = await detectSplitSingleLabel(bytes, hint);
  if (!plan) {
    appendImportJobDebug('split-single-label: detect returned null');
    return null;
  }
  appendImportJobDebug(
    `split-single-label: two halves ${plan.strips[0]!.width}px + ${plan.strips[1]!.width}px`,
  );
  const halves = await extractSplitSingleLabelBuffers(plan);
  const dewarped = await Promise.all(halves.map((half) => dewarpCurvedLabelRules(half)));
  appendImportJobDebug(
    `split-single-label: dewarp ${dewarped
      .map((d) => `${d.applied ? 'on' : 'off'} (${d.rules.length} rules, spread ${d.maxSpreadPx.toFixed(1)}px)`)
      .join(' / ')}`,
  );
  const leftTexts = await readSplitHalfWithTesseract(dewarped[0]!.bytes, cachePath, 'left');
  const rightTexts = await readSplitHalfWithTesseract(dewarped[1]!.bytes, cachePath, 'right');
  const candidates = stitchSplitHalfCandidates(leftTexts, rightTexts);
  let readiness = assessCoreMacroReadiness(candidates);
  appendImportJobDebug(
    `split-single-label: Tess ${candidates.length} stitched candidate(s); missing ${readiness.missing.join(', ') || '—'}; contested ${readiness.contested.join(', ') || '—'}`,
  );

  if (!readiness.settled && modelDir) {
    const [leftEasy, rightEasy] = await Promise.all(
      dewarped.map((d) => extractEasyOcrTextsFromVariants([d.bytes], modelDir, 'rows')),
    );
    for (const text of stitchSplitHalfCandidates([...leftEasy, ...leftTexts], [...rightEasy, ...rightTexts])) {
      if (!candidates.includes(text)) candidates.unshift(text);
    }
    readiness = assessCoreMacroReadiness(candidates);
    appendImportJobDebug(
      `split-single-label: + Easy on dewarped halves; missing ${readiness.missing.join(', ') || '—'}; contested ${readiness.contested.join(', ') || '—'}`,
    );
  }

  if (candidates.length === 0) {
    appendImportJobDebug('split-single-label: stitch returned null');
    return null;
  }
  appendImportJobDebug('split-single-label: stitch OK');
  return { candidates, readiness };
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
