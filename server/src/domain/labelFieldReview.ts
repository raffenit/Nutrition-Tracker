import { likelyServingsPerContainerHeader, likelyServingSizeHeader } from './labelHeaderParse.js';
import { findVariantLabelAnchors, type VariantLabelSlot } from './labelVariants.js';
import type { LabelParse } from './parseLabel.js';

export type ImportFieldStatus = 'ok' | 'missing' | 'review';

export type ImportFieldReviewEntry = {
  status: ImportFieldStatus;
  reason: string;
};

/** Keys: core nutrient names, extra keys (cholesterol, sugar, …), servingLabel, servingsPerContainer. */
export type LabelFieldReviewMap = Record<string, ImportFieldReviewEntry>;

const CORE: Array<{ key: keyof LabelParse['nutrients']; slot: VariantLabelSlot }> = [
  { key: 'calories', slot: 'calories' },
  { key: 'fat', slot: 'total_fat' },
  { key: 'carbs', slot: 'total_carb' },
  { key: 'fiber', slot: 'fiber' },
  { key: 'protein', slot: 'protein' },
  { key: 'sodium', slot: 'sodium' },
];

const EXTRA_ROWS: Array<{ key: string; slot: VariantLabelSlot; label: string }> = [
  { key: 'saturated_fat', slot: 'saturated_fat', label: 'Saturated fat' },
  { key: 'cholesterol', slot: 'cholesterol', label: 'Cholesterol' },
  { key: 'sugar', slot: 'sugars', label: 'Total sugars' },
];

/** After label import: which form fields need a human look. */
export function assessLabelFieldReview(text: string, parsed: LabelParse): LabelFieldReviewMap {
  const review: LabelFieldReviewMap = {};
  const looksLikeLabel = parsed.looksLikeLabel || /nutrition facts/i.test(text);
  if (!looksLikeLabel) return review;

  for (const { key, slot } of CORE) {
    const value = parsed.nutrients[key];
    if (typeof value !== 'number') continue;
    if (value > 0) continue;
    if (findVariantLabelAnchors(text, slot).length > 0) {
      review[key] = {
        status: 'missing',
        reason: 'This row appears in the scan but no value was read.',
      };
    }
  }

  if (parsed.nutrients.calories > 0 && caloriesMergedWithDailyValueColumn(text)) {
    review.calories = {
      status: 'review',
      reason:
        'OCR may have merged calories with a daily-value column (e.g. 152/22). Check against the label — often 150, not 152.',
    };
  }

  if (parsed.nutrients.calories > 0 && !Number.isInteger(parsed.nutrients.calories)) {
    review.calories = {
      status: 'review',
      reason: 'Calories on labels are usually whole numbers.',
    };
  }

  if (!parsed.servingLabel && likelyServingSizeHeader(text)) {
    review.servingLabel = {
      status: 'missing',
      reason: 'Serving size appears on the label but was not read.',
    };
  }

  if (parsed.servingsPerContainer == null && likelyServingsPerContainerHeader(text)) {
    review.servingsPerContainer = {
      status: 'missing',
      reason: 'Servings per container appears on the label but was not read.',
    };
  }

  for (const { key, slot, label } of EXTRA_ROWS) {
    const hit = parsed.nutrients.extras.find((row) => row.key === key && row.amount > 0);
    if (hit) continue;
    if (findVariantLabelAnchors(text, slot).length === 0) continue;
    review[key] = {
      status: 'missing',
      reason: `${label} appears in the scan but was not read into the form.`,
    };
  }

  return review;
}

export function caloriesMergedWithDailyValueColumn(text: string): boolean {
  return /\bcalories\b(?!\s+from\s+fat)[^\d]{0,40}\d{2,4}\/\d{1,2}\b/i.test(text);
}
