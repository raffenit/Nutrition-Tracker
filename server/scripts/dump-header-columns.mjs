/**
 * Per-product header stack crops + OCR (display calories live here).
 * Usage: npm run build && node scripts/dump-header-columns.mjs [jpg]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PSM } from 'tesseract.js';
import { runVarietyPackGridPipeline } from '../dist/integrations/varietyPackGridPipeline.js';
import { extractSharedLabelGridBuffers } from '../dist/integrations/sharedLabelValueGrid.js';
import { buildColumnStripOcrVariants } from '../dist/integrations/ocrPreprocess.js';
import { recognizeTesseractBatch } from '../dist/integrations/tesseractOcr.js';
import { pickPlausibleCalorieFromHeaderColumnOcr } from '../dist/domain/sharedLabelHeaderCalories.js';
import { looksLikePlausibleCalorieCell } from '../dist/domain/sharedLabelGridStageReport.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imagePath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'local/test-images/costco-candy.jpg'));
const outDir = path.join(repoRoot, 'local/diagnostics/header-columns');
const cachePath = os.tmpdir();

async function ocrHeaderColumn(png, label) {
  const variants = await buildColumnStripOcrVariants(png);
  const { texts } = await recognizeTesseractBatch(
    variants.slice(0, 2),
    cachePath,
    [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN],
    label,
  );
  const joined = texts.filter(Boolean).join('\n').trim();
  return joined || (texts[0] ?? '');
}

const bytes = await readFile(imagePath);
const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
const plan = pipeline.plan;
if (!plan) {
  console.error('No shared-rail plan');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const crops = await extractSharedLabelGridBuffers(bytes, plan);

console.log('geometry:');
console.log('  headerBand', plan.headerBand);
console.log('  nutrientBodyTop', plan.nutrientBodyTop, 'bodyHeight', plan.nutrientBodyHeight);
console.log('  valueColumns', plan.valueColumns.length);
console.log('---');

for (let i = 0; i < crops.headerColumns.length; i += 1) {
  const id = String(i + 1).padStart(2, '0');
  await writeFile(path.join(outDir, `header-col-${id}.png`), crops.headerColumns[i]);
  const text = await ocrHeaderColumn(crops.headerColumns[i], `header-col-${id}`);
  const cal = pickPlausibleCalorieFromHeaderColumnOcr(text);
  const plausible = looksLikePlausibleCalorieCell(cal);
  console.log(`column ${i + 1}:`);
  console.log(`  crop ${plan.valueColumns[i].width}×${plan.headerBand.height}px @ left=${plan.valueColumns[i].left}`);
  console.log(`  pickedCalorie: ${JSON.stringify(cal)} plausible=${plausible}`);
  console.log('  ocr:');
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (t) console.log(`    | ${t}`);
  }
  console.log('');
}