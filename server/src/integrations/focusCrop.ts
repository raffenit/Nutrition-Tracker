import type { Sharp } from 'sharp';

const ANALYSIS_WIDTH = 640;

/** Vertical + horizontal crops biased toward the sharpest region (depth-of-field). */
export async function focusCropVariants(source: Sharp): Promise<Sharp[]> {
  const variants: Sharp[] = [];
  const meta = await source.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 80 || height < 80) return variants;

  variants.push(centerBandCrop(source, width, height, 0.62, 0.88));

  const guided = await laplacianBandCrop(source, width, height);
  if (guided) variants.push(guided);

  return variants;
}

function centerBandCrop(
  source: Sharp,
  width: number,
  height: number,
  heightFraction: number,
  widthFraction: number,
): Sharp {
  const cropH = Math.max(32, Math.round(height * heightFraction));
  const cropW = Math.max(32, Math.round(width * widthFraction));
  const top = Math.max(0, Math.round((height - cropH) / 2));
  const left = Math.max(0, Math.round((width - cropW) / 2));
  return source.clone().extract({ left, top, width: cropW, height: cropH });
}

async function laplacianBandCrop(
  source: Sharp,
  fullWidth: number,
  fullHeight: number,
): Promise<Sharp | null> {
  const scale = fullWidth > ANALYSIS_WIDTH ? ANALYSIS_WIDTH / fullWidth : 1;
  const analysisW = Math.max(32, Math.round(fullWidth * scale));
  const analysisH = Math.max(32, Math.round(fullHeight * scale));

  const { data } = await source
    .clone()
    .resize({ width: analysisW, height: analysisH, fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
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

  const bandRows = Math.max(8, Math.round(analysisH * 0.55));
  let bestStart = 0;
  let bestTotal = -1;
  for (let start = 0; start <= analysisH - bandRows; start += 1) {
    let total = 0;
    for (let y = start; y < start + bandRows; y += 1) total += rowScore[y]!;
    if (total > bestTotal) {
      bestTotal = total;
      bestStart = start;
    }
  }

  const margin = Math.round(analysisH * 0.04);
  const y1 = Math.max(0, bestStart - margin);
  const y2 = Math.min(analysisH, bestStart + bandRows + margin);
  const top = Math.round((y1 / analysisH) * fullHeight);
  const cropH = Math.max(32, Math.round(((y2 - y1) / analysisH) * fullHeight));
  const cropW = Math.max(32, Math.round(fullWidth * 0.9));
  const left = Math.round((fullWidth - cropW) / 2);

  if (cropH >= fullHeight * 0.95 && cropW >= fullWidth * 0.95) return null;

  return source.clone().extract({
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.min(cropW, fullWidth - left),
    height: Math.min(cropH, fullHeight - top),
  });
}
