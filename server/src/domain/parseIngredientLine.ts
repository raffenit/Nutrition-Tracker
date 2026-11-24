/** Parse leading quantity + unit from recipe/shopping ingredient text (layout pattern, not brand-specific). */

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6,
};

const QTY_TOKEN = String.raw`(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+|[${Object.keys(UNICODE_FRACTIONS).join('')}]|(?:\d+\s*)?[${Object.keys(UNICODE_FRACTIONS).join('')}])`;

const LEADING_QTY_UNIT = new RegExp(
  String.raw`^(${QTY_TOKEN})\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|cans?|bunches?|heads?|packages?|pkgs?|slices?|pinch|pinches)\.?\s+(.+)$`,
  'i',
);

/** Bare count with no unit word: "2 eggs" → quantity 2, unit 'unit', name 'eggs'.
 *  Restricted to lowercase-leading remainders so capitalized names like
 *  "3 Cheese" are not mistaken for counts. */
const LEADING_BARE_COUNT = new RegExp(String.raw`^(${QTY_TOKEN})\s+([a-z][^\n]*)$`, 'u');

const FRACTION = /^(\d+)\s*\/\s*(\d+)$/;

/** Unit used when the ingredient is a count of items ("2 eggs" → 2 unit). */
export const COUNT_UNIT = 'unit';

export type ParsedIngredientLine = {
  name: string;
  quantity: number;
  unit: string;
};

export type IngredientPrefixSplit = {
  /** Raw leading quantity+unit text as written ("1/2 cup", "2"), without trailing space. */
  prefix: string;
  /** Remainder after the prefix — the ingredient name proper. */
  name: string;
};

/** Split off a leading quantity/unit prefix, preserving the raw text for recomposition. */
export function splitIngredientPrefix(lineText: string): IngredientPrefixSplit | null {
  const trimmed = lineText.trim();
  if (!trimmed) return null;
  const match = trimmed.match(LEADING_QTY_UNIT);
  if (match) {
    const name = (match[3] ?? '').trim();
    const quantity = parseQuantityToken(match[1] ?? '');
    if (name && quantity !== null && quantity > 0) {
      return { prefix: `${(match[1] ?? '').trim()} ${(match[2] ?? '').trim()}`, name };
    }
  }
  const count = trimmed.match(LEADING_BARE_COUNT);
  if (count) {
    const name = (count[2] ?? '').trim();
    const quantity = parseQuantityToken(count[1] ?? '');
    if (name && quantity !== null && quantity > 0) {
      return { prefix: (count[1] ?? '').trim(), name };
    }
  }
  return null;
}

export function parseLeadingQuantityUnit(lineText: string): ParsedIngredientLine | null {
  const trimmed = lineText.trim();
  if (!trimmed) return null;
  const match = trimmed.match(LEADING_QTY_UNIT);
  if (match) {
    const quantity = parseQuantityToken(match[1] ?? '');
    if (quantity === null || quantity <= 0) return null;
    const unit = normalizeUnit(match[2] ?? '');
    const name = (match[3] ?? '').trim();
    if (!name) return null;
    return { name, quantity, unit };
  }
  const count = trimmed.match(LEADING_BARE_COUNT);
  if (count) {
    const quantity = parseQuantityToken(count[1] ?? '');
    const name = (count[2] ?? '').trim();
    if (quantity === null || quantity <= 0 || !name) return null;
    return { name, quantity, unit: COUNT_UNIT };
  }
  return null;
}

function parseQuantityToken(token: string): number | null {
  const trimmed = token.trim();
  const fraction = trimmed.match(FRACTION);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    if (den === 0) return null;
    return num / den;
  }
  // Mixed number + vulgar fraction, e.g. "1½" or "1 ½".
  const mixed = trimmed.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])$/);
  if (mixed) {
    const frac = UNICODE_FRACTIONS[mixed[2] ?? ''];
    if (frac === undefined) return null;
    return Number(mixed[1]) + frac;
  }
  const single = UNICODE_FRACTIONS[trimmed];
  if (single !== undefined) return single;
  const value = Number(trimmed);
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
  if (lower.startsWith('slice')) return 'slice';
  if (lower.startsWith('pinch')) return 'pinch';
  return lower;
}
