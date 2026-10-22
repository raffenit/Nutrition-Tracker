import { HttpError } from '../http/errors.js';
import type { ExtraNutrient, Nutrients } from '../types.js';
import { isRecord, nonNegative, requiredNumber } from './guards.js';

export type CoreNutrientKey = 'calories' | 'protein' | 'fiber' | 'fat' | 'carbs' | 'sodium';

export type CalorieUnit = 'kcal';
export type MassUnit = 'g' | 'mg';

export type CoreNutrientUnits = {
  calories: CalorieUnit;
  protein: MassUnit;
  fiber: MassUnit;
  fat: MassUnit;
  carbs: MassUnit;
  sodium: MassUnit;
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

export function readCoreNutrientUnits(value: unknown): CoreNutrientUnits {
  if (!isRecord(value)) return { ...DEFAULT_CORE_NUTRIENT_UNITS };
  return {
    calories: 'kcal',
    protein: massUnit(value.protein, DEFAULT_CORE_NUTRIENT_UNITS.protein),
    fiber: massUnit(value.fiber, DEFAULT_CORE_NUTRIENT_UNITS.fiber),
    fat: massUnit(value.fat, DEFAULT_CORE_NUTRIENT_UNITS.fat),
    carbs: massUnit(value.carbs, DEFAULT_CORE_NUTRIENT_UNITS.carbs),
    sodium: massUnit(value.sodium, DEFAULT_CORE_NUTRIENT_UNITS.sodium),
  };
}

function massUnit(value: unknown, fallback: MassUnit): MassUnit {
  return value === 'mg' || value === 'g' ? value : fallback;
}

/** Convert user-entered amounts (with units) to canonical storage: kcal, macros in g, sodium in mg. */
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

/** Present canonical DB values in the user's chosen units for forms. */
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

export function readNutrientsWithUnits(value: unknown): { nutrients: Nutrients; units: CoreNutrientUnits } {
  if (!isRecord(value)) throw new HttpError(400, 'Nutrition facts are required');
  const units = readCoreNutrientUnits(value.units);
  const raw = {
    calories: nonNegative(requiredNumber(value.calories, 'Calories'), 'Calories'),
    protein: nonNegative(requiredNumber(value.protein, 'Protein'), 'Protein'),
    fiber: nonNegative(requiredNumber(value.fiber, 'Fiber'), 'Fiber'),
    fat: nonNegative(requiredNumber(value.fat, 'Fat'), 'Fat'),
    carbs: nonNegative(requiredNumber(value.carbs, 'Carbs'), 'Carbs'),
    sodium: nonNegative(requiredNumber(value.sodium, 'Sodium'), 'Sodium'),
  };
  const canonical = canonicalizeCoreNutrients(raw, units);
  return {
    nutrients: { ...canonical, extras: readExtrasWithUnits(value.extras) },
    units,
  };
}

function readExtrasWithUnits(value: unknown): ExtraNutrient[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'Custom nutrients must be a list');
  return value.map(readExtraWithUnit);
}

function readExtraWithUnit(value: unknown): ExtraNutrient {
  if (!isRecord(value)) throw new HttpError(400, 'Each custom nutrient needs a label');
  const unit = typeof value.unit === 'string' && value.unit.trim() ? value.unit.trim() : 'g';
  const amount = nonNegative(requiredNumber(value.amount, 'Amount'), 'Amount');
  return {
    key: typeof value.key === 'string' ? value.key : 'custom',
    label: typeof value.label === 'string' ? value.label : 'Custom',
    amount: canonicalExtraAmount(amount, unit),
    unit: canonicalExtraUnit(unit),
  };
}

function canonicalExtraUnit(unit: string): string {
  const lower = unit.toLowerCase();
  if (lower === 'g' || lower === 'mg' || lower === 'mcg' || lower === 'kcal') return lower;
  return unit;
}

function canonicalExtraAmount(amount: number, unit: string): number {
  const lower = unit.toLowerCase();
  if (lower === 'g') return amount;
  if (lower === 'mg') return amount;
  if (lower === 'mcg') return amount;
  return amount;
}

function toGrams(value: number, unit: MassUnit): number {
  return unit === 'mg' ? value / 1000 : value;
}

function fromGrams(value: number, unit: MassUnit): number {
  return unit === 'mg' ? value * 1000 : value;
}

function toMilligrams(value: number, unit: MassUnit): number {
  return unit === 'g' ? value * 1000 : value;
}

function fromMilligrams(value: number, unit: MassUnit): number {
  return unit === 'g' ? value / 1000 : value;
}
