/**
 * Variety-pack grid: gated steps 1–4, then OCR + stitch on success.
 * Usage: npm run build && node scripts/diagnose-shared-label-grid.mjs [path-to.jpg]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PSM } from 'tesseract.js';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
} from '../dist/integrations/varietyPackGridPipeline.js';
import {
  extractSharedLabelColumnPngsByRowBands,
  extractSharedLabelGridBuffers,
  useRowBandSliceOcrForPlan,
} from '../dist/integrations/sharedLabelValueGrid.js';
import { buildColumnStripOcrVariants } from '../dist/integrations/ocrPreprocess.js';
import { recognizeTesseractBatch } from '../dist/integrations/tesseractOcr.js';
import {
  diagnoseSharedLabelGridStitch,
  stitchSharedLabelGridTexts,
} from '../dist/domain/stitchSharedLabelGridTexts.js';
import { separateSharedLabelValueTexts } from '../dist/domain/sharedLabelColumnSeparation.js';
import { analyzeSharedLabelGridStageReport } from '../dist/domain/sharedLabelGridStageReport.js';
import { parseMultiProductLabelTable } from '../dist/domain/parseMultiProductLabelTable.js';
import { scoreLabelExtraction } from '../dist/domain/labelSlots.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Default: gitignored shared-label multi-value fixture (see docs/label-table-terminology.md). */
const defaultImage = path.join(repoRoot, 'local/test-images/costco-candy.jpg');
const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultImage;
const outDir = path.join(repoRoot, 'local/diagnostics/shared-label-grid');
const cachePath = os.tmpdir();

async function ocrCrop(png, label) {
  const variants = await buildColumnStripOcrVariants(png);
  const { texts } = await recognizeTesseractBatch(
    variants.slice(0, 3),
    cachePath,
    [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN],
    label,
  );
  let best = texts[0] ?? '';
  let bestScore = scoreLabelExtraction(best);
  for (const t of texts.slice(1)) {
    const s = scoreLabelExtraction(t);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return { text: best, score: bestScore, variantCount: variants.length };
}

function serializeStep(stepResult) {
  return {
    ok: stepResult.validation.ok,
    summary: formatVarietyPackStepValidation(stepResult.validation),
    validation: stepResult.validation,
    data: stepResult.data,
  };
}

const bytes = await readFile(imagePath);
console.log('image:', imagePath);
await mkdir(outDir, { recursive: true });

const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
const stepReport = {};
for (const n of [1, 2, 3, 4]) {
  const result = pipeline.steps[n];
  stepReport[`step${n}`] = serializeStep(result);
  const file = path.join(outDir, `step-${n}.json`);
  await writeFile(file, JSON.stringify(stepReport[`step${n}`], null, 2));
  console.log(formatVarietyPackStepValidation(result.validation));
  if (!result.validation.ok) {
    console.error(`Stopped after step ${n}; see ${file}`);
    await writeFile(path.join(outDir, 'report.json'), JSON.stringify({ imagePath, stoppedAtStep: n, ...stepReport }, null, 2));
    process.exit(1);
  }
}

const plan = pipeline.plan;
if (!plan) {
  console.error('All steps passed but shared_rail OCR plan is null (e.g. per_column_labels layout).');
  process.exit(1);
}

const rowBandOcr = useRowBandSliceOcrForPlan(plan);
console.log(
  'plan: label width',
  plan.labelColumn.width,
  'value columns',
  plan.valueColumns.length,
  'body top',
  plan.nutrientBodyTop,
  'body h',
  plan.nutrientBodyHeight,
  'row slices',
  plan.rowBandSlices.length,
  'rowOcr',
  rowBandOcr,
);

const crops = await extractSharedLabelGridBuffers(bytes, plan);
await writeFile(path.join(outDir, 'label-column.png'), crops.labelColumn);
await writeFile(path.join(outDir, 'header-band.png'), crops.headerBand);
for (let i = 0; i < crops.valueColumns.length; i += 1) {
  await writeFile(path.join(outDir, `value-${String(i + 1).padStart(2, '0')}.png`), crops.valueColumns[i]);
}

async function ocrColumnByRowBands(column, fallbackPng, name, rowBandSlices) {
  const slices = rowBandSlices?.length ? rowBandSlices : plan.rowBandSlices;
  const slicePngs = await extractSharedLabelColumnPngsByRowBands(bytes, column, slices);
  if (slicePngs.length === 0) {
    return ocrCrop(fallbackPng, `${name}-body`);
  }
  const lines = [];
  for (let i = 0; i < slicePngs.length; i += 1) {
    await writeFile(path.join(outDir, `${name}-row-${String(i + 1).padStart(2, '0')}.png`), slicePngs[i]);
    lines.push((await ocrCrop(slicePngs[i], `${name}-row-${i + 1}`)).text.trim());
  }
  const text = lines.filter(Boolean).join('\n');
  return { text, score: scoreLabelExtraction(text), variantCount: slicePngs.length };
}

const headerOcr = await ocrCrop(crops.headerBand, 'diag-header');
const labelOcr = rowBandOcr
  ? await ocrColumnByRowBands(plan.labelColumn, crops.labelColumn, 'diag-label', plan.labelRowBandSlices)
  : await ocrCrop(crops.labelColumn, 'diag-label');
const valueOcrs = [];
for (let i = 0; i < plan.valueColumns.length; i += 1) {
  const col = plan.valueColumns[i];
  valueOcrs.push(
    rowBandOcr
      ? await ocrColumnByRowBands(
          col,
          crops.valueColumns[i],
          `diag-value-${i + 1}`,
          plan.valueRowBandSlicesPerColumn[i],
        )
      : await ocrCrop(crops.valueColumns[i], `diag-value-${i + 1}`),
  );
}

const stitched = stitchSharedLabelGridTexts(labelOcr.text, productValueTexts, headerOcr.text);
const diag = diagnoseSharedLabelGridStitch(labelOcr.text, productValueTexts, headerOcr.text);
const parsed = stitched ? parseMultiProductLabelTable(stitched) : null;
const rawValueTexts = valueOcrs.map((v) => v.text);
const { valueColumnTexts: productValueTexts, droppedIndexes: labelBleedDropped } =
  separateSharedLabelValueTexts(labelOcr.text, rawValueTexts);
const stageReport = analyzeSharedLabelGridStageReport(
  labelOcr.text,
  productValueTexts,
  headerOcr.text,
);

const report = {
  imagePath,
  lastOkStep: pipeline.lastOkStep,
  steps: stepReport,
  plan: {
    labelWidthPx: plan.labelColumn.width,
    valueColumnCount: plan.valueColumns.length,
    headerHeightPx: plan.headerBand.height,
    nutrientBodyTopPx: plan.nutrientBodyTop,
    nutrientBodyHeightPx: plan.nutrientBodyHeight,
    rowBandSliceCount: plan.rowBandSlices.length,
    rowBandOcr,
  },
  ocr: {
    label: { score: labelOcr.score, chars: labelOcr.text.length, preview: labelOcr.text.slice(0, 400) },
    header: { score: headerOcr.score, chars: headerOcr.text.length, preview: headerOcr.text.slice(0, 400) },
    values: valueOcrs.map((v, i) => ({
      col: i + 1,
      widthPx: plan.valueColumns[i]?.width,
      score: v.score,
      chars: v.text.length,
      preview: v.text.slice(0, 120),
    })),
  },
  stitch: { ...diag, parsedCount: parsed?.length ?? 0, stitchedPreview: stitched?.slice(0, 800) ?? null },
  stageReport: {
    rowLabels: stageReport.rowLabels,
    valueLineCounts: stageReport.valueLineCounts,
    macroImportBlocker: stageReport.macroImportBlocker,
    calorieColumnCount: stageReport.calorieColumnCount,
    macroColumnCount: stageReport.macroColumnCount,
  },
  labelBleedDropped,
};

await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
