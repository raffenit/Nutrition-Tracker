import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  enforceValueColumnsDisjointFromLabel,
  looksLikeLeadingLabelBleedColumn,
  productValueSegmentsRightOfLabel,
  separateSharedLabelValueTexts,
  valueColumnTextLooksLikeLabelRail,
} from '../../../domain/sharedLabelColumnSeparation.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const costcoSnapshotPath = path.join(
  repoRoot,
  'server/src/test/fixtures/costcoCandySharedLabelOcr.snapshot.json',
);

test('productValueSegmentsRightOfLabel clamps x0 to label boundary', () => {
  const out = productValueSegmentsRightOfLabel(
    [
      { x0: 50, x1: 120 },
      { x0: 120, x1: 200 },
    ],
    117,
    2,
  );
  assert.equal(out.length, 2);
  assert.equal(out[0]!.x0, 117);
  assert.equal(out[0]!.x1, 120);
  assert.equal(out[1]!.x0, 120);
});

test('enforceValueColumnsDisjointFromLabel drops strips fully inside label rail', () => {
  const label = { index: 0, left: 10, top: 0, width: 200, height: 400 };
  const values = [
    { index: 0, left: 10, top: 50, width: 180, height: 300 },
    { index: 1, left: 210, top: 50, width: 100, height: 300 },
  ];
  const kept = enforceValueColumnsDisjointFromLabel(label, values);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]!.left, 210);
});

test('separateSharedLabelValueTexts drops label-rail OCR bleed', () => {
  const label = 'Nutrition Facts\nAmount per serving\nCalories\nTotal Fat\nSodium';
  const bleed = 'Nutrition Facts\ncainer\nServing\nAmount per se';
  const product = '% Daily Value*\n90\n5g\n120mg';
  const { valueColumnTexts, droppedIndexes } = separateSharedLabelValueTexts(label, [bleed, product, product]);
  assert.deepEqual(droppedIndexes, [0]);
  assert.equal(valueColumnTexts.length, 2);
});

test(
  'Costco snapshot first value strip is classified as label rail bleed',
  { skip: !existsSync(costcoSnapshotPath) },
  async () => {
    const snap = JSON.parse(await readFile(costcoSnapshotPath, 'utf8')) as {
      labelColumnText: string;
      valueColumnTexts: string[];
    };
    assert.ok(
      valueColumnTextLooksLikeLabelRail(snap.labelColumnText, snap.valueColumnTexts[0]!) ||
        looksLikeLeadingLabelBleedColumn(0, snap.valueColumnTexts, snap.labelColumnText),
      'fixture col 0 should not be treated as product values',
    );
    const { droppedIndexes } = separateSharedLabelValueTexts(snap.labelColumnText, snap.valueColumnTexts);
    assert.deepEqual(droppedIndexes[0], 0);
  },
);
