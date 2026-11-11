import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import sharp from 'sharp';
import { DEFAULT_COLUMN_STRIP_DETECT_PARAMS } from '../../../domain/columnStripDetectParams.js';
import { detectSharedLabelValueGrid } from '../../../integrations/varietyPackGridPipeline.js';
import {
  profileInkAsymmetryForLayoutScores,
  sharedLabelBoundaryForTest,
  valueBoundariesAfterLabelForTest,
} from '../../../integrations/sharedLabelValueGrid.js';
import { buildColumnInkProfileFromBand } from '../../../integrations/labelColumnStrips.js';
import { LOCAL_SHARED_LABEL_MULTI_VALUE_JPG } from '../../fixtures/localTestImageNames.js';
import {
  DEFAULT_PER_COLUMN_LABEL_GRID,
  DEFAULT_SHARED_LABEL_GRID,
  paintPerColumnLabelGrid,
  paintSharedLabelGrid,
  syntheticSharedLabelGridPng,
} from '../../fixtures/syntheticVarietyPackGrids.js';

test('profileInkAsymmetryForLayoutScores uses ink boundary on shared rail, not first column edge', () => {
  const width = 1200;
  const height = 120;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  const profile = buildColumnInkProfileFromBand(pixels, width, height);
  const boundary = sharedLabelBoundaryForTest(profile);
  assert.ok(boundary);
  const fallback = Math.round(width * DEFAULT_SHARED_LABEL_GRID.columnFraction);
  const asym = profileInkAsymmetryForLayoutScores(profile, fallback);
  assert.ok(asym !== undefined && asym > 1);
  assert.notEqual(boundary, fallback);
});

test('profileInkAsymmetryForLayoutScores ignores bogus narrow ink boundary on per-column grid', () => {
  const width = 1200;
  const height = 300;
  const pixels = new Uint8Array(width * height);
  paintPerColumnLabelGrid(pixels, width, height, DEFAULT_PER_COLUMN_LABEL_GRID);
  const profile = buildColumnInkProfileFromBand(pixels, width, height);
  const firstColEnd = Math.round(width / DEFAULT_PER_COLUMN_LABEL_GRID.count);
  const asym = profileInkAsymmetryForLayoutScores(profile, firstColEnd);
  assert.ok(asym === undefined || asym < 1.5);
});

test('sharedLabelBoundaryForTest finds label/value split on synthetic profile', () => {
  const width = 1200;
  const height = 120;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, DEFAULT_SHARED_LABEL_GRID);
  const profile = buildColumnInkProfileFromBand(pixels, width, height);
  const boundary = sharedLabelBoundaryForTest(profile);
  assert.ok(boundary);
  assert.ok(boundary! / width > 0.12 && boundary! / width < 0.32);
  const values = valueBoundariesAfterLabelForTest(pixels, width, height, boundary!, {
    ...DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    maxColumns: 12,
  });
  assert.equal(values.length, DEFAULT_SHARED_LABEL_GRID.count);
});

test('detectSharedLabelValueGrid on synthetic shared-label table', async () => {
  const bytes = await syntheticSharedLabelGridPng(1200, 300);
  const plan = await detectSharedLabelValueGrid(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(plan);
  assert.equal(plan!.valueColumns.length, DEFAULT_SHARED_LABEL_GRID.count);
  assert.ok(plan!.labelColumn.width / 1200 < 0.35);
});

test('repeated full-width column detect is not preferred on shared-label layout', async () => {
  const bytes = await syntheticSharedLabelGridPng(1200, 300);
  const plan = await detectSharedLabelValueGrid(bytes);
  assert.ok(plan);
  assert.ok(plan!.valueColumns.length >= DEFAULT_SHARED_LABEL_GRID.count);
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const sharedLabelMultiValueFixture = path.join(repoRoot, 'local', 'test-images', LOCAL_SHARED_LABEL_MULTI_VALUE_JPG);

test(
  'local shared-label multi-value fixture matches grid layout',
  { skip: !existsSync(sharedLabelMultiValueFixture) },
  async () => {
    const bytes = await readFile(sharedLabelMultiValueFixture);
    const plan = await detectSharedLabelValueGrid(bytes, { maxColumns: 14 });
    assert.ok(plan, 'expected shared label + value grid');
    assert.ok(plan!.valueColumns.length >= 4, 'expected multiple value columns');
    assert.ok(plan!.labelColumn.width < (await sharp(bytes).rotate().metadata()).width! * 0.35);
  },
);
