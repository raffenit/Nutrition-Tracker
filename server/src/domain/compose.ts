import { HttpError } from '../http/errors.js';
import type { Nutrients } from '../types.js';
import { addNutrients, emptyNutrients, scaleNutrients } from './nutrients.js';

export function sumIngredientNutrients(lines: Array<{ servings: number; nutrients: Nutrients }>): Nutrients {
  return lines.reduce((total, line) => addNutrients(total, scaleNutrients(line.nutrients, line.servings)), emptyNutrients());
}

export function perServing(total: Nutrients, makesServings: number): Nutrients {
  if (makesServings <= 0) throw new HttpError(400, 'Servings must be greater than zero');
  return scaleNutrients(total, 1 / makesServings);
}
