/**
 * Full extractImageLabel + import build on local/test-images/*.jpg
 * Usage: npm run build && node scripts/run-local-test-images-ocr.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractImageLabel } from '../dist/integrations/extractText.js';
import { inferLabelLayoutHint } from '../dist/integrations/imageLayoutHint.js';
import { buildNutritionImportWithPanels } from '../dist/domain/nutritionImport.js';
import { parseMultiProductLabelTable } from '../dist/domain/parseMultiProductLabelTable.js';
import { inferLabelLayoutFromText } from '../dist/domain/labelLayout.js';
import { parseNutritionLabel } from '../dist/domain/parseLabel.js';
import {
  getImportJobForUser,
  newImportJobId,
  runWithImportJob,
} from '../dist/import/importJobProgress.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(repoRoot, 'local/test-images');
const dataDir = path.join(repoRoot, 'data');
const tessCache = path.join(dataDir, 'tesseract-cache');
const easyocrModelDir = path.join(dataDir, 'easyocr-models');

const names = (await readdir(imageDir))
  .filter((f) => /\.jpe?g$/i.test(f))
  .sort();

function summarizeNutrients(parsed) {
  if (!parsed) return null;
  const keys = ['calories', 'totalFatG', 'saturatedFatG', 'sodiumMg', 'totalCarbohydrateG', 'proteinG'];
  const out = {};
  for (const k of keys) {
    const v = parsed[k];
    if (v != null && v !== '') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

for (const name of names) {
  const bytes = await readFile(path.join(imageDir, name));
  const hint = await inferLabelLayoutHint(bytes);
  console.log(`\n${'='.repeat(72)}\n${name}`);
  console.log(
    `hint: widePanel=${hint.widePanel} singleSubjectInFocus=${hint.singleSubjectInFocus} ${hint.width}x${hint.height}`,
  );

  const t0 = Date.now();
  const jobId = newImportJobId();
  let result;
  try {
    result = await runWithImportJob(jobId, 'local-ocr-script', 'image', () =>
      extractImageLabel(bytes, tessCache, { easyocrModelDir }),
    );
  } catch (err) {
    console.error('extractImageLabel failed:', err);
    continue;
  }
  const job = getImportJobForUser(jobId, 'local-ocr-script');
  const debug = job?.debugLog ?? [];
  const trail = debug.filter((l) =>
    /shared-label|variety grid|column-strip|stitch|split-single|ocr preprocess/i.test(l),
  );
  if (trail.length) {
    console.log('pipeline debug:');
    for (const line of trail.slice(0, 30)) console.log(`  ${line}`);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`OCR elapsed: ${elapsed}s, primary text length: ${result.text.length}`);

  const layout = inferLabelLayoutFromText([result.text]);
  console.log(`layout from text: kind=${layout.kind}${layout.productCount != null ? ` productCount=${layout.productCount}` : ''}`);

  const tableCols = parseMultiProductLabelTable(result.text);
  console.log(`multi-product table columns: ${tableCols?.length ?? 0}`);

  const built = buildNutritionImportWithPanels(result.text, 'image');
  console.log(
    `import: draft.calories=${built.draft.nutrients.calories ?? '—'} panels=${built.labelPanels.length} warning=${JSON.stringify(built.warning)}`,
  );
  for (const [i, panel] of built.labelPanels.entries()) {
    const nutrients = panel.draft?.nutrients ?? {};
    const pick = {
      calories: nutrients.calories,
      totalFatG: nutrients.totalFatG,
      proteinG: nutrients.proteinG,
      sodiumMg: nutrients.sodiumMg,
    };
    console.log(
      `  panel[${i}] ${panel.preview ?? panel.draft?.name} nutrients=${JSON.stringify(pick)}`,
    );
  }

  const single = parseNutritionLabel(result.text);
  const singleNutrients = summarizeNutrients(single);
  if (singleNutrients) console.log(`primary parse nutrients: ${JSON.stringify(singleNutrients)}`);

  const preview = result.text.replace(/\s+/g, ' ').trim();
  console.log(`text preview (${Math.min(400, preview.length)} chars): ${preview.slice(0, 400)}${preview.length > 400 ? '…' : ''}`);
}
