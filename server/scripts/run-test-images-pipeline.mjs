/**
 * Summarize gated variety-pack pipeline for each local test image.
 * Compares to local/test-images/manifest.json when present (gitignored).
 * Usage: npm run build && node scripts/run-test-images-pipeline.mjs
 * Exit 1 if any fixture fails ground-truth checks.
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
  detectSharedLabelValueGrid,
} from '../dist/integrations/varietyPackGridPipeline.js';
import { detectSplitSingleLabel } from '../dist/integrations/splitSingleLabel.js';
import { inferLabelLayoutHint } from '../dist/integrations/imageLayoutHint.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(repoRoot, 'local/test-images');
const manifestPath = path.join(imageDir, 'manifest.json');

/** @type {{ version: number, fixtures: object[] } | null} */
let manifest = null;
try {
  await access(manifestPath);
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  console.warn('No manifest at local/test-images/manifest.json — printing results only.');
}

/** @type {Map<string, object>} */
const fixtureByFile = new Map((manifest?.fixtures ?? []).map((f) => [f.file, f]));

let failures = 0;

function fail(message) {
  console.error(`  FAIL: ${message}`);
  failures += 1;
}

function checkFixture(name, pipeline, plan, splitPlan, hint) {
  const fx = fixtureByFile.get(name);
  if (!fx) return;

  console.log(`  ground truth: layout=${fx.layout}${fx.valueColumnCount != null ? `, valueColumns=${fx.valueColumnCount}` : ''}`);

  const vp = fx.varietyPackPipeline;
  if (!vp) return;

  if (vp.expectFailStep && vp.expectFailCode) {
    const step = pipeline.steps[vp.expectFailStep];
    if (step?.validation.ok) {
      fail(`expected step ${vp.expectFailStep} to fail with ${vp.expectFailCode}`);
    } else if (step?.validation.code !== vp.expectFailCode) {
      fail(`expected code ${vp.expectFailCode}, got ${step?.validation.code}`);
    }
    return;
  }

  if (vp.expectLastOkStep != null && pipeline.lastOkStep < vp.expectLastOkStep) {
    fail(`expected lastOkStep >= ${vp.expectLastOkStep}, got ${pipeline.lastOkStep}`);
  }

  const step3Layout = pipeline.steps[3].data?.layout;
  if (vp.forbidLayout && step3Layout === vp.forbidLayout) {
    fail(`step 3 layout must not be ${vp.forbidLayout}`);
  }

  if (vp.expectSharedRailPlan === true && !plan) {
    fail('expected shared-rail OCR plan, got null');
  }
  if (vp.expectSharedRailPlan === false && plan) {
    fail(`expected no shared-rail plan, got ${plan.valueColumns.length} value columns`);
  }

  if (vp.minValueColumns != null && plan && plan.valueColumns.length < vp.minValueColumns) {
    fail(`expected >= ${vp.minValueColumns} value columns, got ${plan.valueColumns.length}`);
  }

  if (fx.splitSingleLabel?.expectDetect && !splitPlan) {
    fail('expected detectSplitSingleLabel to match');
  }
}

const names = [...fixtureByFile.keys()];
if (names.length === 0) {
  const { readdir } = await import('node:fs/promises');
  const all = await readdir(imageDir);
  for (const n of all.filter((f) => /\.(jpe?g|png)$/i.test(f))) names.push(n);
  names.sort();
}

for (const name of names) {
  const imagePath = path.join(imageDir, name);
  let bytes;
  try {
    bytes = await readFile(imagePath);
  } catch {
    console.warn('\n===', name, '===');
    console.warn('  missing file');
    continue;
  }

  const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
  const plan = await detectSharedLabelValueGrid(bytes, { maxColumns: 14 });
  const hint = await inferLabelLayoutHint(bytes);
  const splitPlan = await detectSplitSingleLabel(bytes, hint);

  console.log('\n===', name, '===');
  for (const step of [1, 2, 3, 4]) {
    console.log(formatVarietyPackStepValidation(pipeline.steps[step].validation));
  }
  console.log(
    `plan: ${plan ? `label ${plan.labelColumn.width}px, header ${plan.headerBand.height}px, values ${plan.valueColumns.length}` : 'null'}`,
  );
  if (splitPlan) console.log(`split-single: ${splitPlan.strips.length} strips`);

  checkFixture(name, pipeline, plan, splitPlan, hint);
}

if (failures > 0) {
  console.error(`\n${failures} ground-truth check(s) failed.`);
  process.exit(1);
}
console.log('\nGround truth: all checks passed.');
