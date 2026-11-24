import { parseIngredientParts } from './lib/ingredientLine';

/** Stable lookup key for kit ingredient lines (strips leading qty/unit, normalizes text). */
export function kitLineKeyFromText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const core = parseIngredientParts(trimmed).name || trimmed;
  return core
    .toLowerCase()
    .replace(/[''"]/g, '')
    .replace(/[^\p{L}\p{N}&\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
