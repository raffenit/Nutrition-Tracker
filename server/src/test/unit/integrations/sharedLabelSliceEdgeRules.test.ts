import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { stripRowBandSliceEdgeRules } from '../../../integrations/sharedLabelValueGrid.js';

const W = 200;
const H = 30;

async function slice(draw: (x: number, y: number) => boolean): Promise<Buffer> {
  const px = Buffer.alloc(W * H, 255);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (draw(x, y)) px[y * W + x] = 0;
  return sharp(px, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

async function darkAt(png: Buffer, x: number, y: number): Promise<boolean> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data[y * info.width + x]! < 128;
}

test('a full-height separator at the slice edge is whitened', async () => {
  const out = await stripRowBandSliceEdgeRules(await slice((x) => x === 3 || x === 4));
  assert.equal(await darkAt(out, 3, 15), false);
});

test('a tall digit stroke near the edge is kept', async () => {
  const out = await stripRowBandSliceEdgeRules(await slice((x, y) => (x === 10 || x === 11) && y >= 3 && y < 26));
  assert.equal(await darkAt(out, 10, 15), true);
});
