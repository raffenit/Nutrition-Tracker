import { parseLeadingQuantityUnit } from './parseIngredientLine.js';

/** Stable lookup key for kit ingredient lines (strips leading qty/unit, normalizes text). */
export function kitLineKeyFromText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const parsed = parseLeadingQuantityUnit(trimmed);
  const core = parsed?.name ?? trimmed;
  return normalizeKitLineKey(core);
}

export function normalizeKitLineKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[''"]/g, '')
    .replace(/[^\p{L}\p{N}&\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
