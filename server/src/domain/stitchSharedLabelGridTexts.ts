import { SHARED_GRID_MIN_VALUE_LINES_PER_COLUMN } from './splitSingleLabelParams.js';

const NUTRIENT_ROW =
  /^(calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrate|total carb|dietary fiber|fiber|total sugars?|includes.+added sugars|protein)\b/i;
/** Nutrient name anywhere on a line — shared label-column OCR often prefixes garbage. */
const NUTRIENT_ROW_INLINE =
  /\b(calories|total\s+fat|saturated\s+fat|trans\s+fat|cholesterol|sodium|total\s+carb(?:ohydrate|ohyd\w*)?|dietary\s+fiber|(?<!dietary\s)\bfiber\b|total\s+sugars?|includes[^\n]{0,40}added\s+sugars?|protein)\b/gi;
const SKIP_LINE = /^(nutrition\s+facts|serving size|servings per|amount per serving|\*|% daily value)/i;

export type SharedLabelGridStitchFailure =
  | 'too_few_columns'
  | 'no_row_labels'
  | 'too_few_product_columns'
  | 'row_count_zero'
  | 'missing_calories_in_output';

export type SharedLabelGridStitchDiagnosis = {
  ok: boolean;
  failure: SharedLabelGridStitchFailure | null;
  rowLabelCount: number;
  productColumnCount: number;
  valueLineCounts: number[];
  rowCount: number;
};

export function diagnoseSharedLabelGridStitch(
  labelColumnText: string,
  valueColumnTexts: string[],
  headerBandText?: string,
): SharedLabelGridStitchDiagnosis {
  const rowLabels = extractRowLabels(labelColumnText);
  const allColumns = productColumnsForStitch(valueColumnTexts);
  const valueLineCounts = allColumns.map((col) => col.values.length);
  const confidentCount = allColumns.filter(
    (col) => col.values.length >= SHARED_GRID_MIN_VALUE_LINES_PER_COLUMN,
  ).length;
  const maxValueLines = valueLineCounts.length > 0 ? Math.max(...valueLineCounts) : 0;
  const rowCount =
    rowLabels.length > 0 && maxValueLines > 0 ? Math.min(rowLabels.length, maxValueLines) : 0;

  let failure: SharedLabelGridStitchFailure | null = null;
  if (valueColumnTexts.length < 2) failure = 'too_few_columns';
  else if (rowLabels.length === 0) failure = 'no_row_labels';
  else if (confidentCount < 2 && rowCount === 0) failure = 'too_few_product_columns';
  else if (rowCount === 0) failure = 'row_count_zero';
  else {
    const stitched = stitchSharedLabelGridTexts(labelColumnText, valueColumnTexts, headerBandText);
    if (!stitched || !/calories/i.test(stitched)) failure = 'missing_calories_in_output';
  }

  return {
    ok: failure === null,
    failure,
    rowLabelCount: rowLabels.length,
    productColumnCount: confidentCount,
    valueLineCounts,
    rowCount,
  };
}

export function formatSharedLabelStitchFailure(diag: SharedLabelGridStitchDiagnosis): string {
  if (diag.ok) return 'ok';
  const parts = [
    diag.failure ?? 'unknown',
    `rowLabels=${diag.rowLabelCount}`,
    `productCols=${diag.productColumnCount}`,
    `valueLines=[${diag.valueLineCounts.join(',')}]`,
    `rowCount=${diag.rowCount}`,
  ];
  return parts.join(' ');
}

/**
 * Build a wide table string for {@link parseMultiProductLabelTable} from a shared label column
 * and per-product strips (values — amounts, units, words like "Varies", not labels-only).
 *
 * Inputs follow `sharedLabelStitchContract.ts` (`SharedLabelStitchColumnTexts`):
 * `labelColumnText` is the full nutrient-name rail; `valueColumnTexts` are product values only.
 */
export function stitchSharedLabelGridTexts(
  labelColumnText: string,
  valueColumnTexts: string[],
  headerBandText?: string,
): string | null {
  const rowLabels = extractRowLabels(labelColumnText);
  if (rowLabels.length === 0 || valueColumnTexts.length < 2) return null;

  const columns = productColumnsForStitch(valueColumnTexts);
  const confident = columns.filter((col) => col.values.length >= SHARED_GRID_MIN_VALUE_LINES_PER_COLUMN);
  if (confident.length < 2) return null;

  const valueRows = columns.map((col) => col.values);
  const columnCount = columns.length;
  const maxValueLines = Math.max(...valueRows.map((rows) => rows.length));
  const rowCount = Math.min(rowLabels.length, maxValueLines);
  if (rowCount === 0) return null;

  const names =
    extractProductNames(headerBandText, columnCount) ??
    columns.map((_, index) => `Column ${index + 1}`);

  const lines = ['Nutrition Facts', padNames(names, columnCount).join('  ')];
  for (let row = 0; row < rowCount; row += 1) {
    lines.push(formatRowLabel(rowLabels[row]!));
    lines.push(
      valueRows
        .map((rows) => cleanValue(rows[row] ?? ''))
        .join('  '),
    );
  }

  const text = lines.join('\n');
  return /calories/i.test(text) ? text : null;
}

function productColumnsForStitch(valueColumnTexts: string[]): Array<{ text: string; values: string[] }> {
  return valueColumnTexts.map((text) => ({ text, values: extractValueLines(text) }));
}

export function extractRowLabels(text: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const push = (raw: string) => {
    const norm = normalizeRowLabel(raw.replace(/\s+/g, ' ').trim());
    const key = norm.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    labels.push(norm);
  };

  const lines = text.replace(/\r/g, '\n').split(/\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (SKIP_LINE.test(line)) continue;
    if (/%\s*daily\s*value/i.test(line)) continue;
    const lineStart = line.match(
      /^(calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrate|total carb|dietary fiber|fiber|total sugars?|protein)\b/i,
    );
    if (lineStart) {
      push(lineStart[0]!);
      continue;
    }
    const labelOnly = line.match(NUTRIENT_ROW);
    if (labelOnly) {
      push(labelOnly[1]!);
      continue;
    }
    for (const match of line.matchAll(NUTRIENT_ROW_INLINE)) {
      push(match[1]!);
    }
  }

  if (labels.length === 0) {
    for (const match of text.matchAll(NUTRIENT_ROW_INLINE)) {
      push(match[1]!);
    }
  }
  return labels;
}

export function extractValueLines(text: string): string[] {
  const values: string[] = [];
  let inTable = false;
  for (const raw of text.replace(/\r/g, '\n').split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/nutrition\s+facts/i.test(line)) continue;
    if (/%\s*daily\s*value/i.test(line)) {
      inTable = true;
      continue;
    }
    if (/amount\s+per\s+serving/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable && /\d/.test(line) && looksLikeValueCell(line)) inTable = true;
    if (!inTable) continue;
    if (SKIP_LINE.test(line)) continue;
    if (NUTRIENT_ROW.test(line)) continue;
    if (line.length > 80) continue;
    if (looksLikeProductName(line) && !/varies/i.test(line)) continue;
    if (looksLikeValueCell(line)) values.push(cleanValue(line));
  }
  return values;
}

function extractProductNames(headerBandText: string | undefined, columnCount: number): string[] | null {
  if (!headerBandText?.trim()) return null;
  const lines = headerBandText.replace(/\r/g, '\n').split(/\n/).map((line) => line.trim()).filter(Boolean);
  let best: string[] | null = null;
  for (const line of lines.slice(0, 8)) {
    const cells = splitTableCells(line);
    const names = cells.filter((cell) => looksLikeProductName(cell));
    if (names.length >= 2 && (!best || names.length > best.length)) {
      best = names;
    }
  }
  if (!best) return null;
  return padNames(best, columnCount);
}

function padNames(names: string[], columnCount: number): string[] {
  const next = [...names];
  while (next.length < columnCount) next.push(`Column ${next.length + 1}`);
  return next.slice(0, columnCount);
}

function splitTableCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim()).filter(Boolean);
  if (line.includes('|')) return line.split('|').map((cell) => cell.trim()).filter(Boolean);
  return line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
}

function normalizeRowLabel(label: string): string {
  const key = label.toLowerCase().replace(/\s+/g, ' ').trim();
  if (key.startsWith('total carb')) return 'total carbohydrate';
  if (key === 'fiber') return 'dietary fiber';
  return key.split(/\s+/)[0] === 'calories' ? 'calories' : key;
}

function formatRowLabel(label: string): string {
  if (label === 'calories') return 'Calories';
  return label.replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanValue(value: string): string {
  return value.trim().split(/\s+/).slice(0, 3).join(' ');
}

/** Nutrient cell text — digits, units, or words like “Varies”, not row labels. */
function looksLikeValueCell(line: string): boolean {
  if (/varies/i.test(line)) return true;
  if (/\d/.test(line)) return true;
  if (/\b(?:g|mg|mcg|kcal|iu)\b/i.test(line)) return true;
  if (/%/.test(line)) return true;
  if (/^<?\s*o\s*g$/i.test(line)) return true;
  return false;
}

function looksLikeProductName(line: string): boolean {
  if (NUTRIENT_ROW.test(line)) return false;
  if (/varies/i.test(line)) return false;
  if (line.length < 2 || line.length > 48) return false;
  if (!/[A-Za-z]/.test(line)) return false;
  if (/^\d/.test(line)) return false;
  if (/\b(?:bar|cup|pack|candies|chocolate|wafer)\b/i.test(line)) return true;
  if (/®|™/.test(line)) return true;
  return line.split(/\s+/).length <= 4 && /^[A-Za-z]/.test(line);
}
