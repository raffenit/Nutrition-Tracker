import type { Nutrients } from './types';

export type CoreNutrientKey = 'calories' | 'protein' | 'fiber' | 'fat' | 'carbs' | 'sodium';

export type CoreNutrientUnits = {
  calories: 'kcal';
  protein: 'g' | 'mg';
  fiber: 'g' | 'mg';
  fat: 'g' | 'mg';
  carbs: 'g' | 'mg';
  sodium: 'mg' | 'g';
};

export const DEFAULT_CORE_NUTRIENT_UNITS: CoreNutrientUnits = {
  calories: 'kcal',
  protein: 'g',
  fiber: 'g',
  fat: 'g',
  carbs: 'g',
  sodium: 'mg',
};

export const CORE_UNIT_OPTIONS: Record<CoreNutrientKey, readonly string[]> = {
  calories: ['kcal'],
  protein: ['g', 'mg'],
  fiber: ['g', 'mg'],
  fat: ['g', 'mg'],
  carbs: ['g', 'mg'],
  sodium: ['mg', 'g'],
};

export function displayCoreNutrients(
  canonical: Pick<Nutrients, CoreNutrientKey>,
  units: CoreNutrientUnits,
): Pick<Nutrients, CoreNutrientKey> {
  return {
    calories: canonical.calories,
    protein: fromGrams(canonical.protein, units.protein),
    fiber: fromGrams(canonical.fiber, units.fiber),
    fat: fromGrams(canonical.fat, units.fat),
    carbs: fromGrams(canonical.carbs, units.carbs),
    sodium: fromMilligrams(canonical.sodium, units.sodium),
  };
}

export function canonicalizeCoreNutrients(
  amounts: Pick<Nutrients, CoreNutrientKey>,
  units: CoreNutrientUnits,
): Pick<Nutrients, CoreNutrientKey> {
  return {
    calories: amounts.calories,
    protein: toGrams(amounts.protein, units.protein),
    fiber: toGrams(amounts.fiber, units.fiber),
    fat: toGrams(amounts.fat, units.fat),
    carbs: toGrams(amounts.carbs, units.carbs),
    sodium: toMilligrams(amounts.sodium, units.sodium),
  };
}

function toGrams(value: number, unit: 'g' | 'mg'): number {
  return unit === 'mg' ? value / 1000 : value;
}

function fromGrams(value: number, unit: 'g' | 'mg'): number {
  return unit === 'mg' ? value * 1000 : value;
}

function toMilligrams(value: number, unit: 'g' | 'mg'): number {
  return unit === 'g' ? value * 1000 : value;
}

function fromMilligrams(value: number, unit: 'g' | 'mg'): number {
  return unit === 'g' ? value / 1000 : value;
}
