import type { FocusCropRect } from './focusCrop.js';
import { prepareWideBandAnalysis } from './labelColumnStrips.js';

/**
 * Vertical band + ink-row envelope (same path as variety-pack column-strip detection).
 * Works on tall portrait singles and wide Costco tables after {@link resolveLabelProcessingImage}.
 */
export async function wideBandInkEnvelopeCropRect(bytes: Buffer): Promise<FocusCropRect | null> {
  const analysis = await prepareWideBandAnalysis(bytes, undefined, 'detection');
  if (!analysis) return null;
  const { band } = analysis;
  if (band.width < 48 || band.height < 48) return null;
  return {
    left: band.left,
    top: band.top,
    width: band.width,
    height: band.height,
  };
}