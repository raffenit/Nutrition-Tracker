import { parseNutritionLabel } from './parseLabel.js';

/** Split OCR/PDF text that contains multiple Nutrition Facts panels. */
export function splitNutritionLabelTexts(fullText: string): string[] {
  const text = fullText.replace(/\r\n/g, '\n');
  const pattern = /nutrition\s+facts/gi;
  const anchors: number[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index !== undefined) anchors.push(match.index);
  }
  if (anchors.length <= 1) return [text];
  const blocks: string[] = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const start = anchors[index]!;
    const end = index + 1 < anchors.length ? anchors[index + 1]! : text.length;
    const block = text.slice(start, end).trim();
    if (block.length >= 24) blocks.push(block);
  }
  return blocks.length > 0 ? blocks : [text];
}

export function blocksLookLikeSeparateLabels(blocks: string[]): boolean {
  if (blocks.length <= 1) return false;
  let labelLike = 0;
  for (const block of blocks) {
    const parsed = parseNutritionLabel(block);
    if (parsed.looksLikeLabel || /nutrition\s+facts/i.test(block)) labelLike += 1;
  }
  return labelLike >= 2;
}

/** Collect label-sized text blocks from one or more PDF pages / OCR blobs. */
export function collectLabelPanelBlocks(parts: string[]): string[] {
  const blocks: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    for (const block of splitNutritionLabelTexts(trimmed)) {
      if (block.length < 24) continue;
      const parsed = parseNutritionLabel(block);
      if (parsed.looksLikeLabel || /nutrition\s+facts/i.test(block)) blocks.push(block);
    }
  }
  return blocks;
}

/** Split text-layer PDF extract into pages when the parser inserted form feeds. */
export function splitEmbeddedPdfPages(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const byFormFeed = normalized.split(/\f+/).map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0);
  if (byFormFeed.length > 1) return byFormFeed;
  return [normalized.trim()].filter((chunk) => chunk.length > 0);
}
