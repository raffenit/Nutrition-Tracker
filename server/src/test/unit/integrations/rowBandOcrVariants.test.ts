import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { buildRowBandOcrVariants } from '../../../integrations/ocrPreprocess.js';

async function rowCrop(width: number, height: number): Promise<Buffer> {
  const px = Buffer.alloc(width * height, 255);
  for (let x = 0; x < width; x += 1) {
    px[x] = 0;
    px[(height - 1) * width + x] = 0;
  }
  return sharp(px, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

test('row-band OCR prep upscales a short wide crop without cropping it', async () => {
  const [out] = await buildRowBandOcrVariants(await rowCrop(207, 53));
  const { data, info } = await sharp(out!).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(info.width / info.height - 207 / 53) < 0.05);
  const mid = Math.floor(info.width / 2);
  assert.ok(data[mid]! < 128, 'top edge kept');
  assert.ok(data[(info.height - 1) * info.width + mid]! < 128, 'bottom edge kept');
});

test('row-band OCR prep keeps the aspect ratio of a tall merged row', async () => {
  const [out] = await buildRowBandOcrVariants(await rowCrop(244, 94));
  const meta = await sharp(out!).metadata();
  assert.ok(Math.abs(meta.width! / meta.height! - 244 / 94) < 0.05);
});
