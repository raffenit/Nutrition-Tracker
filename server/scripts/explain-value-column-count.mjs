/**
 * Why did we get N value columns? Reports gutter peaks, ruled segments, refine/snap.
 * Usage: npm run build && node scripts/explain-value-column-count.mjs [image.jpg]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVarietyPackBandContext } from '../dist/integrations/varietyPackGridPipeline.js';
import { buildColumnInkProfileFromBand } from '../dist/integrations/labelColumnStrips.js';
import { sharedLabelBoundaryForTest, valueBoundariesAfterLabelForTest } from '../dist/integrations/sharedLabelValueGrid.js';
import {
  categoriesFromRuledGrid,
  estimateValueColumnCountFromGutters,
  classifyBandLuminance,
  ruledGridScanBandY,
} from '../dist/integrations/ruledTableGridDetect.js';
import { columnWidthCv, refineUniformProductColumns } from '../dist/integrations/uniformColumnGeometry.js';
import { DEFAULT_COLUMN_STRIP_DETECT_PARAMS } from '../dist/domain/columnStripDetectParams.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Default image: shared-label multi-value local fixture (`costco-candy.jpg` is filename only). */
const imagePath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'local/test-images/costco-candy.jpg'));

const bytes = await readFile(imagePath);
const ctx = await prepareVarietyPackBandContext(bytes, { maxColumns: 14 });
if (!ctx) {
  console.error('Could not prepare band (aspect or band missing).');
  process.exit(1);
}

const { pixels, analysisW, analysisH } = ctx.bandAnalysis;
const profile = buildColumnInkProfileFromBand(pixels, analysisW, analysisH);
const boundaryX = sharedLabelBoundaryForTest(profile);
const valueStart = boundaryX ?? 0;
const valueEnd = analysisW;
const valueW = valueEnd - valueStart;

const { y0, y1 } = ruledGridScanBandY(analysisH);
const luminance = classifyBandLuminance(pixels, analysisW, analysisH, valueStart, valueEnd, y0, y1);
const gutterCols = estimateValueColumnCountFromGutters(pixels, analysisW, analysisH, valueStart, valueEnd);
const ruledStrict = categoriesFromRuledGrid(pixels, analysisW, analysisH, valueStart, {}, 14, {
  requireHorizontalRules: true,
});
const ruledLoose = categoriesFromRuledGrid(pixels, analysisW, analysisH, valueStart, {}, 14, {
  requireHorizontalRules: false,
});

const used = ruledLoose.length > ruledStrict.length ? ruledLoose : ruledStrict;
const refined = refineUniformProductColumns(
  pixels,
  analysisW,
  analysisH,
  used.map((s) => ({ x0: s.x0, x1: s.x1 })),
  used.map((s) => ({ horizontalRuleCount: s.horizontalRuleCount })),
  valueStart,
  valueEnd,
  14,
);
const production = valueBoundariesAfterLabelForTest(pixels, analysisW, analysisH, valueStart, {
  ...DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
  maxColumns: 14,
});

const mergedTail = ruledLoose.filter((s) => s.x1 - s.x0 > 90 || s.horizontalRuleCount < 3);
const nominalGuess = Math.round(valueW / (production[0] ? production[0].x1 - production[0].x0 : 1));

const report = {
  image: imagePath,
  analysis: { width: analysisW, height: analysisH },
  labelBoundaryX: valueStart,
  valueRegionPx: valueW,
  luminanceRoles: luminance,
  whyColumnCount: {
    summary:
      gutterCols < 10 && mergedTail.length > 0
        ? `Bright-gutter counter found ${gutterCols - 1} gutters (${gutterCols} columns). ` +
          `Ruled grid merged the right-side products into wide segment(s): ${mergedTail
            .map((s) => `${s.x1 - s.x0}px @x${s.x0} (rules=${s.horizontalRuleCount})`)
            .join('; ')}. ` +
          `Uniform snap then divides the full value width into ${production.length} equal ~${production[0] ? production[0].x1 - production[0].x0 : '?'}px strips.`
        : `Gutter-based estimate is ${gutterCols}; production plan has ${production.length} columns.`,
    gutterEstimatedColumns: gutterCols,
    ruledStrictCount: ruledStrict.length,
    ruledStrictSegments: ruledStrict.map((s) => ({
      x0: s.x0,
      x1: s.x1,
      width: s.x1 - s.x0,
      horizontalRuleCount: s.horizontalRuleCount,
    })),
    ruledLooseCount: ruledLoose.length,
    ruledLooseSegments: ruledLoose.map((s) => ({
      x0: s.x0,
      x1: s.x1,
      width: s.x1 - s.x0,
      horizontalRuleCount: s.horizontalRuleCount,
      note:
        s.x1 - s.x0 > 90
          ? 'likely merged multiple products — gutters/rules not seen inside'
          : s.horizontalRuleCount < 3
            ? 'weak or no horizontal rules (edge column or gutter noise)'
            : undefined,
    })),
    refineOutput: {
      count: refined.length,
      widthCv: columnWidthCv(refined.map((s) => s.x1 - s.x0)),
      widths: refined.map((s) => s.x1 - s.x0),
    },
    productionPlanColumns: production.length,
    productionWidths: production.map((s) => s.x1 - s.x0),
    ifTargetWere10: {
      impliedColumnWidthPx: Math.round((valueW / 10) * 10) / 10,
      currentImpliedFromGutters: Math.round((valueW / gutterCols) * 10) / 10,
      gap:
        'Need ~2 more bright gutters (or split the wide ruled segment) between x≈359 and the right edge.',
    },
  },
};

const outDir = path.join(repoRoot, 'local/diagnostics/value-column-explain');
await mkdir(outDir, { recursive: true });
const base = path.basename(imagePath, path.extname(imagePath));
const outFile = path.join(outDir, `${base}.json`);
await writeFile(outFile, JSON.stringify(report, null, 2));

console.log(report.whyColumnCount.summary);
console.log('\n--- details ---');
console.log('label boundary x', valueStart, '| value width px', valueW);
console.log(
  'luminance clusters:',
  luminance.clusters.map((c) => `${c.role}~${c.centroid} (${(c.massFraction * 100).toFixed(1)}%)`).join(', '),
);
console.log(
  'background',
  luminance.background,
  'ink',
  luminance.ink,
  'polarity',
  luminance.polarity,
  'glareCap',
  luminance.glareCap,
);
console.log('gutter estimate → columns:', gutterCols);
console.log('ruled (strict rules):', ruledStrict.length, ruledStrict.map((s) => s.x1 - s.x0).join(', '));
console.log('ruled (loose):', ruledLoose.length);
for (const s of ruledLoose) {
  const flag = s.x1 - s.x0 > 90 ? ' [MERGED]' : s.horizontalRuleCount < 3 ? ' [weak rules]' : '';
  console.log(`  x${s.x0}-${s.x1} w=${s.x1 - s.x0} rules=${s.horizontalRuleCount}${flag}`);
}
console.log('refine →', refined.length, 'cols cv', report.whyColumnCount.refineOutput.widthCv.toFixed(3));
console.log('production plan →', production.length, 'cols widths', production.map((s) => s.x1 - s.x0).join(', '));
console.log('\nWrote', outFile);
