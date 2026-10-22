import sharp, { type Sharp } from 'sharp';

export type AdaptiveThresholdOptions = {
  /** Odd-sized neighborhood side length (pixels). */
  blockSize: number;
  /** Subtracted from local mean (OpenCV-style constant C). */
  c: number;
};

const DEFAULTS: AdaptiveThresholdOptions[] = [
  { blockSize: 35, c: 8 },
  { blockSize: 21, c: 5 },
];

/**
 * Local mean adaptive threshold — handles uneven lighting on curved labels better than a global cutoff.
 */
export async function adaptiveThresholdPng(
  pipeline: Sharp,
  options: AdaptiveThresholdOptions = DEFAULTS[0]!,
): Promise<Buffer> {
  const blockSize = options.blockSize % 2 === 0 ? options.blockSize + 1 : options.blockSize;
  const { data, info } = await pipeline
    .clone()
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const binary = adaptiveMeanThreshold(new Uint8Array(data), info.width, info.height, blockSize, options.c);
  return sharp(binary, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
}

/** Standard preprocessors plus adaptive threshold variants for OCR scoring. */
export async function adaptiveThresholdVariants(pipeline: Sharp): Promise<Buffer[]> {
  const prepped = pipeline.clone().greyscale().normalize();
  const buffers: Buffer[] = [];
  for (const options of DEFAULTS) {
    buffers.push(await adaptiveThresholdPng(prepped, options));
  }
  return buffers;
}

/** Exported for unit tests (synthetic gradients without Sharp normalize). */
export function adaptiveMeanThresholdForTest(
  pixels: Uint8Array,
  width: number,
  height: number,
  blockSize: number,
  c: number,
): Uint8Array {
  return new Uint8Array(adaptiveMeanThreshold(pixels, width, height, blockSize, c));
}

function adaptiveMeanThreshold(
  pixels: Uint8Array,
  width: number,
  height: number,
  blockSize: number,
  c: number,
): Buffer {
  const half = Math.floor(blockSize / 2);
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += pixels[y * width + x]!;
      const above = integral[y * stride + (x + 1)]!;
      integral[(y + 1) * stride + (x + 1)] = rowSum + above;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const x1 = Math.max(0, x - half);
      const y1 = Math.max(0, y - half);
      const x2 = Math.min(width - 1, x + half);
      const y2 = Math.min(height - 1, y + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = rectSum(integral, stride, x1, y1, x2, y2);
      const threshold = sum / count - c;
      const pixel = pixels[y * width + x]!;
      out[y * width + x] = pixel <= threshold ? 0 : 255;
    }
  }
  return Buffer.from(out);
}

function rectSum(integral: Float64Array, stride: number, x1: number, y1: number, x2: number, y2: number): number {
  const a = integral[(y2 + 1) * stride + (x2 + 1)]!;
  const b = integral[y1 * stride + (x2 + 1)]!;
  const d = integral[y1 * stride + x1]!;
  const e = integral[(y2 + 1) * stride + x1]!;
  return a - b - e + d;
}
