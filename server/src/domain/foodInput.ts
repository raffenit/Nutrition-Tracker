import type { NewFood } from '../db/foods.js';
import { HttpError } from '../http/errors.js';
import type { FoodKind, FoodSource, IngredientLine } from '../types.js';
import { isRecord, nonNegative, optionalText, requiredNumber, requiredText } from './guards.js';
import { readNutrients } from './nutrients.js';

const KINDS = ['packaged', 'ingredient', 'restaurant', 'custom'] as const;
const SOURCES = ['manual', 'image', 'pdf', 'api', 'composed'] as const;

export function readFoodInput(body: unknown, createdBy: string): NewFood {
  if (!isRecord(body)) throw new HttpError(400, 'Expected a food object');
  const isDrink = requiredBoolean(body.isDrink, 'Drink');
  const drinkMl = body.drinkMl === null || body.drinkMl === undefined ? null : nonNegative(requiredNumber(body.drinkMl, 'Drink volume'), 'Drink volume');
  if (isDrink && (!drinkMl || drinkMl <= 0)) throw new HttpError(400, 'A drink needs a volume');
  const makesServings = body.makesServings === undefined ? 1 : requiredNumber(body.makesServings, 'Servings');
  if (makesServings <= 0) throw new HttpError(400, 'Servings must be greater than zero');
  return {
    createdBy,
    name: requiredText(body.name, 'Name'),
    brand: optionalText(body.brand),
    kind: oneOf(body.kind, KINDS, 'Food type'),
    servingLabel: requiredText(body.servingLabel, 'Serving'),
    nutrients: readNutrients(body.nutrients),
    isFavorite: body.isFavorite === true,
    isDrink,
    drinkMl,
    makesServings,
    source: body.source === undefined ? 'manual' : oneOf(body.source, SOURCES, 'Source'),
    sourceRef: optionalText(body.sourceRef),
    ingredients: readIngredients(body.ingredients),
  };
}

export function favoriteOnly(body: unknown): boolean | null {
  if (!isRecord(body)) return null;
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === 'isFavorite' && typeof body.isFavorite === 'boolean') return body.isFavorite;
  return null;
}

function readIngredients(value: unknown): IngredientLine[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'Ingredients must be a list');
  return value.map(readIngredient);
}

function readIngredient(value: unknown): IngredientLine {
  if (!isRecord(value)) throw new HttpError(400, 'Each ingredient needs a name');
  const servings = requiredNumber(value.servings, 'Ingredient amount');
  if (servings <= 0) throw new HttpError(400, 'Ingredient amount must be greater than zero');
  return {
    name: requiredText(value.name, 'Ingredient'),
    servings,
    sourceRef: optionalText(value.sourceRef),
    childFoodId: optionalText(value.childFoodId),
  };
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} must be yes or no`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  throw new HttpError(400, `${label} is not valid`);
}

export type { FoodKind, FoodSource };
