import type { SharedLabelGridParams } from './sharedLabelGridParams.js';

function envelopePads(
  bandHeight: number,
  fullWidth: number,
  marginFraction: number,
): { left: number; top: number; right: number; bottom: number } {
  const padLeft = Math.min(14, Math.max(2, Math.round(fullWidth * marginFraction * 0.3)));
  const padTop = Math.min(28, Math.max(6, Math.round(bandHeight * marginFraction * 0.65)));
  const padRight = Math.min(36, Math.max(8, Math.round(fullWidth * marginFraction * 0.55)));
  const padBottom = Math.min(24, Math.max(4, Math.round(bandHeight * marginFraction * 0.4)));
  return { left: padLeft, top: padTop, right: padRight, bottom: padBottom };
}

/** Axis-aligned crop that keeps the shared label rail, product columns, and a small border margin. */
export function sharedLabelGridEnvelopeRect(
  band: { top: number; height: number },
  labelColumn: { left: number; width: number },
  valueColumns: Array<{ left: number; width: number }>,
  fullWidth: number,
  marginFraction: number = 20 / 640,
  gridBoundsImage?: { left: number; right: number },
  fullHeight?: number,
): { left: number; top: number; width: number; height: number } {
  const margin = Math.max(8, Math.round(fullWidth * marginFraction));
  const lastValue = valueColumns[valueColumns.length - 1];
  const stripRight =
    lastValue !== undefined ? lastValue.left + lastValue.width : labelColumn.left + labelColumn.width;
  const imageH = fullHeight ?? band.top + band.height;

  if (gridBoundsImage) {
    const pad = envelopePads(band.height, fullWidth, marginFraction);
    const left = Math.max(0, gridBoundsImage.left - pad.left);
    const right = Math.min(fullWidth, gridBoundsImage.right + pad.right);
    const top = Math.max(0, band.top - pad.top);
    const bottom = Math.min(imageH, band.top + band.height + pad.bottom);
    return {
      left,
      top,
      width: Math.max(16, right - left),
      height: Math.max(16, bottom - top),
    };
  }

  const left = Math.max(0, Math.min(labelColumn.left, stripRight) - margin);
  const right = Math.min(fullWidth, stripRight + margin);
  const pad = envelopePads(band.height, fullWidth, marginFraction);
  const top = Math.max(0, band.top - pad.top);
  const bottom = Math.min(imageH, band.top + band.height + pad.bottom);
  return {
    left,
    top,
    width: Math.max(16, right - left),
    height: Math.max(16, bottom - top),
  };
}

export function envelopeMarginForSharedGrid(shared: SharedLabelGridParams): number {
  return shared.gridEnvelopeMarginImageFraction;
}