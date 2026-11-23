import {
  buildCalorieRowCellsForStitch,
  shouldInjectCalorieRowOverride,
} from './sharedLabelHeaderCalories.js';
import { normalizeCellDigits } from './parseMultiProductLabelTable.js';
import { SHARED_GRID_MIN_VALUE_LINES_PER_COLUMN } from './splitSingleLabelParams.js';

export type SharedLabelStitchOptions = {
  /** Full OCR per product column above the ruled body (names, display calories, etc.). */
  headerColumnTexts?: string[];
  /** Full body strips (used to read display kcal before % Daily Value when row indices disagree). */
  valueColumnTexts?: string[];
};

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
  stitchOptions?: SharedLabelStitchOptions,
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
    extractProductNamesFromHeaderColumns(stitchOptions?.headerColumnTexts, columnCount) ??
    extractProductNames(headerBandText, columnCount) ??
    columns.map((_, index) => `Column ${index + 1}`);

  const valueTextsForCalories = stitchOptions?.valueColumnTexts ?? valueColumnTexts;
  const calorieOverride = buildCalorieRowCellsForStitch(
    valueTextsForCalories,
    stitchOptions?.headerColumnTexts,
  );

  const lines = ['Nutrition Facts', padNames(names, columnCount).join('  ')];
  for (let row = 0; row < rowCount; row += 1) {
    const rowKey = rowLabels[row]!;
    lines.push(formatRowLabel(rowKey));
    if (rowKey === 'calories' && shouldInjectCalorieRowOverride(calorieOverride)) {
      lines.push(padCalorieCells(calorieOverride, columnCount).join('  '));
      continue;
    }
    lines.push(
      valueRows
        .map((rows) => cleanValue(rows[row] ?? ''))
        .join('  '),
    );
  }

  const text = lines.join('\n');
  return /calories/i.test(text) ? text : null;
}

const DAILY_VALUE_SLICE = /%\s*daily\s*value/i;

function dailyValueTextInSlice(text: string): boolean {
  return DAILY_VALUE_SLICE.test(text.replace(/\s+/g, ' ').trim());
}

/** Row label from label OCR, or from value-column % Daily Value when the label band is empty. */
function rowLabelForBandIndex(
  labelSliceTexts: string[],
  valueSliceTextsPerColumn: string[][],
  index: number,
): string | null {
  const fromLabel = nutrientLabelFromRowBandSlice(labelSliceTexts[index] ?? '');
  if (fromLabel) return fromLabel;
  const valueHit = valueSliceTextsPerColumn.some((col) => dailyValueTextInSlice(col[index] ?? ''));
  if (valueHit) return '% Daily Value*';
  return null;
}

function countParsableLabelNutrientSlices(labelSliceTexts: string[]): number {
  let count = 0;
  for (const slice of labelSliceTexts) {
    if (nutrientLabelFromRowBandSlice(slice)) count += 1;
  }
  return count;
}

function valueSliceTextForLabelRow(
  valueSliceTexts: string[],
  rowLabel: string,
  nutrientRowOrdinal: number,
  labelNutrientSliceCount: number,
  labelSliceIndex: number,
  labelSliceCount: number,
): string {
  const key = rowLabel.toLowerCase();
  for (let i = 0; i < valueSliceTexts.length; i += 1) {
    const sliceLabel = nutrientLabelFromRowBandSlice(valueSliceTexts[i] ?? '');
    if (sliceLabel && sliceLabel.toLowerCase() === key) {
      return cleanValue(valueSliceTexts[i] ?? '');
    }
  }
  if (valueSliceTexts.length === labelSliceCount) {
    return cleanValue(valueSliceTexts[labelSliceIndex] ?? '');
  }
  if (valueSliceTexts.length === 0) return '';
  const nutrientCount = Math.max(1, labelNutrientSliceCount);
  const fraction = nutrientCount <= 1 ? 0 : nutrientRowOrdinal / (nutrientCount - 1);
  const vi = Math.round(fraction * (valueSliceTexts.length - 1));
  return cleanValue(valueSliceTexts[vi] ?? '');
}

/**
 * Stitch when each horizontal row band produced one OCR string per slice (shared-rail row-band path).
 * Rows come from the **label column**; value strips follow by row label or pitch-weighted index when counts differ.
 */
export function stitchSharedLabelGridFromRowBandSlices(
  labelSliceTexts: string[],
  valueSliceTextsPerColumn: string[][],
  headerBandText?: string,
  stitchOptions?: SharedLabelStitchOptions,
): string | null {
  if (valueSliceTextsPerColumn.length < 2 || labelSliceTexts.length === 0) return null;
  valueSliceTextsPerColumn = splitMergedDailyValueHeaderSlices(valueSliceTextsPerColumn);

  const columnCount = valueSliceTextsPerColumn.length;
  const names =
    extractProductNamesFromHeaderColumns(stitchOptions?.headerColumnTexts, columnCount) ??
    extractProductNames(headerBandText, columnCount) ??
    padNames([], columnCount);

  const seenRows = new Set<string>();
  const rowBlocks: Array<{ label: string; values: string[] }> = [];
  let nutrientRowOrdinal = 0;
  const bandCount = Math.max(
    labelSliceTexts.length,
    ...valueSliceTextsPerColumn.map((col) => col.length),
  );
  const readBandLabels = Array.from({ length: bandCount }, (_, i) =>
    rowLabelForBandIndex(labelSliceTexts, valueSliceTextsPerColumn, i),
  );
  const bandLabels = fillRowLabelsByCanonicalOrder(readBandLabels);
  const labelNutrientSliceCount =
    countParsableLabelNutrientSlices(labelSliceTexts) +
    bandLabels.filter((label, i) => label && !readBandLabels[i]).length;
  for (let i = 0; i < bandCount; i += 1) {
    const rowLabel = bandLabels[i];
    if (!rowLabel) continue;
    const key = rowLabel.toLowerCase();
    if (seenRows.has(key)) continue;

    const isDailyValueHeader = DAILY_VALUE_SLICE.test(rowLabel);
    const values = isDailyValueHeader
      ? valueSliceTextsPerColumn.map((col) => cleanValue(col[i] ?? ''))
      : valueSliceTextsPerColumn.map((col) =>
          valueSliceTextForLabelRow(
            col,
            rowLabel,
            nutrientRowOrdinal,
            labelNutrientSliceCount,
            i,
            labelSliceTexts.length,
          ),
        );
    nutrientRowOrdinal += 1;
    const hasDigit = values.some((v) => /\d/.test(v));
    const hasVaries = values.some((v) => /varies/i.test(v));
    if (!isDailyValueHeader && !hasDigit && !hasVaries && rowLabel !== 'calories') continue;
    if (rowLabel === 'calories' && !hasDigit && !hasVaries) continue;

    seenRows.add(key);
    rowBlocks.push({ label: rowLabel, values });
  }

  const valueTextsForCalories =
    stitchOptions?.valueColumnTexts ??
    valueSliceTextsPerColumn.map((col) => col.join('\n'));
  const calorieOverride = buildCalorieRowCellsForStitch(
    valueTextsForCalories,
    stitchOptions?.headerColumnTexts,
  );
  if (shouldInjectCalorieRowOverride(calorieOverride)) {
    const calCells = padCalorieCells(calorieOverride, columnCount);
    const calIdx = rowBlocks.findIndex((r) => r.label === 'calories');
    if (calIdx >= 0) rowBlocks[calIdx]!.values = calCells;
    else rowBlocks.unshift({ label: 'calories', values: calCells });
  }

  if (rowBlocks.length === 0 || !rowBlocks.some((r) => r.label === 'calories')) return null;

  const lines = ['Nutrition Facts', names.join('    ')];
  for (const row of rowBlocks) {
    lines.push(formatRowLabel(row.label));
    lines.push(row.values.map((v) => v.trim() || BLANK_CELL).join('  '));
  }
  const text = lines.join('\n');
  return /calories/i.test(text) ? text : null;
}

/** Keeps an empty OCR cell's column position when rows are re-split on whitespace gaps. */
const BLANK_CELL = '-';

function nutrientLabelFromRowBandSlice(sliceText: string): string | null {
  const line = sliceText.replace(/\s+/g, ' ').trim();
  if (!line || SKIP_LINE.test(line)) return null;
  if (/%\s*daily\s*value/i.test(line)) return null;

  const lineStart = line.match(
    /^(calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrate|total carb|dietary fiber|fiber|total sugars?|protein)\b/i,
  );
  if (lineStart) return normalizeRowLabel(lineStart[0]!);

  const labelOnly = line.match(NUTRIENT_ROW);
  if (labelOnly) return normalizeRowLabel(labelOnly[1]!);

  const inline = [...line.matchAll(NUTRIENT_ROW_INLINE)];
  if (inline.length === 1) return normalizeRowLabel(inline[0]![1]!);
  if (inline.length > 1) return normalizeRowLabel(inline[0]![1]!);
  return null;
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

function padCalorieCells(cells: string[], columnCount: number): string[] {
  const next = [...cells];
  while (next.length < columnCount) next.push('');
  return next.slice(0, columnCount).map((c) => c.trim());
}

function extractProductNamesFromHeaderColumns(
  headerColumnTexts: string[] | undefined,
  columnCount: number,
): string[] | null {
  if (!headerColumnTexts?.length) return null;
  const names = headerColumnTexts.slice(0, columnCount).map((text) => {
    const lines = text
      .replace(/\r/g, '\n')
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (looksLikeProductName(line)) return line;
    }
    return lines.find((line) => /[A-Za-z]/.test(line)) ?? '';
  });
  if (names.filter((n) => n.length >= 2).length < 2) return null;
  return padNames(names, columnCount);
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

/** Nutrition Facts rows always print in this order (FDA format). */
const CANONICAL_ROW_ORDER = [
  'Calories',
  'Total Fat',
  'Saturated Fat',
  'Trans Fat',
  'Cholesterol',
  'Sodium',
  'Total Carbohydrate',
  'Dietary Fiber',
  'Total Sugars',
  'Includes Added Sugars',
  'Protein',
];

function canonicalRowIndex(label: string | null): number {
  if (!label) return -1;
  const key = label.toLowerCase();
  return CANONICAL_ROW_ORDER.findIndex((name) => key.startsWith(name.toLowerCase().split(' ').slice(0, 2).join(' ')));
}

/**
 * Bands whose label OCR failed, sandwiched between two read labels, take the canonical rows in
 * between when the band count matches exactly (e.g. Trans Fat · ? · ? · Total Carbohydrate);
 * unread bands right after the last read row take the rows that follow it (… Added Sugars · ? → Protein).
 */
export function fillRowLabelsByCanonicalOrder(labels: Array<string | null>): Array<string | null> {
  const out = [...labels];
  let prev = -1;
  for (let i = 0; i < out.length; i += 1) {
    if (canonicalRowIndex(out[i] ?? null) < 0) continue;
    if (prev >= 0 && i - prev > 1) {
      const from = canonicalRowIndex(out[prev] ?? null);
      const to = canonicalRowIndex(out[i] ?? null);
      const gapBands = out.slice(prev + 1, i);
      if (to - from - 1 === gapBands.length && gapBands.every((label) => label === null)) {
        for (let k = 1; k <= gapBands.length; k += 1) out[prev + k] = CANONICAL_ROW_ORDER[from + k]!;
      }
    }
    prev = i;
  }
  if (prev >= 0) {
    let next = canonicalRowIndex(out[prev] ?? null) + 1;
    for (let i = prev + 1; i < out.length && out[i] === null && next < CANONICAL_ROW_ORDER.length; i += 1, next += 1) {
      out[i] = CANONICAL_ROW_ORDER[next]!;
    }
  }
  return out;
}

const READABLE_AMOUNT = /^<?\s*\d+(?:\.\d+)?(?!\d|\.|\s*%)/;

function leadingNumber(text: string): string | null {
  return text.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
}

/**
 * A row-aligned second read (EasyOCR in row mode emits one line per band) fills only the
 * slices the primary read left without digits, and only where a neighbouring slice agrees
 * between the two reads, so a misaligned alternate can't move values between rows.
 */
export function fillUnreadSlicesFromAlternateRead(primary: string[], alternate: string[]): string[] {
  const agrees = (i: number) =>
    i >= 0 && i < primary.length && leadingNumber(primary[i]!) !== null &&
    leadingNumber(primary[i]!) === leadingNumber(alternate[i] ?? '');
  return primary.map((slice, i) => {
    // "lOmg 52" has digits but no readable amount, so it counts as unread too.
    if (READABLE_AMOUNT.test(normalizeCellDigits(slice)) || dailyValueTextInSlice(slice)) return slice;
    // EasyOCR drops empty bands at the column ends, so a short alternate is padded, not refused.
    const candidate = (alternate[i] ?? '').trim();
    // Only an amount fills the cell; a lone "2%" is a daily value, not a mass, and a bare "5"
    // (a "5%" that lost its sign) needs a unit or a printed %DV beside it to count.
    const normalized = normalizeCellDigits(candidate);
    if (!READABLE_AMOUNT.test(normalized) || dailyValueTextInSlice(candidate)) return slice;
    if (!/^<?\s*[\d.]+\s*(?:m?c?g\b|\S*\s+\d{1,3}\s*%)/i.test(normalized)) return slice;
    return agrees(i - 1) || agrees(i + 1) ? candidate : slice;
  });
}

/** "% Daily Value" as OCR tends to garble it ("%Dally Valu", "% Daily Walue"). */
const FUZZY_DAILY_VALUE = /%\s*d[a-z]{2,4}\s*[vw][a-z]{2,4}/i;
const LEADING_AMOUNT = /^\s*(<?\s*\d+(?:\.\d+)?\s*m?g)\b/i;

/**
 * A curved column whose first row crop swallowed the "% Daily Value" header reads the Fat
 * amount on the header band ("9g %Dally Value 12%") and every later row one band early.
 * When most columns put the header on one band, split such a slice: the amount (and its
 * trailing %DV) moves to the next band and the rest of that column shifts down one band.
 */
export function splitMergedDailyValueHeaderSlices(columns: string[][]): string[][] {
  const bandCount = Math.max(0, ...columns.map((col) => col.length));
  let headerBand = -1;
  for (let i = 0; i < bandCount && headerBand < 0; i += 1) {
    const hits = columns.filter((col) => FUZZY_DAILY_VALUE.test(col[i] ?? '')).length;
    if (hits * 2 > columns.length) headerBand = i;
  }
  if (headerBand < 0) return columns;
  return columns.map((col) => {
    const slice = col[headerBand] ?? '';
    const amount = slice.match(LEADING_AMOUNT)?.[1];
    if (!amount || !FUZZY_DAILY_VALUE.test(slice)) return col;
    const percent = slice.match(/(\d{1,3})\s*%\s*$/)?.[1];
    const moved = percent ? `${amount} ${percent}%` : amount;
    const header = slice.replace(LEADING_AMOUNT, '').trim();
    // The Fat crop already read the same amount (and %DV): the column is aligned, only the
    // header is noisy. "3g 4%" over "3g 15%" is Fat over Sat Fat, so that still shifts.
    const next = col[headerBand + 1] ?? '';
    const nextPercent = next.match(/(\d{1,3})\s*%\s*$/)?.[1];
    const samePercent = !percent || !nextPercent || percent === nextPercent;
    if (leadingNumber(next) === leadingNumber(amount) && samePercent) {
      return [...col.slice(0, headerBand), header, ...col.slice(headerBand + 1)];
    }
    const shifted = [...col.slice(0, headerBand), header, moved, ...col.slice(headerBand + 1)];
    return shifted.slice(0, col.length);
  });
}
