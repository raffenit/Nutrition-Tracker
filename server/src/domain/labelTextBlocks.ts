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
