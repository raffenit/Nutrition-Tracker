import { HttpError } from '../http/errors.js';
import type { Food, MealSlot } from '../types.js';

export function drinkVolume(food: Food, slot: MealSlot, servings: number, override: number | null): number | null {
  if (slot !== 'drink' && !food.isDrink) return null;
  if (override !== null && override > 0) return override;
  if (food.drinkMl && food.drinkMl > 0) return food.drinkMl * servings;
  throw new HttpError(400, 'Add how much you drank');
}
