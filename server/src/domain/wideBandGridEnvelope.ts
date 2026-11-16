import type { ColumnStripDetectParams } from './columnStripDetectParams.js';

/** Rows whose summed edge energy exceeds this fraction of the peak count as table ink. */
export type InkRowEnvelopeParams = {
  inkRowThresholdPeakFraction: number;
  /** Pad above/below detected ink rows as a fraction of band height (analysis space). */
  inkRowEnvelopeMarginFraction: number;
};

export const DEFAULT_INK_ROW_ENVELOPE_PARAMS: InkRowEnvelopeParams = {
  inkRowThresholdPeakFraction: 0.22,
  inkRowEnvelopeMarginFraction: 6 / 640,
};

/**
 * Vertical extent of ruled/printed content inside a greyscale analysis band.
 * Returns analysis-space y indices [y0, y1] inclusive.
 */
export function inkRowEnvelopeInGreyBand(
  pixels: Uint8Array,
  analysisW: number,
  analysisH: number,
  envelope: InkRowEnvelopeParams = DEFAULT_INK_ROW_ENVELOPE_PARAMS,
): { y0: number; y1: number } | null {
  if (analysisW < 4 || analysisH < 4) return null;
  const rowScore = new Float64Array(analysisH);
  for (let y = 1; y < analysisH - 1; y += 1) {
    let sum = 0;
    for (let x = 1; x < analysisW - 1; x += 1) {
      const index = y * analysisW + x;
      const gx = Math.abs(pixels[index + 1]! - pixels[index - 1]!);
      const gy = Math.abs(pixels[index + analysisW]! - pixels[index - analysisW]!);
      sum += gx + gy;
    }
    rowScore[y] = sum / analysisW;
  }
  const peak = rowScore.reduce((best, v) => Math.max(best, v), 0);
  if (peak <= 0) return null;
  const level = peak * envelope.inkRowThresholdPeakFraction;
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < analysisH; y += 1) {
    if (rowScore[y]! < level) continue;
    if (y0 < 0) y0 = y;
    y1 = y;
  }
  if (y0 < 0 || y1 <= y0) return null;
  const margin = Math.max(2, Math.round(analysisH * envelope.inkRowEnvelopeMarginFraction));
  return {
    y0: Math.max(0, y0 - margin),
    y1: Math.min(analysisH - 1, y1 + margin),
  };
}

/** Expand an image-space band rect to cover analysis ink rows (with margin), clamped to the image. */
export function expandImageBandToInkEnvelope(
  band: { left: number; top: number; width: number; height: number },
  fullHeight: number,
  envelope: { y0: number; y1: number },
  analysisH: number,
  stripParams: Pick<ColumnStripDetectParams, 'minBandHeightFloorFraction' | 'bandHeightFraction'>,
  inkEnvelope: InkRowEnvelopeParams = DEFAULT_INK_ROW_ENVELOPE_PARAMS,
): { left: number; top: number; width: number; height: number } {
  const mapY = (analysisY: number) =>
    band.top + Math.round((analysisY / Math.max(1, analysisH)) * band.height);
  let top = mapY(envelope.y0);
  let bottom = mapY(envelope.y1) + 1;
  const marginPx = Math.max(4, Math.round(fullHeight * inkEnvelope.inkRowEnvelopeMarginFraction));
  top = Math.max(0, top - marginPx);
  bottom = Math.min(fullHeight, bottom + marginPx);
  const minH = Math.max(
    Math.round(fullHeight * stripParams.minBandHeightFloorFraction),
    Math.round(fullHeight * stripParams.bandHeightFraction),
  );
  let height = bottom - top;
  if (height < minH) {
    const extra = minH - height;
    top = Math.max(0, top - Math.floor(extra / 2));
    bottom = Math.min(fullHeight, top + minH);
    top = Math.max(0, bottom - minH);
    height = bottom - top;
  }
  return { left: band.left, top, width: band.width, height };
}