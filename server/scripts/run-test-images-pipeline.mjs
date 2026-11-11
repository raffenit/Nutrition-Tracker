/**
 * Summarize gated variety-pack pipeline for each local test image.
 * Usage: npm run build && node scripts/run-test-images-pipeline.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
  detectSharedLabelValueGrid,
} from '../dist/integrations/varietyPackGridPipeline.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(repoRoot, 'local/test-images');

const names = (await readdir(imageDir)).filter((n) => /\.(jpe?g|png)$/i.test(n)).sort();

for (const name of names) {
  const imagePath = path.join(imageDir, name);
  const bytes = await readFile(imagePath);
  const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
  console.log('\n===', name, '===');
  for (const step of [1, 2, 3, 4]) {
    console.log(formatVarietyPackStepValidation(pipeline.steps[step].validation));
  }
  const plan = await detectSharedLabelValueGrid(bytes, { maxColumns: 14 });
  console.log(
    `plan: ${plan ? `label ${plan.labelColumn.width}px, header ${plan.headerBand.height}px, values ${plan.valueColumns.length}` : 'null'}`,
  );
}
