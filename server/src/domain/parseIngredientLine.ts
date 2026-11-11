/** Parse leading quantity + unit from recipe/shopping ingredient text (layout pattern, not brand-specific). */

const LEADING_QTY_UNIT =
  /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|cans?|bunches?|heads?|packages?|pkgs?)\.?\s+(.+)$/i;

const FRACTION = /^(\d+)\s*\/\s*(\d+)$/;

export type ParsedIngredientLine = {
  name: string;
  quantity: number;
  unit: string;
};

export function parseLeadingQuantityUnit(lineText: string): ParsedIngredientLine | null {
  const trimmed = lineText.trim();
  if (!trimmed) return null;
  const match = trimmed.match(LEADING_QTY_UNIT);
  if (!match) return null;
  const quantity = parseQuantityToken(match[1] ?? '');
  if (quantity === null || quantity <= 0) return null;
  const unit = normalizeUnit(match[2] ?? '');
  const name = (match[3] ?? '').trim();
  if (!name) return null;
  return { name, quantity, unit };
}

function parseQuantityToken(token: string): number | null {
  const fraction = token.match(FRACTION);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    if (den === 0) return null;
    return num / den;
  }
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

function normalizeUnit(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.startsWith('ounce')) return 'oz';
  if (lower === 'lb' || lower.startsWith('pound')) return 'lb';
  if (lower.startsWith('gram') || lower === 'g') return 'g';
  if (lower.startsWith('kilogram') || lower === 'kg') return 'kg';
  if (lower.startsWith('milliliter') || lower === 'ml') return 'ml';
  if (lower.startsWith('liter') || lower === 'l') return 'L';
  if (lower.startsWith('cup')) return 'cup';
  if (lower.startsWith('tablespoon') || lower === 'tbsp') return 'tbsp';
  if (lower.startsWith('teaspoon') || lower === 'tsp') return 'tsp';
  if (lower.startsWith('clove')) return 'clove';
  if (lower.startsWith('can')) return 'can';
  if (lower.startsWith('bunch')) return 'bunch';
  if (lower.startsWith('head')) return 'head';
  if (lower.startsWith('package') || lower.startsWith('pkg')) return 'pkg';
  return lower;
}
