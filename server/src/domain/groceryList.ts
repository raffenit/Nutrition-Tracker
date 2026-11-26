import { parseLeadingQuantityUnit } from './parseIngredientLine.js';
import { normalizeKitLineKey } from './kitLineKey.js';
import { effectiveIngredientLine, type KitMappingLookup } from './kitEcosystemIngredients.js';
import type { Food, IngredientLine, MealSlot } from '../types.js';

/** Instacart-compatible line item (name + optional qty/unit). */
export type GroceryLineItem = {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  foodId: string | null;
  /** Recipe / kit line name when it differs from what to buy (meal-kit sauces, etc.). */
  recipeLineName: string | null;
};

export type PlannedMeal = {
  localDate: string;
  slot: MealSlot;
  foodId: string;
  servings: number;
  foodName: string;
};

/**
 * Unit conversion for merging shopping lines. Volume and weight families
 * convert to a common base (ml / g) so "2 cups" + "2 tbsp" of the same
 * ingredient collapse into one line. Count-ish units (clove, can, unit,
 * serving, …) never convert — they bucket per unit as before. Volume and
 * weight never mix (no density), so "1 cup flour" + "8 oz flour" stays split.
 */
const VOLUME_TO_ML: Record<string, number> = {
  tsp: 4.92892, tbsp: 14.7868, cup: 236.588, ml: 1, l: 1000,
};
const WEIGHT_TO_G: Record<string, number> = {
  oz: 28.3495, lb: 453.592, g: 1, kg: 1000,
};

type UnitSpec = { family: string; toBase: number };

function unitSpec(unit: string): UnitSpec {
  const lower = unit.toLowerCase();
  if (lower in VOLUME_TO_ML) return { family: 'volume', toBase: VOLUME_TO_ML[lower]! };
  if (lower in WEIGHT_TO_G) return { family: 'weight', toBase: WEIGHT_TO_G[lower]! };
  return { family: `unit:${lower}`, toBase: 1 };
}

/** Pick a readable display unit for a merged total, honoring metric/imperial preference. */
function displayUnitFor(family: string, base: number, units: 'metric' | 'imperial'): { unit: string; factor: number } {
  if (family === 'volume') {
    if (units === 'metric') return base < 1000 ? { unit: 'ml', factor: 1 } : { unit: 'L', factor: 1000 };
    if (base >= 118) return { unit: 'cup', factor: 236.588 };
    if (base >= 7) return { unit: 'tbsp', factor: 14.7868 };
    return { unit: 'tsp', factor: 4.92892 };
  }
  if (family === 'weight') {
    if (units === 'metric') return base < 1000 ? { unit: 'g', factor: 1 } : { unit: 'kg', factor: 1000 };
    // Stay in oz until the total is at least ~2 lb — "24 oz" reads better than "1.5 lb".
    return base < 907.184 ? { unit: 'oz', factor: 28.3495 } : { unit: 'lb', factor: 453.592 };
  }
  return { unit: family.slice('unit:'.length), factor: 1 };
}

export function aggregateGroceryLineItems(
  plans: Array<{ foodId: string; servings: number }>,
  foodById: (id: string) => Food | null,
  kitMapping?: KitMappingLookup,
  options?: { units?: 'metric' | 'imperial' },
): GroceryLineItem[] {
  const units = options?.units ?? 'imperial';
  const buckets = new Map<string, {
    key: string;
    name: string;
    family: string;
    base: number;
    foodId: string | null;
    recipeLineName: string | null;
  }>();
  for (const plan of plans) {
    const food = foodById(plan.foodId);
    if (!food || plan.servings <= 0) continue;
    if (food.kind === 'custom' && food.ingredients.length > 0) {
      const batchFactor = plan.servings / Math.max(food.makesServings, 1);
      for (const rawLine of food.ingredients) {
        if (rawLine.servings <= 0) continue;
        const mapping = food.mealKitEcosystemId && kitMapping
          ? kitMapping(food.mealKitEcosystemId, rawLine.name)
          : null;
        const line = effectiveIngredientLine(rawLine, mapping);
        const shop = resolveShoppingLine(line, foodById);
        const scaled = groceryQtyAndUnit(line, batchFactor);
        mergeLine(buckets, shop.key, shop.name, scaled.quantity, scaled.unit, shop.foodId, shop.recipeLineName);
      }
      continue;
    }
    mergeLine(buckets, `name:${normalizeKitLineKey(food.name)}`, food.name, plan.servings, 'serving', food.id, null);
  }
  return [...buckets.values()]
    .map((bucket) => {
      const display = displayUnitFor(bucket.family, bucket.base, units);
      return {
        key: bucket.key,
        name: bucket.name,
        quantity: Math.round((bucket.base / display.factor) * 1000) / 1000,
        unit: display.unit,
        foodId: bucket.foodId,
        recipeLineName: bucket.recipeLineName,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function groceryQtyAndUnit(line: IngredientLine, batchFactor: number): { quantity: number; unit: string } {
  const parsed = parseLeadingQuantityUnit(line.name);
  if (parsed && !line.childFoodId) {
    return {
      quantity: parsed.quantity * line.servings * batchFactor,
      unit: parsed.unit,
    };
  }
  return {
    quantity: line.servings * batchFactor,
    unit: 'serving',
  };
}

export function resolveShoppingLine(
  line: IngredientLine,
  foodById: (id: string) => Food | null,
): { key: string; name: string; foodId: string | null; recipeLineName: string | null } {
  if (line.shopEquivalentFoodId) {
    const equiv = foodById(line.shopEquivalentFoodId);
    const name = equiv?.name ?? line.shopEquivalentLabel ?? line.name;
    const recipeLineName = name !== line.name ? line.name : null;
    return {
      key: `shop:${line.shopEquivalentFoodId}`,
      name,
      foodId: line.shopEquivalentFoodId,
      recipeLineName,
    };
  }
  if (line.shopEquivalentLabel) {
    const label = line.shopEquivalentLabel.trim();
    return {
      key: `label:${label.toLowerCase()}`,
      name: label,
      foodId: null,
      recipeLineName: label !== line.name ? line.name : null,
    };
  }
  const child = line.childFoodId ? foodById(line.childFoodId) : null;
  // Dedupe on the normalized ingredient name (quantity/unit stripped) so
  // "1 cup broccoli" and "2 cups broccoli" collapse into one shopping line.
  const parsed = child ? null : parseLeadingQuantityUnit(line.name);
  const displayName = (parsed?.name ?? child?.name ?? line.name).trim();
  return {
    key: `name:${normalizeKitLineKey(displayName)}`,
    name: displayName,
    foodId: line.childFoodId,
    recipeLineName: null,
  };
}

export function formatGroceryMarkdown(weekStart: string, weekEnd: string, items: GroceryLineItem[], meals: PlannedMeal[], recipeNames: string[] = []): string {
  const lines: string[] = [
    `# Grocery list`,
    ``,
    `Week of ${weekStart} – ${weekEnd}`,
    ``,
  ];
  if (recipeNames.length > 0) {
    lines.push(`## Recipes`, ``);
    for (const name of recipeNames) lines.push(`- ${name}`);
    lines.push(``);
  }
  lines.push(`## Shopping`, ``);
  if (items.length === 0) {
    lines.push(`- _(nothing planned yet)_`, ``);
  } else {
    for (const item of items) {
      const qty = formatQty(item.quantity);
      const kitNote = item.recipeLineName ? ` _(recipe: ${item.recipeLineName})_` : '';
      lines.push(`- [ ] **${item.name}** — ${qty} ${item.unit}${kitNote}`.trim());
    }
    lines.push(``);
  }
  if (meals.length > 0) {
    lines.push(`## Meals this week`, ``);
    let day = '';
    for (const meal of mealsSorted(meals)) {
      if (meal.localDate !== day) {
        day = meal.localDate;
        lines.push(`### ${day}`, ``);
      }
      lines.push(`- ${meal.slot}: **${meal.foodName}** (${formatQty(meal.servings)} serving${meal.servings === 1 ? '' : 's'})`);
    }
    lines.push(``);
  }
  lines.push(`---`, `_Generated by Nutrition Tracker_`);
  return lines.join('\n');
}

function mealsSorted(meals: PlannedMeal[]): PlannedMeal[] {
  return [...meals].sort((a, b) => a.localDate.localeCompare(b.localDate) || a.slot.localeCompare(b.slot));
}

type GroceryBucket = {
  key: string;
  name: string;
  family: string;
  /** Quantity accumulated in the family's base unit (ml / g / each). */
  base: number;
  foodId: string | null;
  recipeLineName: string | null;
};

function mergeLine(
  buckets: Map<string, GroceryBucket>,
  key: string,
  name: string,
  quantity: number,
  unit: string,
  foodId: string | null,
  recipeLineName: string | null,
): void {
  const spec = unitSpec(unit);
  const bucketKey = `${key}|${spec.family}`;
  const base = quantity * spec.toBase;
  const prev = buckets.get(bucketKey);
  if (!prev) {
    buckets.set(bucketKey, { key: bucketKey, name, family: spec.family, base, foodId, recipeLineName });
    return;
  }
  prev.base += base;
  if (!prev.recipeLineName && recipeLineName) prev.recipeLineName = recipeLineName;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
