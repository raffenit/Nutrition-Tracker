import { HttpError } from '../http/errors.js';
import type { ExtraNutrient, MacroShares, Nutrients, Targets } from '../types.js';
import { DEFAULT_DATE_FORMAT, parseDateFormat } from './dateFormat.js';
import { isRecord, nonNegative, optionalText, requiredNumber, requiredText } from './guards.js';
import { readNutrientsWithUnits } from './nutrientUnits.js';

export const DEFAULT_TARGETS: Targets = {
  calories: 2000,
  protein: 100,
  fiber: 25,
  fat: 65,
  carbs: 250,
  sodium: 2300,
  sodiumIsLimit: false,
  carbsIsLimit: false,
  hydrationMl: 2000,
  units: 'imperial',
  dateFormat: DEFAULT_DATE_FORMAT,
  extras: [],
};

export function emptyNutrients(): Nutrients {
  return { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [] };
}

/** Fill zero/missing core fields and extras from a second parse (e.g. per-slot OCR merge). */
export function fillNutrientGaps(target: Nutrients, source: Nutrients | null | undefined): void {
  if (!source) return;
  if (target.calories <= 0 && source.calories > 0) target.calories = source.calories;
  if (target.fat <= 0 && source.fat > 0) target.fat = source.fat;
  if (target.carbs <= 0 && source.carbs > 0) target.carbs = source.carbs;
  if (target.fiber <= 0 && source.fiber > 0) target.fiber = source.fiber;
  if (target.protein <= 0 && source.protein > 0) target.protein = source.protein;
  if (target.sodium <= 0 && source.sodium > 0) target.sodium = source.sodium;
  for (const extra of source.extras) {
    if (target.extras.some((row) => row.key === extra.key)) continue;
    if (extra.amount > 0) target.extras.push({ ...extra });
  }
}

/** Same merge as image import (`foodRoutes`): slot OCR wins over primary parse when it has a positive reading. */
export function applySlotMergedNutrients(target: Nutrients, merged: Nutrients | null | undefined): void {
  if (!merged) return;
  if (merged.calories > 0) target.calories = merged.calories;
  if (merged.fat > 0) target.fat = merged.fat;
  if (merged.carbs > 0) target.carbs = merged.carbs;
  if (merged.fiber > 0) target.fiber = merged.fiber;
  if (merged.protein > 0) target.protein = merged.protein;
  if (merged.sodium > 0) target.sodium = merged.sodium;
  for (const extra of merged.extras) {
    if (extra.amount <= 0) continue;
    const index = target.extras.findIndex((row) => row.key === extra.key);
    if (index >= 0) target.extras[index] = { ...extra };
    else target.extras.push({ ...extra });
  }
}

export function scaleNutrients(nutrients: Nutrients, factor: number): Nutrients {
  return {
    calories: nutrients.calories * factor,
    protein: nutrients.protein * factor,
    fiber: nutrients.fiber * factor,
    fat: nutrients.fat * factor,
    carbs: nutrients.carbs * factor,
    sodium: nutrients.sodium * factor,
    extras: nutrients.extras.map((extra) => ({ ...extra, amount: extra.amount * factor })),
  };
}

export function addNutrients(left: Nutrients, right: Nutrients): Nutrients {
  return {
    calories: left.calories + right.calories,
    protein: left.protein + right.protein,
    fiber: left.fiber + right.fiber,
    fat: left.fat + right.fat,
    carbs: left.carbs + right.carbs,
    sodium: left.sodium + right.sodium,
    extras: mergeExtras(left.extras, right.extras),
  };
}

export function macroShares(nutrients: Nutrients): MacroShares {
  const protein = nutrients.protein * 4;
  const fat = nutrients.fat * 9;
  const carbs = nutrients.carbs * 4;
  const total = protein + fat + carbs;
  if (total <= 0) return { protein: 0, fat: 0, carbs: 0 };
  return { protein: protein / total, fat: fat / total, carbs: carbs / total };
}

export function readNutrients(value: unknown): Nutrients {
  return readNutrientsWithUnits(value).nutrients;
}

export function readTargets(value: unknown): Targets {
  if (!isRecord(value)) throw new HttpError(400, 'Targets are required');
  const sodium = value.sodium === null ? null : nonNegative(requiredNumber(value.sodium, 'Sodium'), 'Sodium');
  return {
    calories: nonNegative(requiredNumber(value.calories, 'Calories'), 'Calories'),
    protein: nonNegative(requiredNumber(value.protein, 'Protein'), 'Protein'),
    fiber: nonNegative(requiredNumber(value.fiber, 'Fiber'), 'Fiber'),
    fat: nonNegative(requiredNumber(value.fat, 'Fat'), 'Fat'),
    carbs: nonNegative(requiredNumber(value.carbs, 'Carbs'), 'Carbs'),
    sodium,
    sodiumIsLimit: value.sodiumIsLimit === true,
    carbsIsLimit: value.carbsIsLimit === true,
    hydrationMl: nonNegative(requiredNumber(value.hydrationMl, 'Hydration'), 'Hydration'),
    units: value.units === 'metric' ? 'metric' : 'imperial',
    dateFormat: parseDateFormat(value.dateFormat),
    extras: readExtras(value.extras),
  };
}

export function readExtras(value: unknown): ExtraNutrient[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'Custom nutrients must be a list');
  return value.map(readExtra);
}

export function parseStoredExtras(json: string): ExtraNutrient[] {
  try {
    return readExtras(JSON.parse(json));
  } catch (error) {
    if (error instanceof HttpError) return [];
    return [];
  }
}

export function nutrientKey(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return key || 'custom';
}

function readExtra(value: unknown): ExtraNutrient {
  if (!isRecord(value)) throw new HttpError(400, 'Each custom nutrient needs a name');
  const label = requiredText(value.label, 'Custom nutrient name');
  return {
    key: optionalText(value.key) ?? nutrientKey(label),
    label,
    amount: nonNegative(requiredNumber(value.amount, label), label),
    unit: optionalText(value.unit) ?? '',
  };
}

function mergeExtras(left: ExtraNutrient[], right: ExtraNutrient[]): ExtraNutrient[] {
  const merged = new Map<string, ExtraNutrient>();
  for (const extra of [...left, ...right]) addExtra(merged, extra);
  return [...merged.values()];
}

function addExtra(merged: Map<string, ExtraNutrient>, extra: ExtraNutrient): void {
  const existing = merged.get(extra.key);
  if (!existing) {
    merged.set(extra.key, { ...extra });
    return;
  }
  existing.amount += extra.amount;
}

export function roundNutrients(nutrients: Nutrients): Nutrients {
  return {
    calories: roundTo(nutrients.calories, 1),
    protein: roundTo(nutrients.protein, 1),
    fiber: roundTo(nutrients.fiber, 1),
    fat: roundTo(nutrients.fat, 1),
    carbs: roundTo(nutrients.carbs, 1),
    sodium: roundTo(nutrients.sodium, 1),
    extras: nutrients.extras.map((extra) => ({ ...extra, amount: roundTo(extra.amount, 2) })),
  };
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
