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
import {
  LOCAL_SHARED_LABEL_MULTI_VALUE_JPG,
  LOCAL_SINGLE_PANEL_JPG,
  LOCAL_SPLIT_SINGLE_JPG,
} from '../../fixtures/localTestImageNames.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const localImagesDir = path.join(repoRoot, 'local', 'test-images');

const FIXTURES = {
  sharedLabelMultiValue: LOCAL_SHARED_LABEL_MULTI_VALUE_JPG,
  singlePortrait: LOCAL_SINGLE_PANEL_JPG,
  splitSingle: LOCAL_SPLIT_SINGLE_JPG,
} as const;

test(
  'local shared-label multi-value photo separates into multiple column strips',
  { skip: !existsSync(path.join(localImagesDir, FIXTURES.sharedLabelMultiValue)) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, FIXTURES.sharedLabelMultiValue));
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
  { skip: !existsSync(path.join(localImagesDir, FIXTURES.splitSingle)) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, FIXTURES.splitSingle));
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
