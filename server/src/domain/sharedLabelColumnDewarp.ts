import type { SharedLabelRowBandSlice } from './sharedLabelGridLayout.js';

export type GreyImage = { data: Uint8Array; width: number; height: number };

export type DewarpedColumnRows = {
  /** Greyscale pixels, rows stacked in canonical order. */
  pixels: Uint8Array;
  width: number;
  height: number;
  /** Output y-offset and height of each canonical row inside {@link pixels}. */
  rowTops: number[];
  rowHeights: number[];
};

function sampleBilinear(data: Uint8Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const top = data[y0 * width + x0]! * (1 - fx) + data[y0 * width + Math.min(width - 1, x0 + 1)]! * fx;
  const bottom = data[y1 * width + x0]! * (1 - fx) + data[y1 * width + Math.min(width - 1, x0 + 1)]! * fx;
  return Math.round(top * (1 - fy) + bottom * fy);
}

/**
 * Rectify a curved-pack column into straight canonical rows.
 *
 * Each slice is a quad: left edge runs slice.top → slice.top + slice.height,
 * right edge is offset by topSkewPx / bottomSkewPx. Output stacks the rows
 * vertically at their measured heights so downstream row alignment is exact.
 * Returns null when no slice carries measurable skew (flat column — caller
 * should use the original crop).
 */
export function dewarpColumnToRowMesh(
  image: GreyImage,
  slices: SharedLabelRowBandSlice[],
  originY: number,
  minSkewPx = 2,
): DewarpedColumnRows | null {
  if (slices.length === 0) return null;
  const maxSkew = Math.max(
    ...slices.map((s) => Math.max(Math.abs(s.topSkewPx ?? 0), Math.abs(s.bottomSkewPx ?? 0))),
  );
  if (maxSkew < minSkewPx) return null;

  const width = image.width;
  const rowHeights = slices.map((s) => Math.max(1, Math.round(s.height)));
  const rowTops: number[] = [];
  let cursor = 0;
  for (const h of rowHeights) {
    rowTops.push(cursor);
    cursor += h;
  }
  const height = cursor;
  const out = new Uint8Array(width * height).fill(255);

  for (let row = 0; row < slices.length; row += 1) {
    const slice = slices[row]!;
    const top = slice.top - originY;
    const h = slice.height;
    const topSkew = slice.topSkewPx ?? 0;
    const bottomSkew = slice.bottomSkewPx ?? 0;
    const outTop = rowTops[row]!;
    const outH = rowHeights[row]!;
    for (let y = 0; y < outH; y += 1) {
      const t = outH === 1 ? 0 : y / (outH - 1);
      const syLeft = top + t * h;
      const skewAtT = topSkew + t * (bottomSkew - topSkew);
      const outY = outTop + y;
      for (let x = 0; x < width; x += 1) {
        const sy = syLeft + (skewAtT * x) / Math.max(1, width - 1);
        out[outY * width + x] = sampleBilinear(image.data, width, image.height, x, sy);
      }
    }
  }
  return { pixels: out, width, height, rowTops, rowHeights };
}
