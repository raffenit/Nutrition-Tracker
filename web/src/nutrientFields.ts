import type { CoreNutrientUnits } from './nutrientUnits';
import { CORE_UNIT_OPTIONS, type CoreNutrientKey } from './nutrientUnits';
import type { Nutrients } from './types';

export type { CoreNutrientKey };

export const CORE_NUTRIENT_FIELDS: Array<{ key: CoreNutrientKey; label: string; step: string }> = [
  { key: 'calories', label: 'Calories', step: '1' },
  { key: 'fat', label: 'Fat', step: '0.1' },
  { key: 'carbs', label: 'Carbohydrate', step: '0.1' },
  { key: 'fiber', label: 'Dietary fiber', step: '0.1' },
  { key: 'protein', label: 'Protein', step: '0.1' },
  { key: 'sodium', label: 'Sodium', step: '1' },
];

export function unitOptionsFor(key: CoreNutrientKey): readonly string[] {
  return CORE_UNIT_OPTIONS[key];
}

export function setCoreNutrient(nutrients: Nutrients, key: CoreNutrientKey, value: number): Nutrients {
  return { ...nutrients, [key]: value };
}

export function setCoreUnit(units: CoreNutrientUnits, key: CoreNutrientKey, unit: string): CoreNutrientUnits {
  return { ...units, [key]: unit } as CoreNutrientUnits;
}

export function setExtraAt(nutrients: Nutrients, index: number, amount: number): Nutrients {
  const extras = nutrients.extras.map((extra, i) => (i === index ? { ...extra, amount } : extra));
  return { ...nutrients, extras };
}

export function setExtraUnitAt(nutrients: Nutrients, index: number, unit: string): Nutrients {
  const extras = nutrients.extras.map((extra, i) => (i === index ? { ...extra, unit } : extra));
  return { ...nutrients, extras };
}

export function removeExtraAt(nutrients: Nutrients, index: number): Nutrients {
  return { ...nutrients, extras: nutrients.extras.filter((_, i) => i !== index) };
}

/** Nutrition Facts rows beyond the core six, with the keys and units label import uses. */
export const LABEL_EXTRA_NUTRIENTS: ReadonlyArray<{ key: string; label: string; unit: string }> = [
  { key: 'saturated_fat', label: 'Saturated fat', unit: 'g' },
  { key: 'trans_fat', label: 'Trans fat', unit: 'g' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
  { key: 'sugar', label: 'Total sugars', unit: 'g' },
  { key: 'added_sugars', label: 'Added sugars', unit: 'g' },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'mcg' },
  { key: 'calcium', label: 'Calcium', unit: 'mg' },
  { key: 'iron', label: 'Iron', unit: 'mg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' },
];

export function missingLabelExtras(nutrients: Nutrients): Array<{ key: string; label: string; unit: string }> {
  const present = new Set(nutrients.extras.map((extra) => extra.key));
  return LABEL_EXTRA_NUTRIENTS.filter((extra) => !present.has(extra.key));
}

export function addLabelExtra(nutrients: Nutrients, key: string): Nutrients {
  const spec = LABEL_EXTRA_NUTRIENTS.find((extra) => extra.key === key);
  if (!spec || nutrients.extras.some((extra) => extra.key === key)) return nutrients;
  return { ...nutrients, extras: [...nutrients.extras, { ...spec, amount: 0 }] };
}
