import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  compareLabelProductsToGroundTruth,
  inferNutrientRowSpecs,
  ocrPerformanceReportTitle,
  renderGroundTruthCompareHtml,
  resolveParsedProductsFromOcrText,
} from '../../../domain/labelNutrientGroundTruthCompare.js';
import { loadLabelNutrientGroundTruthForImage } from '../../../domain/labelNutrientGroundTruth.js';
import {
  evaluateNutrientGroundTruthRegression,
  formatGroundTruthScoreLine,
  type NutrientGroundTruthRegressionSpec,
} from '../../../domain/labelNutrientGroundTruthRegression.js';
import { extractImageLabelCached } from '../../fixtures/cachedLocalImageOcr.js';
import { writeGroundTruthCompareHtmlFiles } from '../../../domain/writeGroundTruthCompareHtml.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const imageDir = path.join(repoRoot, 'local', 'test-images');
const fixturesDir = path.join(repoRoot, 'server', 'src', 'test', 'fixtures');
const manifestPath = path.join(imageDir, 'manifest.json');
const tessCache = path.join(repoRoot, 'data', 'tesseract-cache');
const easyocrModelDir = path.join(repoRoot, 'data', 'easyocr-models');
const groundTruthStrict = process.env.GROUND_TRUTH_STRICT === '1';

type ManifestFixture = {
  file: string;
  layout?: string;
  nutrientGroundTruthRegression?: NutrientGroundTruthRegressionSpec;
};

/** Manifest targets — advisory unless GROUND_TRUTH_STRICT=1. */
const DEFAULT_REGRESSION: Record<string, NutrientGroundTruthRegressionSpec> = {
  'costco-candy.jpg': { minCalorieColumnsMatch: 3, trackOnly: true },
  'protein-shake.jpg': { requireFieldsOk: ['calories'], trackOnly: true },
  'ice-cream.jpg': { trackOnly: true },
};

test(
  'local test-images: nutrient ground truth compare (score % per label)',
  { skip: !existsSync(imageDir) && 'missing local/test-images photo fixture (host-specific, gitignored)' },
  async (t) => {
    let fixtures: ManifestFixture[] = [];
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { fixtures?: ManifestFixture[] };
      fixtures = manifest.fixtures ?? [];
    } catch {
      fixtures = ['costco-candy.jpg', 'protein-shake.jpg', 'ice-cream.jpg'].map((file) => ({ file }));
    }

    const scoreLines: string[] = [];
    const strictFailures: string[] = [];
    const missingFixtures: string[] = [];

    for (const fx of fixtures) {
      const imagePath = path.join(imageDir, fx.file);
      if (!existsSync(imagePath)) continue;

      const gtBundle = await loadLabelNutrientGroundTruthForImage(fx.file, fixturesDir);
      if (!gtBundle?.products.length) {
        missingFixtures.push(fx.file);
        continue;
      }

      const bytes = await readFile(imagePath);
      const result = await extractImageLabelCached(bytes, tessCache, { easyocrModelDir });
      const parsed = resolveParsedProductsFromOcrText(result.text, gtBundle.layout, result.slotMergedNutrients);
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
        title: ocrPerformanceReportTitle(fx.file),
        sourceImage: fx.file,
        dataSourceNote: `localFixtures test (fixture ${gtBundle.fixtureBasename})`,
        compare,
      });
      await writeGroundTruthCompareHtmlFiles(repoRoot, fx.file, html);

      const spec = { trackOnly: true, ...DEFAULT_REGRESSION[fx.file], ...fx.nutrientGroundTruthRegression };
      const regression = evaluateNutrientGroundTruthRegression({ compare, spec });
      scoreLines.push(
        formatGroundTruthScoreLine({
          imageBasename: fx.file,
          summary: compare.summary,
          spec,
          strictResult: spec.trackOnly ? undefined : regression,
        }),
      );
      if (groundTruthStrict && !spec.trackOnly && !regression.pass) {
        strictFailures.push(scoreLines.at(-1)!);
      }
    }

    for (const line of scoreLines) t.diagnostic(line);
    if (missingFixtures.length > 0) {
      t.diagnostic(`missing ground-truth fixture for: ${missingFixtures.join(', ')}`);
    }

    assert.equal(missingFixtures.length, 0, `Add *NutrientGroundTruth.json for: ${missingFixtures.join(', ')}`);

    if (groundTruthStrict) {
      assert.equal(strictFailures.length, 0, strictFailures.join('\n'));
    }
  },
);