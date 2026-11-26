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

export type IngredientMeasure = {
  /** Raw quantity text ("470", "1/2", "½"). */
  quantity: string;
  /** Unit token ('g', 'cup', 'unit', …). */
  unit: string;
};

export type IngredientParts = {
  /** Food name with any leading quantity/unit and parenthetical asides removed. */
  name: string;
  /** Raw quantity text as detected/entered ("1/2", "0.5", "2", "½"). */
  quantity: string;
  /** Unit token ('cup', 'unit', …); 'unit' means a count of items. */
  unit: string;
  /** Prep notes pulled out of parentheses ("melted", "divided"). */
  notes: string;
  /** Alternate measures pulled out of parentheses ("470 g" next to "2 cups"). */
  alternates: IngredientMeasure[];
};

/** Parenthetical that reads as a measurement ("470 g", "2 cups", "1/2") → alternate; anything else → note. */
const PAREN_GROUP = /\(([^()]*)\)/g;
const UNIT_WORDS = [
  'oz', 'ounces?', 'lbs?', 'pounds?', 'g', 'grams?', 'kg', 'kilograms?',
  'ml', 'milliliters?', 'l', 'liters?', 'cups?', 'tbsp', 'tablespoons?',
  'tsp', 'teaspoons?', 'cloves?', 'cans?', 'bunches?', 'heads?',
  'packages?', 'pkgs?', 'slices?', 'sprigs?', 'pinch', 'pinches', 'x', '×',
];
const MEASURE_PAREN = new RegExp(
  String.raw`^\s*(${QTY_TOKEN})\s*(${UNIT_WORDS.join('|')})?\.?\s*$`,
  'i',
);

export function parseIngredientParts(lineText: string): IngredientParts {
  const trimmed = lineText.trim();
  const empty: IngredientParts = { name: '', quantity: '', unit: 'unit', notes: '', alternates: [] };
  if (!trimmed) return empty;
  let quantity = '';
  let unit = 'unit';
  let rest = trimmed;
  const match = trimmed.match(LEADING_QTY_UNIT);
  if (match) {
    const name = (match[3] ?? '').trim();
    if (name) {
      quantity = (match[1] ?? '').trim();
      unit = normalizeUnit(match[2] ?? '');
      rest = name;
    }
  } else {
    const count = trimmed.match(LEADING_BARE_COUNT);
    if (count) {
      const name = (count[2] ?? '').trim();
      if (name) {
        quantity = (count[1] ?? '').trim();
        rest = name;
      }
    }
  }
  const { name, notes, alternates } = extractParentheticals(rest);
  return { name, quantity, unit, notes, alternates };
}

function extractParentheticals(text: string): { name: string; notes: string; alternates: IngredientMeasure[] } {
  const notes: string[] = [];
  const alternates: IngredientMeasure[] = [];
  const name = text.replace(PAREN_GROUP, (_all, inner: string) => {
    const content = inner.trim();
    if (!content) return ' ';
    const measure = content.match(MEASURE_PAREN);
    if (measure) {
      const qty = (measure[1] ?? '').trim();
      const unitWord = measure[2] ? normalizeUnit(measure[2]) : '';
      if (qty) alternates.push({ quantity: qty, unit: unitWord || 'unit' });
    } else {
      notes.push(content);
    }
    return ' ';
  }).replace(/\s{2,}/g, ' ').trim();
  return { name, notes: notes.join('; '), alternates };
}

/** Recompose editable parts back into the stored line text ("1/2 cup quinoa", "2 eggs"). */
export function composeIngredientName(parts: { name: string; quantity: string; unit: string }): string {
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

const SIMPLE_FRACTIONS: Record<string, string> = { '0.5': '½', '0.25': '¼', '0.75': '¾' };

/** Numeric value of a quantity token ("1/2", "1 1/2", "½", "0.5"); null when unparseable. */
export function quantityValue(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const mixedVulgar = trimmed.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedVulgar) {
    const den = Number(mixedVulgar[3]);
    if (den === 0) return null;
    return Number(mixedVulgar[1]) + Number(mixedVulgar[2]) / den;
  }
  const fraction = trimmed.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const den = Number(fraction[2]);
    if (den === 0) return null;
    return Number(fraction[1]) / den;
  }
  const mixed = trimmed.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚])$/);
  if (mixed) {
    const frac = UNICODE_FRACTIONS[mixed[2] ?? ''];
    return frac === undefined ? null : Number(mixed[1]) + frac;
  }
  const single = UNICODE_FRACTIONS[trimmed];
  if (single !== undefined) return single;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Human-friendly quantity text after scaling ("1", "1½", "0.75"). */
export function formatQuantity(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  const frac = SIMPLE_FRACTIONS[String(rounded)];
  if (frac) return frac;
  const intPart = Math.floor(rounded);
  const fracPart = rounded - intPart;
  const fracGlyph = SIMPLE_FRACTIONS[fracPart.toFixed(2)];
  if (fracGlyph) return `${intPart}${fracGlyph}`;
  return String(rounded);
}

export type ScaledIngredientDisplay = {
  /** Composed "qty unit name" text scaled by factor (parens asides stripped). */
  text: string;
  notes: string;
  /** Alternate measures scaled by the same factor ("470 g"). */
  alternates: string[];
};

/** Scale a stored ingredient line ("2 cups flour", notes/alternates columns) for display. */
export function scaledIngredientDisplay(
  line: { name: string; servings: number; notes?: string | null; altMeasurements?: IngredientMeasure[] },
  factor: number,
): ScaledIngredientDisplay {
  const parts = parseIngredientParts(line.name);
  const base = quantityValue(parts.quantity);
  let quantity = parts.quantity;
  let unit = parts.unit;
  if (base != null && parts.quantity) {
    quantity = formatQuantity(base * line.servings * factor);
  } else if (!parts.quantity) {
    // No leading measure (e.g. linked library foods): show the scaled count.
    const count = line.servings * factor;
    if (count !== 1) {
      quantity = formatQuantity(count);
      unit = 'x';
    }
  }
  const text = composeIngredientName({ name: parts.name, quantity, unit });
  const alternates = (line.altMeasurements ?? []).map((measure) => {
    const value = quantityValue(measure.quantity);
    const qty = value != null ? formatQuantity(value * line.servings * factor) : measure.quantity;
    return measure.unit && measure.unit !== 'unit' ? `${qty} ${measure.unit}` : qty;
  });
  const parenAlts = parts.alternates.map((measure) => {
    const value = quantityValue(measure.quantity);
    const qty = value != null ? formatQuantity(value * line.servings * factor) : measure.quantity;
    return measure.unit && measure.unit !== 'unit' ? `${qty} ${measure.unit}` : qty;
  });
  return {
    text,
    notes: line.notes?.trim() || parts.notes,
    alternates: [...alternates, ...parenAlts],
  };
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
