import { parseNutritionLabel } from './parseLabel.js';
import { scoreLabelExtraction } from './labelSlots.js';

/** Merge left/right OCR of one label photographed as two vertical halves. */
export function stitchSplitLabelHalves(leftText: string, rightText: string): string | null {
  const left = leftText.trim();
  const right = rightText.trim();
  if (!left || !right) return null;
  const merged = `${left}\n${right}`;
  if (!/nutrition\s+facts/i.test(merged)) return null;
  const scored = scoreLabelExtraction(merged);
  if (scored < 1) return null;
  const parsed = parseNutritionLabel(merged);
  if (!parsed.looksLikeLabel && scored < 8) return null;
  return merged;
}
