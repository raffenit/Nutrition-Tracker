/**
 * Manifest ground truth vs pipeline geometry (+ optional OCR timing).
 * Usage: npm run build && node scripts/sanity-audit-test-images.mjs [--ocr]
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runVarietyPackGridPipeline,
  detectSharedLabelValueGrid,
} from '../dist/integrations/varietyPackGridPipeline.js';
import { useRowBandSliceOcrForPlan } from '../dist/integrations/sharedLabelValueGrid.js';
import { inferLabelLayoutHint } from '../dist/integrations/imageLayoutHint.js';
import { detectSplitSingleLabel } from '../dist/integrations/splitSingleLabel.js';

const withOcr = process.argv.includes('--ocr');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(repoRoot, 'local/test-images');
const manifestPath = path.join(imageDir, 'manifest.json');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let issues = 0;

function issue(msg) {
  console.log(`  ISSUE: ${msg}`);
  issues += 1;
}

console.log('=== Sanity audit (manifest ground truth) ===\n');

for (const fx of manifest.fixtures) {
  const bytes = await readFile(path.join(imageDir, fx.file));
  const hint = await inferLabelLayoutHint(bytes);
  const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
  const plan = await detectSharedLabelValueGrid(bytes, { maxColumns: 14 });
  const split = await detectSplitSingleLabel(bytes, hint);
  const nr = fx.nutrientRows;
  const wantRows = nr.mainSectionRows + nr.secondarySectionRows;

  console.log(`${fx.file}`);
  console.log(
    `  manifest: layout=${fx.layout} cols=${fx.valueColumnCount ?? '—'} rows=${nr.mainSectionRows}+${nr.secondarySectionRows}=${wantRows}`,
  );
  if (nr.notes) console.log(`  note: ${nr.notes}`);

  const vp = fx.varietyPackPipeline;
  if (vp?.expectFailStep) {
    const step = pipeline.steps[vp.expectFailStep];
    if (step?.validation.ok) issue(`expected step ${vp.expectFailStep} fail`);
    else console.log(`  pipeline: step ${vp.expectFailStep} ${step?.validation.code} (expected)`);
  } else {
    console.log(`  pipeline: lastOkStep=${pipeline.lastOkStep} step3=${pipeline.steps[3].data?.layout ?? '—'}`);
  }

  if (fx.layout === 'shared_rail' && plan) {
    const got = plan.rowBandSlices.length;
    const rowOcr = useRowBandSliceOcrForPlan(plan);
    console.log(
      `  plan: valueCols=${plan.valueColumns.length} rowSlices=${got} rowPitch=${plan.rowPitchPx}px rowOcr=${rowOcr}`,
    );
    if (fx.valueColumnCount != null && plan.valueColumns.length !== fx.valueColumnCount) {
      issue(`value columns ${plan.valueColumns.length} !== ${fx.valueColumnCount}`);
    }
    if (got < wantRows - 1 || got > wantRows + 1) {
      issue(`row slices ${got} not within ±1 of ${wantRows}`);
    }
    if (!rowOcr) issue('row-band OCR gate closed');
  }

  if (fx.splitSingleLabel?.expectDetect && !split) issue('split-single not detected');

  if (withOcr && (fx.layout === 'shared_rail' || fx.layout === 'single' || fx.layout === 'split_single')) {
    const { extractImageLabel } = await import('../dist/integrations/extractText.js');
    const { runWithImportJob, newImportJobId, finishImportJob } = await import(
      '../dist/import/importJobProgress.js'
    );
    const tessCache = path.join(repoRoot, 'data/tesseract-cache');
    const easy = path.join(repoRoot, 'data/easyocr-models');
    const t0 = Date.now();
    const jobId = newImportJobId();
    const result = await runWithImportJob(jobId, 'audit', 'image', () =>
      extractImageLabel(bytes, tessCache, { easyocrModelDir: easy }),
    );
    finishImportJob(jobId);
    console.log(`  OCR: ${((Date.now() - t0) / 1000).toFixed(1)}s, textLen=${result.text.length}, expectedCols=${result.varietyPackExpectedColumns ?? '—'}`);
  }
  console.log('');
}

console.log(issues === 0 ? 'Audit: OK' : `Audit: ${issues} issue(s)`);
process.exit(issues > 0 ? 1 : 0);
