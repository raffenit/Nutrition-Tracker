/**
 * Full extractImageLabel + import build on local/test-images/*.jpg
 * Usage: npm run build && node scripts/run-local-test-images-ocr.mjs
 *
 * Live progress: streams the same import steps/messages as the app (Receive → Draft)
 * and pipeline debug lines. Set IMPORT_JOB_CLI_PROGRESS=0 to silence and print debug tail only.
 */
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractImageLabel } from '../dist/integrations/extractText.js';
import { inferLabelLayoutHint } from '../dist/integrations/imageLayoutHint.js';
import { buildNutritionImportWithPanels } from '../dist/domain/nutritionImport.js';
import { applySlotMergedNutrients } from '../dist/domain/nutrients.js';
import { parseMultiProductLabelTable } from '../dist/domain/parseMultiProductLabelTable.js';
import { inferLabelLayoutFromText } from '../dist/domain/labelLayout.js';
import { parseNutritionLabel } from '../dist/domain/parseLabel.js';
import {
  formatVarietyPackStepValidation,
  runVarietyPackGridPipeline,
} from '../dist/integrations/varietyPackGridPipeline.js';
import { detectSplitSingleLabel } from '../dist/integrations/splitSingleLabel.js';
import {
  finishImportJob,
  getImportJobForUser,
  newImportJobId,
  runWithImportJob,
} from '../dist/import/importJobProgress.js';
import {
  formatImportJobSnapshotBlock,
  startImportJobConsoleWatch,
  stopImportJobConsoleWatch,
} from '../dist/import/importJobCliProgress.js';
import { loadGlareGroundTruthForImage } from '../dist/domain/sharedLabelGlareGroundTruth.js';
import { loadLabelNutrientGroundTruthForImage } from '../dist/domain/labelNutrientGroundTruth.js';
import {
  compareLabelProductsToGroundTruth,
  ocrPerformanceReportTitle,
  renderGroundTruthCompareHtml,
  resolveParsedProductsFromOcrText,
  inferNutrientRowSpecs,
} from '../dist/domain/labelNutrientGroundTruthCompare.js';
import {
  evaluateNutrientGroundTruthRegression,
  formatGroundTruthScoreLine,
  groundTruthPercentOk,
} from '../dist/domain/labelNutrientGroundTruthRegression.js';
import { groundTruthCompareHtmlDirWorkspace } from '../dist/domain/groundTruthComparePaths.js';
import {
  writeGroundTruthCompareHtmlFiles,
  writeGroundTruthCompareIndex,
} from '../dist/domain/writeGroundTruthCompareHtml.js';

const streamImportProgress = process.env.IMPORT_JOB_CLI_PROGRESS !== '0';
const groundTruthStrict = process.env.GROUND_TRUTH_STRICT === '1';
const verboseImportDebug = process.env.IMPORT_JOB_VERBOSE_DEBUG === '1';
const cliImageFilter = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(repoRoot, 'local/test-images');
const manifestPath = path.join(imageDir, 'manifest.json');
const dataDir = path.join(repoRoot, 'data');
const tessCache = path.join(dataDir, 'tesseract-cache');
const easyocrModelDir = path.join(dataDir, 'easyocr-models');
const groundTruthFixturesDir = path.join(repoRoot, 'server/src/test/fixtures');

/** @type {Map<string, object>} */
let fixtureByFile = new Map();
try {
  await access(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  fixtureByFile = new Map((manifest.fixtures ?? []).map((f) => [f.file, f]));
} catch {
  console.warn('No manifest at local/test-images/manifest.json — metrics only, no ground-truth line.');
}

let names = (await readdir(imageDir))
  .filter((f) => /\.jpe?g$/i.test(f))
  .sort();
if (cliImageFilter.length > 0) {
  names = names.filter((n) => cliImageFilter.some((pat) => n.includes(pat)));
  if (names.length === 0) {
    console.error(`No images match filter: ${cliImageFilter.join(', ')}`);
    process.exit(1);
  }
  console.log(`Running ${names.length} image(s): ${names.join(', ')}`);
}

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

function parseStitchMetrics(debug) {
  const line = debug.find((l) => l.startsWith('shared-label grid: stitch metrics '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('shared-label grid: stitch metrics '.length));
  } catch {
    return null;
  }
}

function countPlaceholderPanels(panels) {
  return panels.filter((p) => p.warning?.includes('manual') || p.preview?.includes('needs manual')).length;
}

const manifestRegressionDefaults = {
  'costco-candy.jpg': { minCalorieColumnsMatch: 3 },
  'protein-shake.jpg': { requireFieldsOk: ['calories'] },
  'ice-cream.jpg': { trackOnly: true },
};

const nutrientRegressionFailures = [];
/** @type {import('../dist/domain/writeGroundTruthCompareHtml.js').OcrPerformanceReportIndexEntry[]} */
const compareHtmlFiles = [];

for (const name of names) {
  const bytes = await readFile(path.join(imageDir, name));
  const hint = await inferLabelLayoutHint(bytes);
  const fx = fixtureByFile.get(name);

  console.log(`\n${'='.repeat(72)}\n${name}`);
  if (fx) {
    const nr = fx.nutrientRows;
    const rowGt =
      nr != null
        ? ` nutrientRows=${nr.mainSectionRows}+${nr.secondarySectionRows}`
        : '';
    console.log(
      `manifest: layout=${fx.layout}${fx.valueColumnCount != null ? ` expectValueCols=${fx.valueColumnCount}` : ''}${rowGt}`,
    );
  }
  console.log(
    `hint: widePanel=${hint.widePanel} singleSubjectInFocus=${hint.singleSubjectInFocus} ${hint.width}x${hint.height}`,
  );

  const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
  const step3Layout = pipeline.steps[3].data?.layout ?? '—';
  console.log(
    `geometry: lastOkStep=${pipeline.lastOkStep} step3=${step3Layout} sharedPlan=${pipeline.plan ? `${pipeline.plan.valueColumns.length} cols` : 'null'} rowSlices=${pipeline.plan?.rowBandSlices.length ?? '—'}`,
  );

  const splitPlan = await detectSplitSingleLabel(bytes, hint);
  if (fx?.splitSingleLabel?.expectDetect || splitPlan) {
    console.log(`split-single: ${splitPlan ? `detected (${splitPlan.strips.length} strips)` : 'not detected'}`);
  }

  const t0 = Date.now();
  const jobId = newImportJobId();
  const progressUser = 'local-ocr-script';
  let result;
  try {
    if (streamImportProgress) {
      console.log('import progress (same steps as in-app import):');
    }
    result = await runWithImportJob(jobId, progressUser, 'image', async () => {
      let stopWatch = () => {};
      if (streamImportProgress) {
        stopWatch = startImportJobConsoleWatch(jobId, progressUser, {
          pollMs: 350,
          streamDebug: true,
          verboseDebug: verboseImportDebug,
        });
      }
      try {
        return await extractImageLabel(bytes, tessCache, { easyocrModelDir });
      } finally {
        stopWatch();
        stopImportJobConsoleWatch(jobId);
        finishImportJob(jobId);
        if (streamImportProgress) {
          const finalSnap = getImportJobForUser(jobId, progressUser);
          if (finalSnap) console.log(formatImportJobSnapshotBlock(finalSnap));
        }
      }
    });
  } catch (err) {
    console.error('extractImageLabel failed:', err);
    continue;
  }
  const job = getImportJobForUser(jobId, 'local-ocr-script');
  const debug = job?.debugLog ?? [];

  const stitchMetrics = parseStitchMetrics(debug);
  if (stitchMetrics) {
    console.log(`stitch metrics: ${JSON.stringify(stitchMetrics)}`);
  }

  if (!streamImportProgress) {
    const trail = debug.filter((l) =>
      /geometry preflight|geometry: skip|shared-label grid:|variety pack|column-strip|stitch|split-single/i.test(l),
    );
    if (trail.length) {
      console.log('pipeline debug (tail):');
      for (const line of trail.slice(-20)) console.log(`  ${line}`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`OCR elapsed: ${elapsed}s, primary text length: ${result.text.length}`);
  const perfSpec = fx?.ocrPerformanceRegression;
  if (perfSpec?.trackMaxSeconds > 0) {
    const over = Number(elapsed) > perfSpec.trackMaxSeconds;
    const trackOnly = perfSpec.trackOnly !== false;
    console.log(
      `OCR runtime budget: ${elapsed}s / ${perfSpec.trackMaxSeconds}s ${over ? 'OVER' : 'OK'}${trackOnly ? ' (trackOnly)' : ''}`,
    );
    if (over && !trackOnly) process.exitCode = 1;
  }
  if (result.pipelineStages?.length) {
    const lines = result.pipelineStages.map(
      (s) => `${s.label} ${(s.durationMs / 1000).toFixed(1)}s${s.detail ? ` (${s.detail})` : ''}`,
    );
    console.log(`OCR stages: ${lines.join(' · ')}`);
  }

  const layout = inferLabelLayoutFromText([result.text]);
  console.log(
    `layout from text: kind=${layout.kind} multiProductColumnCount=${layout.multiProductColumnCount}`,
  );

  const tableCols = parseMultiProductLabelTable(result.text);
  const parsedColCount = tableCols?.length ?? 0;
  console.log(`multi-product parse: columns=${parsedColCount}`);

  const caloriesGt =
    fx?.caloriesKcalPerValueColumn ??
    (await loadGlareGroundTruthForImage(name, groundTruthFixturesDir))?.caloriesKcalPerValueColumn;
  if (caloriesGt?.length && tableCols?.length) {
    const lines = [];
    let matchCount = 0;
    for (let i = 0; i < caloriesGt.length; i += 1) {
      const expected = caloriesGt[i];
      const got = tableCols[i]?.nutrients?.calories;
      const ok =
        expected != null &&
        got != null &&
        typeof got === 'number' &&
        Math.abs(got - expected) <= Math.max(2, Math.round(expected * 0.05));
      if (ok) matchCount += 1;
      lines.push(`  v${i + 1} expect=${expected} got=${got ?? '—'} ${ok ? 'OK' : 'MISS'}`);
    }
    console.log(`calories vs ground truth (${matchCount}/${caloriesGt.length} within tolerance):`);
    for (const line of lines) console.log(line);
  }

  const nutrientGt = await loadLabelNutrientGroundTruthForImage(name, groundTruthFixturesDir);
  if (nutrientGt?.products.length) {
    const parsedProducts = resolveParsedProductsFromOcrText(
      result.text,
      nutrientGt.layout,
      result.slotMergedNutrients,
    );
    const rowSpecs = nutrientGt.compareFields?.length
      ? inferNutrientRowSpecs(nutrientGt.products, nutrientGt.compareFields)
      : undefined;
    const nutrientCompare = compareLabelProductsToGroundTruth({
      layout: nutrientGt.layout,
      groundTruth: nutrientGt.products,
      parsed: parsedProducts,
      rowSpecs,
    });
    const { summary } = nutrientCompare;
    console.log(
      `nutrients vs ground truth (${summary.layout}): ${summary.ok} ok, ${summary.off} off, ${summary.unusable} unusable (calories ok on ${summary.matchedColumnCount}/${summary.columnCount} cols)`,
    );
    const runtimeSeconds = Number(elapsed);
    const html = renderGroundTruthCompareHtml({
      title: ocrPerformanceReportTitle(name),
      sourceImage: name,
      dataSourceNote: `Live extractImageLabel (fixture ${nutrientGt.fixtureBasename})`,
      compare: nutrientCompare,
      runtimeSeconds,
      generatedAtIso: new Date().toISOString(),
      pipelineStages: result.pipelineStages,
    });
    const htmlBase = name.replace(/\.[a-z]+$/i, '') + '.html';
    await writeGroundTruthCompareHtmlFiles(repoRoot, name, html);
    compareHtmlFiles.push({
      fileName: htmlBase,
      runtimeSeconds,
      percentOk: groundTruthPercentOk(summary),
    });
    const workspaceDir = groundTruthCompareHtmlDirWorkspace(repoRoot);
    console.log(`OCR performance report: ${path.join(workspaceDir, htmlBase)} (${runtimeSeconds.toFixed(1)}s)`);
    console.log(`  (mirror: local/diagnostics/ground-truth-compare/${htmlBase})`);

    const regressionSpec =
      fx?.nutrientGroundTruthRegression ?? manifestRegressionDefaults[name] ?? { trackOnly: true };
    const regression = evaluateNutrientGroundTruthRegression({
      compare: nutrientCompare,
      spec: regressionSpec,
    });
    console.log(
      formatGroundTruthScoreLine({
        imageBasename: name,
        summary: nutrientCompare.summary,
        spec: regressionSpec,
        strictResult: regressionSpec.trackOnly ? undefined : regression,
      }),
    );
    if (groundTruthStrict && !regressionSpec.trackOnly && !regression.pass) {
      nutrientRegressionFailures.push(name);
    }
  }

  const built = buildNutritionImportWithPanels(result.text, 'image', null, null, {
    varietyPackExpectedColumns: result.varietyPackExpectedColumns,
  });
  const varietyPackPanels =
    (result.varietyPackExpectedColumns ?? 0) >= 2 && built.labelPanels.length > 0;
  if (result.slotMergedNutrients && !varietyPackPanels) {
    applySlotMergedNutrients(built.draft.nutrients, result.slotMergedNutrients);
  }
  const placeholders = countPlaceholderPanels(built.labelPanels);
  const parsedPanels = built.labelPanels.length - placeholders;

  const draftN = built.draft.nutrients;
  console.log(
    `import: panels=${built.labelPanels.length} (parsed=${parsedPanels} placeholder=${placeholders}) expectedCols=${result.varietyPackExpectedColumns ?? '—'} draft cal=${draftN.calories} fat=${draftN.fat}g sod=${draftN.sodium}mg prot=${draftN.protein}g`,
  );
  if (built.warning) console.log(`import warning: ${built.warning}`);

  if (fx?.layout === 'shared_rail' && fx.valueColumnCount != null) {
    const geomOk = pipeline.plan?.valueColumns.length === fx.valueColumnCount;
    const contentOk = parsedColCount >= 2 || parsedPanels >= 2;
    console.log(
      `outcome vs manifest: geometryCols=${geomOk ? 'OK' : 'MISMATCH'} tableContent=${contentOk ? 'OK' : 'WEAK'} (goal: parse≥2 products)`,
    );
  }
  if (fx?.layout === 'single') {
    const single = parseNutritionLabel(result.text);
    console.log(
      `single-label: looksLikeLabel=${single.looksLikeLabel} calories=${single.calories ?? '—'} (panels not expected)`,
    );
  }
  if (fx?.layout === 'split_single') {
    const single = parseNutritionLabel(result.text);
    console.log(
      `split_single: expect one label — looksLikeLabel=${single.looksLikeLabel} panels=${built.labelPanels.length} (0 panels OK if single draft should carry nutrition)`,
    );
  }

  for (const [i, panel] of built.labelPanels.entries()) {
    if (placeholders > 0 && panel.warning) continue;
    const nutrients = panel.draft?.nutrients ?? {};
    const pick = {
      calories: nutrients.calories,
      proteinG: nutrients.proteinG,
    };
    console.log(`  panel[${i}] ${panel.preview ?? panel.draft?.name} ${JSON.stringify(pick)}`);
  }

  const single = parseNutritionLabel(result.text);
  const singleNutrients = summarizeNutrients(single);
  if (singleNutrients && built.labelPanels.length === 0) {
    console.log(`primary parse nutrients: ${JSON.stringify(singleNutrients)}`);
  }

  const preview = result.text.replace(/\s+/g, ' ').trim();
  console.log(`text preview (${Math.min(400, preview.length)} chars): ${preview.slice(0, 400)}${preview.length > 400 ? '…' : ''}`);
}

if (compareHtmlFiles.length > 0) {
  await writeGroundTruthCompareIndex(repoRoot, compareHtmlFiles);
  const workspaceIndex = path.join(groundTruthCompareHtmlDirWorkspace(repoRoot), 'index.html');
  console.log(`\nOCR Performance Reports index (open in browser): ${workspaceIndex}`);
}

if (nutrientRegressionFailures.length > 0) {
  console.error(`\nGROUND_TRUTH_STRICT=1 failures: ${nutrientRegressionFailures.join(', ')}`);
  process.exit(1);
}
