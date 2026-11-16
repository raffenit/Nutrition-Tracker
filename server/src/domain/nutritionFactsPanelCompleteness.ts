import { parseNutritionLabel } from './parseLabel.js';
import { scoreLabelExtraction } from './labelSlots.js';
const MIN_LABEL_SCORE_FOR_COMPLETENESS = 10;

export type NutritionFactsPanelCompleteness = {
  complete: boolean;
  score: number;
  missing: string[];
};

/** FDA-style heading plus the top of the macro block (catches vertical crops that start at Saturated Fat). */
export function assessNutritionFactsPanelCompleteness(text: string): NutritionFactsPanelCompleteness {
  const compact = text.replace(/\s+/g, ' ').trim();
  const missing: string[] = [];
  const hasHeading =
    /nutrition\s*facts|nutrition\s*racts|nutrition\s+values|amount\s+per/i.test(compact);
  if (!hasHeading) missing.push('heading');

  const parsed = parseNutritionLabel(text);
  const hasCalories =
    parsed.nutrients.calories > 0 || /\bcalories\b[^0-9\n]{0,24}\d{2,4}\b/i.test(compact);
  if (!hasCalories) missing.push('calories');

  const hasTotalFat = /total\s*fat\b/i.test(compact) || parsed.nutrients.fat > 0;
  if (!hasTotalFat) missing.push('total_fat');

  const score = scoreLabelExtraction(text);
  const complete = missing.length === 0 && score >= MIN_LABEL_SCORE_FOR_COMPLETENESS;
  return { complete, score, missing };
}

export function nutritionFactsPanelLooksComplete(text: string): boolean {
  return assessNutritionFactsPanelCompleteness(text).complete;
}