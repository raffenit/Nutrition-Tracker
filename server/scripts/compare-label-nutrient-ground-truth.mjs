/**
 * Ground-truth vs OCR nutrient parse — HTML matrix (green / yellow / red).
 *
 * Usage:
 *   npm run build && node scripts/compare-label-nutrient-ground-truth.mjs [image-or-snapshot.json]
 *
 * Ground truth: server/src/test/fixtures/*NutrientGroundTruth.json or *GlareGroundTruth.json
 * with a `products` (or legacy `productsPerValueColumn`) array.
 *
 * Defaults to local/test-images/costco-candy.jpg (full extractImageLabel).
 * Pass a fixture JSON with labelColumnText + valueColumnTexts for stitch-only compare.
 *
 * Output: local/diagnostics/ground-truth-compare/<basename>.html
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractImageLabel } from '../dist/integrations/extractText.js';
import { parseMultiProductLabelTable } from '../dist/domain/parseMultiProductLabelTable.js';
import { loadLabelNutrientGroundTruthForImage } from '../dist/domain/labelNutrientGroundTruth.js';
import { analyzeSharedLabelGridStageReport } from '../dist/domain/sharedLabelGridStageReport.js';
import {
  compareLabelProductsToGroundTruth,
  ocrPerformanceReportTitle,
  renderGroundTruthCompareHtml,
  resolveParsedProductsFromOcrText,
  inferNutrientRowSpecs,
} from '../dist/domain/labelNutrientGroundTruthCompare.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultImage = path.join(repoRoot, 'local/test-images/costco-candy.jpg');
const fixturesDir = path.join(repoRoot, 'server/src/test/fixtures');
import { groundTruthCompareHtmlDirWorkspace } from '../dist/domain/groundTruthComparePaths.js';
import { writeGroundTruthCompareHtmlFiles } from '../dist/domain/writeGroundTruthCompareHtml.js';

const inputArg = process.argv[2] ? path.resolve(process.argv[2]) : defaultImage;
const dataDir = path.join(repoRoot, 'data');

async function fromSnapshot(snapshotPath) {
  const snap = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const basename = snap.sourceImage ?? path.basename(snapshotPath, '.json') + '.jpg';
  let ocrText;
  let dataSourceNote = `OCR snapshot ${path.relative(repoRoot, snapshotPath)}`;
  if (snap.labelColumnText && snap.valueColumnTexts) {
    const report = analyzeSharedLabelGridStageReport(
      snap.labelColumnText,
      snap.valueColumnTexts,
      snap.headerBandText ?? '',
    );
    ocrText = report.stitched ?? '';
    dataSourceNote += ' (stitched row-band columns)';
  } else if (typeof snap.ocrText === 'string') {
    ocrText = snap.ocrText;
    dataSourceNote += ' (raw ocrText field)';
  } else {
    throw new Error('Snapshot needs shared-label fields or ocrText');
  }
  return {
    sourceImage: basename,
    dataSourceNote,
    ocrText,
  };
}

async function fromImage(imagePath) {
  const name = path.basename(imagePath);
  const bytes = await readFile(imagePath);
  const t0 = Date.now();
  const result = await extractImageLabel(bytes, path.join(dataDir, 'tesseract-cache'), {
    easyocrModelDir: path.join(dataDir, 'easyocr-models'),
  });
  const runtimeSeconds = (Date.now() - t0) / 1000;
  return {
    sourceImage: name,
    dataSourceNote: 'Live extractImageLabel stitched text',
    ocrText: result.text,
    runtimeSeconds,
  };
}

let payload;
try {
  await access(inputArg);
  if (inputArg.endsWith('.json')) payload = await fromSnapshot(inputArg);
  else payload = await fromImage(inputArg);
} catch (err) {
  console.error('Input not readable:', inputArg, err);
  process.exit(1);
}

const gtBundle = await loadLabelNutrientGroundTruthForImage(payload.sourceImage, fixturesDir);
if (!gtBundle?.products.length) {
  console.error('No nutrient ground truth (products[]) for', payload.sourceImage, 'in', fixturesDir);
  process.exit(1);
}

const parsed = resolveParsedProductsFromOcrText(payload.ocrText, gtBundle.layout);
const rowSpecs = gtBundle.compareFields?.length
  ? inferNutrientRowSpecs(gtBundle.products, gtBundle.compareFields)
  : undefined;
const compare = compareLabelProductsToGroundTruth({
  layout: gtBundle.layout,
  groundTruth: gtBundle.products,
  parsed,
  rowSpecs,
});

const html = renderGroundTruthCompareHtml({
  title: ocrPerformanceReportTitle(payload.sourceImage),
  sourceImage: payload.sourceImage,
  dataSourceNote: `${payload.dataSourceNote} · fixture ${gtBundle.fixtureBasename}`,
  compare,
  runtimeSeconds: payload.runtimeSeconds,
  generatedAtIso: new Date().toISOString(),
});

const outFile = await writeGroundTruthCompareHtmlFiles(repoRoot, payload.sourceImage, html);

console.log('Wrote', groundTruthCompareHtmlDirWorkspace(repoRoot));
console.log('Primary file', outFile);
console.log(
  `Layout ${compare.summary.layout}: ${compare.summary.ok} ok, ${compare.summary.off} off, ${compare.summary.unusable} unusable; calories ok on ${compare.summary.matchedColumnCount}/${compare.summary.columnCount}`,
);
const preview = payload.ocrText.replace(/\s+/g, ' ').trim();
console.log('OCR preview:', preview.slice(0, 120) + (preview.length > 120 ? '…' : ''));
if (!parsed?.length) {
  console.warn('No parsed products from OCR text (table empty).');
} else if (gtBundle.layout !== 'single') {
  console.log('Parsed columns:', parsed.length, '· table parse cols:', parseMultiProductLabelTable(payload.ocrText)?.length ?? 0);
}