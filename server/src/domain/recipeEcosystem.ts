import { getKitMappingByKey, syncKitMappingsFromIngredients } from '../db/mealKitEcosystems.js';
import type { AppDatabase } from '../db/database.js';
import type { IngredientLine } from '../types.js';
import { applyKitMappingsToIngredients } from './kitEcosystemIngredients.js';
import { kitLineKeyFromText } from './kitLineKey.js';

export function mergeRecipeIngredientsWithEcosystem(
  db: AppDatabase,
  ecosystemId: string | null,
  lines: IngredientLine[],
): IngredientLine[] {
  if (!ecosystemId) return lines;
  const lookup = (lineName: string) => {
    const key = kitLineKeyFromText(lineName);
    if (!key) return null;
    return getKitMappingByKey(db, ecosystemId, key);
  };
  const merged = applyKitMappingsToIngredients(lines, lookup);
  syncKitMappingsFromIngredients(
    db,
    ecosystemId,
    merged.map((line) => ({
      name: line.name,
      childFoodId: line.childFoodId,
      shopEquivalentFoodId: line.shopEquivalentFoodId,
      shopEquivalentLabel: line.shopEquivalentLabel,
    })),
  );
  return merged;
}
