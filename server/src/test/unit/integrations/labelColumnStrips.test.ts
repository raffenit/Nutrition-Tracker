import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { DEFAULT_COLUMN_STRIP_DETECT_PARAMS } from '../../../domain/columnStripDetectParams.js';
import {
  columnBoundariesForTest,
  detectColumnStrips,
  extractColumnStripBuffers,
} from '../../../integrations/labelColumnStrips.js';

const FOUR_COLUMN_LAYOUT = {
  leadingGutterFraction: 0.05,
  columnFraction: 0.15,
  gutterFraction: 0.05,
  count: 4,
} as const;

const MANY_COLUMN_LAYOUT = {
  count: 14,
  columnFraction: 0.038,
  gutterFraction: DEFAULT_COLUMN_STRIP_DETECT_PARAMS.minGutterSpacingFraction + 0.004,
} as const;

function paintColumns(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: Array<{ x0: number; x1: number }>,
  ink = 30,
  background = 250,
): void {
  pixels.fill(background);
  for (const column of columns) {
    for (let y = Math.round(height * 0.15); y < height * 0.85; y += 1) {
      for (let x = column.x0; x < column.x1 && x < width; x += 1) {
        pixels[y * width + x] = ink;
      }
    }
  }
}

/** Column positions from fractions of band width (resolution-invariant fixture pattern). */
function buildFractionalColumnLayout(
  width: number,
  spec: {
    count: number;
    columnFraction: number;
    gutterFraction: number;
    leadingGutterFraction?: number;
  },
): Array<{ x0: number; x1: number }> {
  const columns: Array<{ x0: number; x1: number }> = [];
  let x = Math.round(width * (spec.leadingGutterFraction ?? spec.gutterFraction));
  const colW = Math.round(width * spec.columnFraction);
  const gutterW = Math.round(width * spec.gutterFraction);
  for (let i = 0; i < spec.count; i += 1) {
    columns.push({ x0: x, x1: x + colW });
    x += colW + gutterW;
  }
  return columns;
}

async function syntheticWidePackPng(
  columnSpec: typeof FOUR_COLUMN_LAYOUT | typeof MANY_COLUMN_LAYOUT,
  width: number,
  height: number,
): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  paintColumns(pixels, width, height, buildFractionalColumnLayout(width, columnSpec));
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function meanGrey(buffer: Buffer): Promise<number> {
  const { data } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const value of data) sum += value;
  return sum / data.length;
}

function stripCenterFractions(plan: NonNullable<Awaited<ReturnType<typeof detectColumnStrips>>>, fullWidth: number): number[] {
  return plan.strips.map((strip) => (strip.left + strip.width / 2) / fullWidth);
}

test('column strip detect params use ratio tunables not raw pixel magic', () => {
  const p = DEFAULT_COLUMN_STRIP_DETECT_PARAMS;
  assert.ok(p.minGutterSpacingFraction > 0 && p.minGutterSpacingFraction < 0.2);
  assert.ok(p.minImageWidthFraction > 0 && p.minImageWidthFraction < 1);
  assert.equal(p.analysisWidth, 640);
});

test('columnBoundariesForTest finds four columns from fractional layout', () => {
  const width = 1200;
  const height = 120;
  const pixels = new Uint8Array(width * height);
  paintColumns(pixels, width, height, buildFractionalColumnLayout(width, FOUR_COLUMN_LAYOUT));
  const segments = columnBoundariesForTest(pixels, width, height);
  assert.equal(segments.length, 4);
  assert.ok(segments[0]!.x0 / width < 0.08);
  assert.ok(segments[3]!.x1 / width > 0.78);
});

test('columnBoundariesForTest column count is stable across band widths', () => {
  for (const width of [480, 960, 1920]) {
    const height = 100;
    const pixels = new Uint8Array(width * height);
    paintColumns(pixels, width, height, buildFractionalColumnLayout(width, FOUR_COLUMN_LAYOUT));
    assert.equal(columnBoundariesForTest(pixels, width, height).length, 4, `width=${width}`);
  }
});

test('columnBoundariesForTest caps segments at maxColumns', () => {
  const width = 2000;
  const height = 100;
  const pixels = new Uint8Array(width * height);
  paintColumns(pixels, width, height, buildFractionalColumnLayout(width, MANY_COLUMN_LAYOUT));
  const segments = columnBoundariesForTest(pixels, width, height, { minStripWidthFraction: 0.04, maxColumns: 12 });
  assert.equal(segments.length, 12);
});

test('columnBoundariesForTest does not split a uniform blank band', () => {
  const width = 400;
  const height = 80;
  const pixels = new Uint8Array(width * height);
  pixels.fill(250);
  assert.ok(columnBoundariesForTest(pixels, width, height).length < 2);
});

test('detectColumnStrips on synthetic wide pack image', async () => {
  const width = 900;
  const height = 300;
  const bytes = await syntheticWidePackPng(FOUR_COLUMN_LAYOUT, width, height);
  const plan = await detectColumnStrips(bytes);
  assert.ok(plan);
  assert.equal(plan!.strips.length, 4);
  assert.ok(plan!.strips[0]!.left / width < 0.1);
  assert.ok((plan!.strips[3]!.left + plan!.strips[3]!.width) / width > 0.75);

  const stripBuffers = await extractColumnStripBuffers(bytes, plan!);
  assert.equal(stripBuffers.length, 4);
  const firstMean = await meanGrey(stripBuffers[0]!);
  const fullMean = await meanGrey(bytes);
  assert.ok(firstMean < fullMean - 15, 'strip crop should be darker than the full white frame');
  for (const buffer of stripBuffers) {
    assert.ok(buffer.length > 100);
  }
});

test('detectColumnStrips column geometry is stable across image scales', async () => {
  const aspectH = 300 / 900;
  const baselineWidth = 900;
  const reference = await detectColumnStrips(await syntheticWidePackPng(FOUR_COLUMN_LAYOUT, baselineWidth, 300));
  assert.ok(reference);
  const referenceCenters = stripCenterFractions(reference, baselineWidth);

  for (const scale of [0.5, 2]) {
    const width = Math.round(baselineWidth * scale);
    const height = Math.max(80, Math.round(width * aspectH));
    const plan = await detectColumnStrips(await syntheticWidePackPng(FOUR_COLUMN_LAYOUT, width, height));
    assert.ok(plan, `scale=${scale}`);
    assert.equal(plan!.strips.length, 4);
    const centers = stripCenterFractions(plan, width);
    for (let i = 0; i < 4; i += 1) {
      assert.ok(
        Math.abs(centers[i]! - referenceCenters[i]!) < 0.04,
        `strip ${i} center drift at scale ${scale}`,
      );
    }
  }
});

test('detectColumnStrips merges many columns down to maxColumns', async () => {
  const width = 1800;
  const height = 300;
  const bytes = await syntheticWidePackPng(MANY_COLUMN_LAYOUT, width, height);
  const plan = await detectColumnStrips(bytes, { maxColumns: 12, minStripWidthFraction: 0.04 });
  assert.ok(plan);
  assert.equal(plan!.strips.length, 12);
});

test('detectColumnStrips returns null for portrait images', async () => {
  const bytes = await sharp({
    create: {
      width: 400,
      height: 800,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  assert.equal(await detectColumnStrips(bytes), null);
});

test('detectColumnStrips returns null when gutters are missing', async () => {
  const width = 900;
  const height = 300;
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 80, g: 80, b: 80 } },
  })
    .png()
    .toBuffer();
  assert.equal(await detectColumnStrips(bytes), null);
});

test('detectColumnStrips returns null on a uniform white wide image', async () => {
  const bytes = await sharp({
    create: {
      width: 900,
      height: 300,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  assert.equal(await detectColumnStrips(bytes), null);
});

test('detectColumnStrips returns null for a single column block', async () => {
  const width = 900;
  const height = 300;
  const pixels = new Uint8Array(width * height);
  paintColumns(pixels, width, height, [{ x0: Math.round(width * 0.22), x1: Math.round(width * 0.78) }]);
  const bytes = await sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
  assert.equal(await detectColumnStrips(bytes), null);
});

test('detectColumnStrips returns null when image is too small', async () => {
  const bytes = await sharp({
    create: {
      width: 100,
      height: 60,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  assert.equal(await detectColumnStrips(bytes), null);
});
