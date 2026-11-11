/** Nearest-neighbor resize of a greyscale band (used to mirror Sharp resize in unit tests). */
export function resampleGreyscaleNearest(
  pixels: Uint8Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const out = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.floor((y / targetHeight) * height));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.floor((x / targetWidth) * width));
      out[y * targetWidth + x] = pixels[srcY * width + srcX]!;
    }
  }
  return out;
}

export function bandToAnalysisSize(
  bandWidth: number,
  bandHeight: number,
  analysisWidth: number,
  minAnalysisWidthFraction: number,
  minAnalysisHeightFraction: number,
): { analysisW: number; analysisH: number; scale: number } {
  const scale = bandWidth > analysisWidth ? analysisWidth / bandWidth : 1;
  const floorW = Math.max(1, Math.round(analysisWidth * minAnalysisWidthFraction));
  const floorH = Math.max(1, Math.round(analysisWidth * minAnalysisHeightFraction));
  const analysisW = Math.max(floorW, Math.round(bandWidth * scale));
  const analysisH = Math.max(floorH, Math.round(bandHeight * scale));
  return { analysisW, analysisH, scale };
}
