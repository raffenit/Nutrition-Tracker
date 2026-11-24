/**
 * Client mirror of server/src/domain/parseIngredientLine.ts — splits a raw
 * ingredient line ("½ cup white quinoa", "2 eggs") into editable name /
 * quantity / unit parts and recomposes it for storage. Server and grocery
 * code keep reading the composed `name` text, so this stays a display-layer
 * concern.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6,
};

const FRAC_CHARS = Object.keys(UNICODE_FRACTIONS).join('');
const QTY_TOKEN = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\d+\s*\/\s*\d+|[${FRAC_CHARS}]|(?:\d+\s*)?[${FRAC_CHARS}])`;

const LEADING_QTY_UNIT = new RegExp(
  String.raw`^(${QTY_TOKEN})\s*(oz|ounces?|lbs?|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|cloves?|cans?|bunches?|heads?|packages?|pkgs?|slices?|sprigs?|pinch|pinches|x|×)\.?\s+(.+)$`,
  'i',
);
const LEADING_BARE_COUNT = new RegExp(String.raw`^(${QTY_TOKEN})\s+(\p{L}[^\n]*)$`, 'u');

/** Units offered in the editor; 'unit'/'x' cover countables ("2 eggs", "2x eggs"). */
export const INGREDIENT_UNIT_OPTIONS = [
  'unit', 'x', 'cup', 'tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'L',
  'clove', 'can', 'bunch', 'head', 'pkg', 'slice', 'sprig', 'pinch',
] as const;

export type IngredientParts = {
  /** Food name with any leading quantity/unit removed. */
  name: string;
  /** Raw quantity text as detected/entered ("1/2", "0.5", "2", "½"). */
  quantity: string;
  /** Unit token ('cup', 'unit', …); 'unit' means a count of items. */
  unit: string;
};

export function parseIngredientParts(lineText: string): IngredientParts {
  const trimmed = lineText.trim();
  if (!trimmed) return { name: '', quantity: '', unit: 'unit' };
  const match = trimmed.match(LEADING_QTY_UNIT);
  if (match) {
    const name = (match[3] ?? '').trim();
    if (name) {
      return { name, quantity: (match[1] ?? '').trim(), unit: normalizeUnit(match[2] ?? '') };
    }
  }
  const count = trimmed.match(LEADING_BARE_COUNT);
  if (count) {
    const name = (count[2] ?? '').trim();
    if (name) {
      return { name, quantity: (count[1] ?? '').trim(), unit: 'unit' };
    }
  }
  return { name: trimmed, quantity: '', unit: 'unit' };
}

/** Recompose editable parts back into the stored line text ("1/2 cup quinoa", "2 eggs"). */
export function composeIngredientName(parts: IngredientParts): string {
  const name = parts.name.trim();
  const quantity = parts.quantity.trim();
  if (!quantity) return name;
  const unit = parts.unit.trim();
  if (unit === 'x') return `${quantity}x ${name}`.trim();
  const unitWord = unit && unit !== 'unit' && unit !== 'item' && unit !== 'each' ? ` ${unit}` : '';
  return `${quantity}${unitWord} ${name}`.trim();
}

/** Unit choices for the select, with the line's current unit kept selectable. */
export function ingredientUnitOptions(current: string): string[] {
  return INGREDIENT_UNIT_OPTIONS.includes(current as (typeof INGREDIENT_UNIT_OPTIONS)[number])
    ? [...INGREDIENT_UNIT_OPTIONS]
    : [...INGREDIENT_UNIT_OPTIONS, current];
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
  if (lower.startsWith('sprig')) return 'sprig';
  if (lower.startsWith('pinch')) return 'pinch';
  if (lower === 'x' || lower === '×') return 'x';
  return lower;
}
