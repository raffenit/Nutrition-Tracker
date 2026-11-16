import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { compareLabelProductsToGroundTruth } from '../../../domain/labelNutrientGroundTruthCompare.js';
import { loadLabelNutrientGroundTruthForImage } from '../../../domain/labelNutrientGroundTruth.js';
import { parseMultiProductLabelTable } from '../../../domain/parseMultiProductLabelTable.js';
import { stitchSharedLabelGridTexts } from '../../../domain/stitchSharedLabelGridTexts.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const fixturesDir = path.join(repoRoot, 'server/src/test/fixtures');
const snapshotPath = path.join(fixturesDir, 'costcoCandySharedLabelOcr.snapshot.json');

test('Costco snapshot stitch uses header display calories when provided', async () => {
  const snap = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
    labelColumnText: string;
    headerBandText: string;
    valueColumnTexts: string[];
  };
  const gt = await loadLabelNutrientGroundTruthForImage('costco-candy.jpg', fixturesDir);
  assert.ok(gt);

  const headerColumnTexts = gt.products.map(
    (p) => `${p.productName}\nVaries\n${p.nutrients.calories}`,
  );
  const stitched = stitchSharedLabelGridTexts(
    snap.labelColumnText,
    snap.valueColumnTexts,
    snap.headerBandText,
    { headerColumnTexts, valueColumnTexts: snap.valueColumnTexts },
  );
  assert.ok(stitched);

  const parsed = parseMultiProductLabelTable(stitched!);
  const compare = compareLabelProductsToGroundTruth({
    layout: 'shared_rail',
    groundTruth: gt.products,
    parsed: parsed?.map((c) => ({ name: c.name, nutrients: c.nutrients })) ?? null,
    rowSpecs: [{ field: 'calories', label: 'Cal', unit: 'kcal', core: 'calories' }],
  });
  assert.equal(compare.summary.matchedColumnCount, 10);
  assert.equal(compare.summary.unusable, 0);
});