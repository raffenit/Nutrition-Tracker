/** Reference upscale width used when tuning default adaptive-threshold neighborhood sizes. */
export const OCR_PREPROCESS_REFERENCE_MIN_SIDE = 2200;

export type AdaptiveThresholdVariantParams = {
  /** Local window diameter as a fraction of min(image width, image height). */
  blockSizeFraction: number;
  /** Subtracted from local mean (0–255 scale; not tied to DPI). */
  c: number;
};

export type AdaptiveThresholdParams = {
  variants: AdaptiveThresholdVariantParams[];
  /** Smallest odd block size after scaling (pixels). */
  minOddBlockSize: number;
};

export const DEFAULT_ADAPTIVE_THRESHOLD_PARAMS: AdaptiveThresholdParams = {
  variants: [
    { blockSizeFraction: 35 / OCR_PREPROCESS_REFERENCE_MIN_SIDE, c: 8 },
    { blockSizeFraction: 21 / OCR_PREPROCESS_REFERENCE_MIN_SIDE, c: 5 },
  ],
  minOddBlockSize: 3,
};

export function resolveAdaptiveBlockSize(
  width: number,
  height: number,
  blockSizeFraction: number,
  minOddBlockSize = DEFAULT_ADAPTIVE_THRESHOLD_PARAMS.minOddBlockSize,
): number {
  const minSide = Math.min(width, height);
  let block = Math.max(minOddBlockSize, Math.round(minSide * blockSizeFraction));
  if (block % 2 === 0) block += 1;
  return block;
}
