import type { DayTotals, MealLog } from '../types.js';
import { addNutrients, emptyNutrients, macroShares, roundNutrients } from './nutrients.js';

export function dayTotals(logs: MealLog[], hydrationMl: number): DayTotals {
  const summed = logs.reduce((total, log) => addNutrients(total, log.nutrients), emptyNutrients());
  const rounded = roundNutrients(summed);
  return { ...rounded, hydrationMl: Math.round(hydrationMl), shares: macroShares(rounded) };
}
