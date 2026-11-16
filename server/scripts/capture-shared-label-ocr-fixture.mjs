/**
 * OCR column texts for shared-label diagnose → JSON fixture for stage-report tests.
 * Usage: npm run build && node scripts/capture-shared-label-ocr-fixture.mjs [image.jpg] [out.json]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PSM } from 'tesseract.js';
import { runVarietyPackGridPipeline } from '../dist/integrations/varietyPackGridPipeline.js';
import {
  extractSharedLabelGridBuffers,
  useRowBandSliceOcrForPlan,
} from '../dist/integrations/sharedLabelValueGrid.js';
import { buildColumnStripOcrVariants } from '../dist/integrations/ocrPreprocess.js';
import { recognizeTesseractBatch } from '../dist/integrations/tesseractOcr.js';
import { scoreLabelExtraction } from '../dist/domain/labelSlots.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultImage = path.join(repoRoot, 'local/test-images/costco-candy.jpg');
const defaultOut = path.join(
  repoRoot,
  'server/src/test/fixtures/costcoCandySharedLabelOcr.snapshot.json',
);
const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultImage;
const outPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOut;

async function ocrCrop(png, label) {
  const variants = await buildColumnStripOcrVariants(png);
  const { texts } = await recognizeTesseractBatch(
    variants.slice(0, 3),
    os.tmpdir(),
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
  return { text: best, score: bestScore };
}

const bytes = await readFile(imagePath);
const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
if (pipeline.lastOkStep < 4 || !pipeline.plan) {
  console.error('Pipeline did not reach step 4 shared-rail plan');
  process.exit(1);
}
const plan = pipeline.plan;
const crops = await extractSharedLabelGridBuffers(bytes, plan);
const rowBandOcr = useRowBandSliceOcrForPlan(plan);
const labelOcr = await ocrCrop(crops.labelColumn, 'fixture-label');
const headerOcr = await ocrCrop(crops.headerBand, 'fixture-header');
const valueOcrs = [];
for (let i = 0; i < crops.valueColumns.length; i += 1) {
  valueOcrs.push(await ocrCrop(crops.valueColumns[i], `fixture-value-${i + 1}`));
}

const snapshot = {
  sourceImage: path.basename(imagePath),
  capturedAt: new Date().toISOString(),
  geometry: {
    lastOkStep: pipeline.lastOkStep,
    valueColumnCount: plan.valueColumns.length,
    rowBandOcr,
    rowBandSliceCount: plan.rowBandSlices.length,
    rowPitchPx: plan.rowPitchPx,
  },
  labelColumnText: labelOcr.text,
  headerBandText: headerOcr.text,
  valueColumnTexts: valueOcrs.map((v) => v.text),
  ocrScores: {
    label: labelOcr.score,
    header: headerOcr.score,
    values: valueOcrs.map((v) => v.score),
  },
};

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log('wrote', outPath, 'label chars', labelOcr.text.length, 'cols', valueOcrs.length);
