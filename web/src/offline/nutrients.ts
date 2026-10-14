import type { Food, Nutrients } from '../types';

export function scaleNutrients(base: Nutrients, servings: number): Nutrients {
  return {
    calories: base.calories * servings,
    protein: base.protein * servings,
    fiber: base.fiber * servings,
    fat: base.fat * servings,
    carbs: base.carbs * servings,
    sodium: base.sodium * servings,
    extras: base.extras.map((extra) => ({ ...extra, amount: extra.amount * servings })),
  };
}

export function nutrientsFromMealBody(body: Record<string, unknown>, food: Food | null): Nutrients {
  if (body.adHoc === true) {
    const nutrients = body.nutrients as Nutrients;
    const servings = Number(body.servings);
    if (body.entryTotals === true) return nutrients;
    return scaleNutrients(nutrients, servings);
  }
  if (!food) {
    return { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [] };
  }
  return scaleNutrients(food.nutrients, Number(body.servings));
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const extras = [...a.extras];
  for (const extra of b.extras) {
    const existing = extras.find((row) => row.key === extra.key);
    if (existing) existing.amount += extra.amount;
    else extras.push({ ...extra });
  }
  return {
    calories: a.calories + b.calories,
    protein: a.protein + b.protein,
    fiber: a.fiber + b.fiber,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs,
    sodium: a.sodium + b.sodium,
    extras,
  };
}
