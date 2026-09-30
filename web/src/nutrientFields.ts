import type { Nutrients } from './types';

export type CoreNutrientKey = 'calories' | 'protein' | 'fiber' | 'fat' | 'carbs' | 'sodium';

export const CORE_NUTRIENT_FIELDS: Array<{ key: CoreNutrientKey; label: string; unit: string; step: string }> = [
  { key: 'calories', label: 'Calories', unit: 'kcal', step: '1' },
  { key: 'fat', label: 'Fat', unit: 'g', step: '0.1' },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g', step: '0.1' },
  { key: 'fiber', label: 'Dietary fiber', unit: 'g', step: '0.1' },
  { key: 'protein', label: 'Protein', unit: 'g', step: '0.1' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', step: '1' },
];

export function setCoreNutrient(nutrients: Nutrients, key: CoreNutrientKey, value: number): Nutrients {
  return { ...nutrients, [key]: value };
}

export function setExtraAt(nutrients: Nutrients, index: number, amount: number): Nutrients {
  const extras = nutrients.extras.map((extra, i) => (i === index ? { ...extra, amount } : extra));
  return { ...nutrients, extras };
}

export function removeExtraAt(nutrients: Nutrients, index: number): Nutrients {
  return { ...nutrients, extras: nutrients.extras.filter((_, i) => i !== index) };
}
