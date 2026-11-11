import sharp, { type Sharp } from 'sharp';
import {
  DEFAULT_ADAPTIVE_THRESHOLD_PARAMS,
  resolveAdaptiveBlockSize,
  type AdaptiveThresholdParams,
  type AdaptiveThresholdVariantParams,
} from '../domain/adaptiveThresholdParams.js';

export type AdaptiveThresholdOptions = AdaptiveThresholdVariantParams & {
  geometry?: Partial<AdaptiveThresholdParams>;
};

const DEFAULTS = DEFAULT_ADAPTIVE_THRESHOLD_PARAMS.variants;

/**
 * Local mean adaptive threshold — handles uneven lighting on curved labels better than a global cutoff.
 */
export async function adaptiveThresholdPng(
  pipeline: Sharp,
  options?: AdaptiveThresholdOptions,
): Promise<Buffer> {
  const meta = await pipeline.clone().metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const variant: AdaptiveThresholdVariantParams =
    options?.blockSizeFraction !== undefined
      ? { blockSizeFraction: options.blockSizeFraction, c: options.c ?? DEFAULTS[0]!.c }
      : DEFAULTS[0]!;
  const blockSize = resolveAdaptiveBlockSize(
    width,
    height,
    variant.blockSizeFraction,
    options?.geometry?.minOddBlockSize,
  );

  const { data, info } = await pipeline
    .clone()
    .greyscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const binary = adaptiveMeanThreshold(new Uint8Array(data), info.width, info.height, blockSize, variant.c);
  return sharp(binary, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
}

/** Standard preprocessors plus adaptive threshold variants for OCR scoring. */
export async function adaptiveThresholdVariants(pipeline: Sharp): Promise<Buffer[]> {
  const prepped = pipeline.clone().greyscale().normalize();
  const meta = await prepped.metadata();
  const width = meta.width ?? 1;
  const height = meta.height ?? 1;
  const buffers: Buffer[] = [];
  for (const variant of DEFAULT_ADAPTIVE_THRESHOLD_PARAMS.variants) {
    const blockSize = resolveAdaptiveBlockSize(width, height, variant.blockSizeFraction);
    buffers.push(
      await thresholdPreppedGreyscale(prepped, width, height, blockSize, variant.c),
    );
  }
  return buffers;
}

async function thresholdPreppedGreyscale(
  prepped: Sharp,
  width: number,
  height: number,
  blockSize: number,
  c: number,
): Promise<Buffer> {
  const { data, info } = await prepped.clone().raw().toBuffer({ resolveWithObject: true });
  const binary = adaptiveMeanThreshold(new Uint8Array(data), info.width, info.height, blockSize, c);
  return sharp(binary, { raw: { width, height, channels: 1 } }).png().toBuffer();
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

export { resolveAdaptiveBlockSize } from '../domain/adaptiveThresholdParams.js';

function adaptiveMeanThreshold(
  pixels: Uint8Array,
  width: number,
  height: number,
  blockSize: number,
  c: number,
): Buffer {
  const oddBlock = blockSize % 2 === 0 ? blockSize + 1 : blockSize;
  const half = Math.floor(oddBlock / 2);
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
