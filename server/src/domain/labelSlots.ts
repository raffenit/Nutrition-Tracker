import type { Nutrients } from '../types.js';
import { parseNutritionLabel } from './parseLabel.js';

/** FDA-style label slots: expected unit and plausible per-serving range (not product-specific). */
export const LABEL_NUTRIENT_SLOTS = [
  { key: 'calories' as const, unit: 'kcal', max: 1200 },
  { key: 'fat' as const, unit: 'g', max: 120 },
  { key: 'carbs' as const, unit: 'g', max: 200 },
  { key: 'fiber' as const, unit: 'g', max: 50 },
  { key: 'protein' as const, unit: 'g', max: 100 },
  { key: 'sodium' as const, unit: 'mg', max: 4000 },
] as const;

export function nutrientSlotConfidence(nutrients: Nutrients): number {
  let points = 0;
  for (const slot of LABEL_NUTRIENT_SLOTS) {
    const value = nutrients[slot.key];
    if (value <= 0) continue;
    if (value > slot.max * 2) points -= 2;
    else if (value <= slot.max) points += 1;
  }
  for (const extra of nutrients.extras) {
    if (extra.amount <= 0) continue;
    const unit = extra.unit.toLowerCase();
    if (unit === 'g' && extra.amount > 100) points -= 1;
    if (unit === 'mg' && extra.amount > 5000) points -= 1;
    else points += 0.5;
  }
  return points;
}

/** Pick the best OCR variant: heading + filled slots + values in expected ranges. */
export function scoreLabelExtraction(text: string): number {
  const parsed = parseNutritionLabel(text);
  const n = parsed.nutrients;
  let score = 0;
  if (/nutrition facts/i.test(text)) score += 8;
  if (n.calories > 0) score += 4;
  if (n.protein > 0) score += 2;
  if (n.fat > 0) score += 2;
  if (n.carbs > 0) score += 2;
  if (n.fiber > 0) score += 1;
  if (n.sodium > 0) score += 1;
  if (parsed.servingLabel) score += 2;
  if (parsed.servingsPerContainer != null && parsed.servingsPerContainer > 0) score += 1;
  score += nutrientSlotConfidence(n);
  if (/\d\s*g\b/i.test(text)) score += 1;
  if (/\d\s*mg\b/i.test(text)) score += 1;
  return score;
}
