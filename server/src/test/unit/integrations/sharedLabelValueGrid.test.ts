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
  sharedLabelBoundaryForTest,
  valueBoundariesAfterLabelForTest,
} from '../../../integrations/sharedLabelValueGrid.js';
import { buildColumnInkProfileFromBand } from '../../../integrations/labelColumnStrips.js';

const VALUE_GRID = {
  labelFraction: 0.2,
  count: 5,
  columnFraction: 0.1,
  gutterFraction: 0.025,
} as const;

function paintSharedLabelGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  spec: typeof VALUE_GRID,
  ink = 30,
  background = 250,
): void {
  pixels.fill(background);
  const labelWidth = Math.round(width * spec.labelFraction);
  for (let y = Math.round(height * 0.12); y < height * 0.88; y += 1) {
    for (let x = 0; x < labelWidth; x += 1) {
      pixels[y * width + x] = ink;
    }
  }
  let x = labelWidth + Math.round(width * spec.gutterFraction);
  const colW = Math.round(width * spec.columnFraction);
  const gutterW = Math.round(width * spec.gutterFraction);
  const ruleInk = Math.min(255, ink + 50);
  for (let i = 0; i < spec.count; i += 1) {
    const colX0 = x;
    for (let y = Math.round(height * 0.18); y < height * 0.88; y += 1) {
      for (let cx = x; cx < x + colW && cx < width; cx += 1) {
        pixels[y * width + cx] = ink;
      }
    }
    for (let rule = 0; rule < 8; rule += 1) {
      const ry = Math.round(height * (0.22 + rule * 0.07));
      for (let cx = colX0 + 2; cx < colX0 + colW - 2 && cx < width; cx += 1) {
        pixels[ry * width + cx] = ruleInk;
      }
    }
    x += colW + gutterW;
  }
}

async function syntheticSharedGridPng(width: number, height: number): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, VALUE_GRID);
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test('sharedLabelBoundaryForTest finds label/value split on synthetic profile', () => {
  const width = 1200;
  const height = 120;
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, VALUE_GRID);
  const profile = buildColumnInkProfileFromBand(pixels, width, height);
  const boundary = sharedLabelBoundaryForTest(profile);
  assert.ok(boundary);
  assert.ok(boundary! / width > 0.12 && boundary! / width < 0.32);
  const values = valueBoundariesAfterLabelForTest(pixels, width, height, boundary!, {
    ...DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
    maxColumns: 12,
  });
  assert.equal(values.length, VALUE_GRID.count);
});

test('detectSharedLabelValueGrid on synthetic shared-label table', async () => {
  const bytes = await syntheticSharedGridPng(1200, 300);
  const plan = await detectSharedLabelValueGrid(bytes, { requireWideAspect: true, maxColumns: 12 });
  assert.ok(plan);
  assert.equal(plan!.valueColumns.length, VALUE_GRID.count);
  assert.ok(plan!.labelColumn.width / 1200 < 0.35);
});

test('repeated full-width column detect is not preferred on shared-label layout', async () => {
  const bytes = await syntheticSharedGridPng(1200, 300);
  const plan = await detectSharedLabelValueGrid(bytes);
  assert.ok(plan);
  assert.ok(plan!.valueColumns.length >= VALUE_GRID.count);
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const varietyPack = path.join(repoRoot, 'local', 'test-images', 'IMG_20261105_211226.jpg');

test(
  'local variety pack matches shared-label grid layout',
  { skip: !existsSync(varietyPack) },
  async () => {
    const bytes = await readFile(varietyPack);
    const plan = await detectSharedLabelValueGrid(bytes, { maxColumns: 14 });
    assert.ok(plan, 'expected shared label + value grid');
    assert.ok(plan!.valueColumns.length >= 4, 'expected multiple value columns');
    assert.ok(plan!.labelColumn.width < (await sharp(bytes).rotate().metadata()).width! * 0.35);
  },
);
