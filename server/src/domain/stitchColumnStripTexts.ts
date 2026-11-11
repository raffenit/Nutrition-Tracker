const NUTRIENT_ROW =
  /^(calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrate|total carb|dietary fiber|fiber|total sugars?|includes.+added sugars|protein)\b/i;
const SKIP_LINE = /^(nutrition\s+facts|serving size|servings per|amount per serving|daily value|\*|%)/i;

type StripColumn = {
  productName: string | null;
  rows: Map<string, string>;
};

/**
 * Turn per-column OCR strings into one wide table string for {@link parseMultiProductLabelTable}.
 */
export function stitchColumnStripOcrTexts(strips: string[]): string | null {
  const columns = strips.map(parseStripColumn).filter((column) => column.rows.size > 0 || column.productName);
  if (columns.length < 2) return null;

  const names = columns.map((column, index) => column.productName?.trim() || `Column ${index + 1}`);
  const rowOrder = buildRowOrder(columns);
  if (rowOrder.length === 0) return null;

  const lines = ['Nutrition Facts', names.join('  ')];
  for (const rowLabel of rowOrder) {
    lines.push(formatRowLabel(rowLabel));
    lines.push(
      columns
        .map((column) => column.rows.get(rowLabel) ?? '')
        .join('  ')
        .trim(),
    );
  }
  const text = lines.join('\n');
  return /calories/i.test(text) ? text : null;
}

function parseStripColumn(text: string): StripColumn {
  const rows = new Map<string, string>();
  let productName: string | null = null;
  const lines = text.replace(/\r/g, '\n').split(/\n/).map((line) => line.trim()).filter(Boolean);

  let pendingLabel: string | null = null;
  for (const line of lines) {
    if (SKIP_LINE.test(line)) continue;

    const inline = matchInlineNutrientRow(line);
    if (inline) {
      rows.set(inline.label, cleanValue(inline.value));
      pendingLabel = null;
      continue;
    }

    const labelOnly = line.match(NUTRIENT_ROW);
    if (labelOnly) {
      pendingLabel = normalizeRowLabel(labelOnly[1]!);
      continue;
    }

    if (pendingLabel && looksLikeValue(line)) {
      rows.set(pendingLabel, cleanValue(line));
      pendingLabel = null;
      continue;
    }

    if (!productName && looksLikeProductName(line)) {
      productName = line;
    }
  }

  return { productName, rows };
}

function buildRowOrder(columns: StripColumn[]): string[] {
  const preferred = [
    'calories',
    'total fat',
    'saturated fat',
    'trans fat',
    'cholesterol',
    'sodium',
    'total carbohydrate',
    'dietary fiber',
    'total sugars',
    'protein',
  ];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const label of preferred) {
    if (columns.some((column) => column.rows.has(label))) {
      order.push(label);
      seen.add(label);
    }
  }
  for (const column of columns) {
    for (const label of column.rows.keys()) {
      if (!seen.has(label)) order.push(label);
    }
  }
  return order;
}

function matchInlineNutrientRow(line: string): { label: string; value: string } | null {
  const match = line.match(
    /^(calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrate|total carb|dietary fiber|fiber|total sugars?|protein)\s+(.+)$/i,
  );
  if (!match) return null;
  return { label: normalizeRowLabel(match[1]!), value: match[2]! };
}

function normalizeRowLabel(label: string): string {
  const key = label.toLowerCase().replace(/\s+/g, ' ').trim();
  if (key.startsWith('total carb')) return 'total carbohydrate';
  if (key === 'fiber') return 'dietary fiber';
  return key;
}

function formatRowLabel(label: string): string {
  if (label === 'calories') return 'Calories';
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanValue(value: string): string {
  return value.trim().split(/\s+/).slice(0, 2).join(' ');
}

function looksLikeValue(line: string): boolean {
  return /^\d/.test(line) || /\d\s*(?:g|mg|kcal)\b/i.test(line);
}

function looksLikeProductName(line: string): boolean {
  if (NUTRIENT_ROW.test(line)) return false;
  if (line.length < 2 || line.length > 48) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if (/^\d/.test(line)) return false;
  return true;
}
