import type { IngredientLine } from '../types.js';
import type { KitIngredientMapping } from '../db/mealKitEcosystems.js';
import { kitLineKeyFromText } from './kitLineKey.js';
import { splitIngredientPrefix } from './parseIngredientLine.js';

export type KitMappingLookup = (ecosystemId: string, lineName: string) => KitIngredientMapping | null;

export function effectiveIngredientLine(line: IngredientLine, mapping: KitIngredientMapping | null): IngredientLine {
  if (!mapping) return line;
  // Canonical name replaces only the ingredient-name portion — the line's own
  // leading quantity/unit ("2 cups …") is preserved so amounts aren't lost.
  const split = splitIngredientPrefix(line.name);
  const canonicalName = split ? `${split.prefix} ${mapping.kitLineName}` : mapping.kitLineName;
  return {
    name: canonicalName,
    servings: line.servings,
    sourceRef: line.sourceRef,
    childFoodId: line.childFoodId ?? mapping.nutritionFoodId,
    componentRole: line.componentRole,
    shopEquivalentFoodId: line.shopEquivalentFoodId ?? mapping.shopEquivalentFoodId,
    shopEquivalentLabel: line.shopEquivalentLabel ?? mapping.shopEquivalentLabel,
  };
}

/** Merge household kit reference sheet into recipe lines (line-level values override the sheet). */
export function applyKitMappingsToIngredients(
  lines: IngredientLine[],
  lookup: (lineName: string) => KitIngredientMapping | null,
): IngredientLine[] {
  return lines.map((line) => effectiveIngredientLine(line, lookup(line.name)));
}

export function lineHasShopMapping(line: IngredientLine): boolean {
  return Boolean(line.shopEquivalentFoodId || (line.shopEquivalentLabel && line.shopEquivalentLabel.trim()));
}

export function mappingPayloadFromLine(
  lineName: string,
  line: IngredientLine,
  existing: KitIngredientMapping | null,
): Omit<KitIngredientMapping, 'id' | 'ecosystemId' | 'nameKey'> | null {
  if (!lineHasShopMapping(line) && !line.childFoodId) return null;
  const kitLineName = existing?.kitLineName ?? lineName.trim();
  if (!kitLineName) return null;
  return {
    kitLineName,
    shopEquivalentFoodId: line.shopEquivalentFoodId,
    shopEquivalentLabel: line.shopEquivalentLabel,
    nutritionFoodId: line.childFoodId,
  };
}

export function kitLineKey(lineName: string): string {
  return kitLineKeyFromText(lineName);
}
