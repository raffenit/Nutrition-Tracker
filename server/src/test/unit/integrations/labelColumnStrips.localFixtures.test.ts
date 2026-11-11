import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildNutritionImportWithPanels } from '../../../domain/nutritionImport.js';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import { inferLabelLayoutHint } from '../../../integrations/imageLayoutHint.js';
import { detectColumnStrips } from '../../../integrations/labelColumnStrips.js';
import { detectSharedLabelValueGrid } from '../../../integrations/sharedLabelValueGrid.js';
import { extractImageLabel } from '../../../integrations/extractText.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const localImagesDir = path.join(repoRoot, 'local', 'test-images');

const FIXTURES = {
  varietyPack: 'costco-candy.jpg',
  singlePortrait: 'protein-shake.jpg',
  twoProducts: 'ice-cream.jpg',
} as const;

test(
  'local variety-pack photo separates into multiple column strips',
  { skip: !existsSync(path.join(localImagesDir, FIXTURES.varietyPack)) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, FIXTURES.varietyPack));
    const hint = await inferLabelLayoutHint(bytes);
    assert.ok(hint.widePanel);
    const plan = await detectColumnStrips(bytes, { maxColumns: 14 });
    assert.ok(plan, 'expected a column strip plan');
    const shared = await detectSharedLabelValueGrid(bytes, { maxColumns: 14 });
    assert.ok(shared, 'expected shared label column + value grid');
    assert.ok(shared!.valueColumns.length >= 4, 'expected multiple value columns');
  },
);

test(
  'local portrait label does not run wide column-strip detection',
  { skip: !existsSync(path.join(localImagesDir, FIXTURES.singlePortrait)) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, FIXTURES.singlePortrait));
    const hint = await inferLabelLayoutHint(bytes);
    assert.equal(hint.widePanel, false);
    assert.equal(await detectColumnStrips(bytes), null);
  },
);

test(
  'local two-product wide photo does not yield a parseable multi-column import',
  { skip: !existsSync(path.join(localImagesDir, FIXTURES.twoProducts)) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, FIXTURES.twoProducts));
    const tess = await import('node:os').then((os) => os.tmpdir());
    const { text } = await extractImageLabel(bytes, tess, {
      easyocrModelDir: path.join(repoRoot, 'data', 'easyocr-models'),
    });
    const cols = parseMultiProductLabelTable(text);
    const built = buildNutritionImportWithPanels(text, 'image', null);
    assert.ok(!cols || cols.length < 2, 'two side-by-side products should not parse as a variety table');
    assert.ok(built.labelPanels.length < 2, 'should not surface multi-product pick-one UI');
  },
);
