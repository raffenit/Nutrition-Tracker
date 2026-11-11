import sharp from 'sharp';

/** Shared nutrient-name column + N ruled value columns. */
export type SharedLabelGridSpec = {
  labelFraction: number;
  count: number;
  columnFraction: number;
  gutterFraction: number;
};

export const DEFAULT_SHARED_LABEL_GRID: SharedLabelGridSpec = {
  labelFraction: 0.2,
  count: 5,
  columnFraction: 0.1,
  gutterFraction: 0.025,
};

/** Equal product columns from the left edge — each column carries label + values (no shared rail). */
export type PerColumnLabelGridSpec = {
  count: number;
  gutterFraction: number;
};

export const DEFAULT_PER_COLUMN_LABEL_GRID: PerColumnLabelGridSpec = {
  count: 5,
  gutterFraction: 0.025,
};

export function paintSharedLabelGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  spec: SharedLabelGridSpec = DEFAULT_SHARED_LABEL_GRID,
  ink = 30,
  background = 250,
): void {
  pixels.fill(background);
  const labelWidth = Math.round(width * spec.labelFraction);
  for (let y = Math.round(height * 0.12); y < height * 0.88; y += 1) {
    for (let x = 0; x < labelWidth; x += 1) {
      pixels[y * width + x] = ink;
    }
  }
  let x = labelWidth + Math.round(width * spec.gutterFraction);
  const colW = Math.round(width * spec.columnFraction);
  const gutterW = Math.round(width * spec.gutterFraction);
  const ruleInk = Math.min(255, ink + 50);
  for (let i = 0; i < spec.count; i += 1) {
    const colX0 = x;
    for (let y = Math.round(height * 0.18); y < height * 0.88; y += 1) {
      for (let cx = x; cx < x + colW && cx < width; cx += 1) {
        pixels[y * width + cx] = ink;
      }
    }
    for (let rule = 0; rule < 8; rule += 1) {
      const ry = Math.round(height * (0.22 + rule * 0.07));
      for (let cx = colX0 + 2; cx < colX0 + colW - 2 && cx < width; cx += 1) {
        pixels[ry * width + cx] = ruleInk;
      }
    }
    x += colW + gutterW;
  }
}

export async function syntheticSharedLabelGridPng(
  width: number,
  height: number,
  spec: SharedLabelGridSpec = DEFAULT_SHARED_LABEL_GRID,
): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  paintSharedLabelGrid(pixels, width, height, spec);
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export function paintPerColumnLabelGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  spec: PerColumnLabelGridSpec = DEFAULT_PER_COLUMN_LABEL_GRID,
  ink = 28,
  background = 245,
  ruleInk = 90,
): void {
  pixels.fill(background);
  const gutter = Math.max(2, Math.round(width * spec.gutterFraction));
  const colW = Math.max(
    8,
    Math.round((width - gutter * Math.max(0, spec.count - 1)) / spec.count),
  );
  let x = 0;
  for (let column = 0; column < spec.count; column += 1) {
    const x0 = x;
    const x1 = Math.min(width, x + colW);
    for (let y = Math.round(height * 0.12); y < Math.round(height * 0.9); y += 1) {
      for (let cx = x0; cx < x1; cx += 1) {
        pixels[y * width + cx] = ink;
      }
    }
    for (let rule = 0; rule < 8; rule += 1) {
      const ry = Math.round(height * (0.18 + rule * 0.07));
      for (let cx = x0 + 1; cx < x1 - 1; cx += 1) {
        pixels[ry * width + cx] = ruleInk;
      }
    }
    x = x1 + gutter;
  }
}

export async function syntheticPerColumnLabelGridPng(
  width: number,
  height: number,
  spec: PerColumnLabelGridSpec = DEFAULT_PER_COLUMN_LABEL_GRID,
): Promise<Buffer> {
  const pixels = new Uint8Array(width * height);
  paintPerColumnLabelGrid(pixels, width, height, spec);
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}
