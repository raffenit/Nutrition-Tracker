import { assessLabelFieldReview, type LabelFieldReviewMap } from './labelFieldReview.js';
import { emptyNutrients } from './nutrients.js';
import type { Nutrients } from '../types.js';

export type MultiProductColumn = {
  name: string;
  servingLabel: string | null;
  nutrients: Nutrients;
  /** Short text for import UI preview. */
  preview: string;
};

export type TableRow = { row: string; values: string[] };

function tableRow(row: string, values: string[]): TableRow {
  return { row, values };
}

const TABLE_END = /^(ingredients|distributed by|contains:)/i;
const SKIP_LINE = /^(serving size|servings per|amount per serving|daily value|\*|%?\s*daily\s*value)/i;
const NUTRIENT_ROW =
  /^(calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrate|total carb|dietary fiber|fiber|total sugars?|includes.+added sugars|protein)\b/i;

/** Variety-pack style panel: one Nutrition Facts heading, product names across columns. */
export function parseMultiProductLabelTable(text: string): MultiProductColumn[] | null {
  const raw = text.replace(/\r/g, '\n');
  if (!/nutrition\s+facts/i.test(raw)) return null;

  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /nutrition\s+facts/i.test(line));
  if (start < 0) return null;

  const window: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (TABLE_END.test(line)) break;
    if (SKIP_LINE.test(line)) continue;
    window.push(line);
  }
  if (window.length < 4) return null;

  const header = findProductHeaderRow(window);
  if (!header) return null;

  const { names, columnCount } = header;
  if (names.length < 2 || columnCount < 2) return null;

  const columns = names.map((name) => ({
    name,
    servingLabel: null as string | null,
    nutrients: emptyNutrients(),
    preview: name,
  }));

  const rows: TableRow[] = [];
  let pendingRow: string | null = null;
  for (const line of window) {
    if (line === header.sourceLine) continue;
    const rowLabel = matchNutrientRowLabel(line);
    const cells = splitTableCells(line);

    if (rowLabel) {
      pendingRow = rowLabel;
      const values = cells.length > 1 ? cells.slice(1) : [];
      if (values.length >= columnCount) {
        rows.push(tableRow(pendingRow, values.slice(0, columnCount)));
        pendingRow = null;
      } else if (values.length > 0) {
        rows.push(tableRow(pendingRow, padValues(values, columnCount)));
        pendingRow = null;
      }
      continue;
    }

    if (pendingRow && cells.length >= columnCount) {
      rows.push(tableRow(pendingRow, padValues(cells, columnCount)));
      pendingRow = null;
      continue;
    }
    if (pendingRow && isValueOnlyLine(cells)) {
      rows.push(tableRow(pendingRow, padValues(cells, columnCount)));
      pendingRow = null;
      continue;
    }

    if (isValueOnlyLine(cells) && cells.length >= columnCount) {
      continue;
    }

    const inlineLabel = cells[0] ? matchNutrientRowLabel(cells[0]) : null;
    if (inlineLabel && cells.length > 1) {
      rows.push(tableRow(inlineLabel, padValues(cells.slice(1), columnCount)));
    }
  }

  realignShiftedColumns(rows, columnCount);
  for (const row of rows) applyRowValues(columns, row.row, row.values);

  for (const column of columns) repairTrailingNineAgainstLabelMath(column.nutrients);

  const withMacros = columns.filter((col) => col.nutrients.calories > 0 || col.nutrients.protein > 0);
  if (withMacros.length < 1) {
    if (names.length >= 2) return columns;
    return null;
  }
  return columns;
}

export function multiProductColumnsToFieldReview(text: string, column: MultiProductColumn): LabelFieldReviewMap {
  return assessLabelFieldReview(text, {
    servingLabel: column.servingLabel,
    servingsPerContainer: null,
    nutrients: column.nutrients,
    looksLikeLabel: true,
  });
}

function findProductHeaderRow(window: string[]): { names: string[]; columnCount: number; sourceLine: string } | null {
  let best: { names: string[]; columnCount: number; sourceLine: string } | null = null;
  for (const line of window.slice(0, 12)) {
    if (NUTRIENT_ROW.test(line)) continue;
    if (/^(calories|total fat|protein|sodium)\b/i.test(line)) continue;
    const cells = splitTableCells(line);
    if (cells.length < 2) continue;
    const names = cells.filter((cell) => looksLikeProductName(cell));
    if (names.length < 2) continue;
    const candidate = { names, columnCount: cells.length, sourceLine: line };
    if (!best || names.length > best.names.length) best = candidate;
  }
  return best;
}

function looksLikeProductName(cell: string): boolean {
  const trimmed = cell.trim();
  if (trimmed.length < 2) return false;
  if (NUTRIENT_ROW.test(trimmed)) return false;
  if (/^(serving|amount per|daily value)/i.test(trimmed)) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (/^\d+(?:\.\d+)?\s*(?:g|mg|kcal)?$/i.test(trimmed)) return false;
  return true;
}

function splitTableCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim()).filter(Boolean);
  const byGap = line
    .split(/\s{2,}/)
    .map((cell) => cell.trim())
    .filter((cell) => cell && !/^\|+$/.test(cell));
  if (byGap.length >= 2) return byGap;
  if (line.includes('|')) return line.split('|').map((cell) => cell.trim()).filter(Boolean);
  return byGap;
}

function matchNutrientRowLabel(line: string): string | null {
  const match = line.match(NUTRIENT_ROW);
  return match ? match[1]!.toLowerCase() : null;
}

function isValueOnlyLine(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((cell) => isNumericCell(cell));
}

function isNumericCell(cell: string): boolean {
  if (isBlankCellPlaceholder(cell)) return true;
  return /^\d+(?:\.\d+)?\s*(?:g|mg|kcal)?$/i.test(cell.trim()) || /^\d+(?:\.\d+)?$/.test(cell.trim());
}

/** Stitched grids write `-` for an unread cell so later columns keep their position. */
function isBlankCellPlaceholder(cell: string): boolean {
  return /^[-–—]$/.test(cell.trim());
}

function padValues(values: string[], columnCount: number): string[] {
  const next = [...values];
  while (next.length < columnCount) next.push('');
  return next.slice(0, columnCount);
}

/** "Ilg" → "11g", "<lg" → "<1g": I / l / | read for 1 next to digits or a mass unit. */
export function normalizeCellDigits(cell: string): string {
  return cell
    .trim()
    .replace(/^<\s*[Il|](?=\s*(?:m?g)\b)/, '<1')
    .replace(/^[Oo](?=\s*m?g\b)/, '0')
    .replace(/(?<=\d)[Oo]+(?=\s*m?g\b)/, (zeros) => '0'.repeat(zeros.length))
    .replace(/^[Il|]+(?=[\d.]|\s*m?g\b)/, (ones) => '1'.repeat(ones.length))
    .replace(/(?<=\d)[Il|]+(?=\s*m?g\b)/, (ones) => '1'.repeat(ones.length));
}

function parseCellAmount(cell: string): number | null {
  const trimmed = normalizeCellDigits(cell);
  const match = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** FDA daily values for rows whose printed %DV can check the amount. */
const ROW_DAILY_VALUES: Array<[string, number]> = [
  ['total fat', 78],
  ['saturated', 20],
  ['cholesterol', 300],
  ['sodium', 2300],
  ['total carb', 275],
  ['dietary fiber', 28],
  ['protein', 50],
  ['includes', 50],
];

/**
 * "459 23%" is "4.5g 23%" with the "g" read as a trailing 9 and the decimal lost: keep the
 * reading (raw, without a trailing 9, with a decimal restored) whose %DV matches the printed one.
 */
export function reconcileAmountWithDailyValue(cell: string, dailyValue: number): number | null {
  const match = normalizeCellDigits(cell).match(/^(\d+(?:\.\d+)?)\D{0,3}?\s+(\d{1,3})\s*%/);
  if (!match) return null;
  const literal = match[1]!;
  const percent = Number(match[2]);
  const options = new Set<number>([Number(literal)]);
  const stripped = /^\d+9$/.test(literal) ? literal.slice(0, -1) : null;
  for (const base of [literal, stripped]) {
    if (!base || base.includes('.')) continue;
    options.add(Number(base));
    if (base.length >= 2) options.add(Number(`${base.slice(0, -1)}.${base.slice(-1)}`));
  }
  const fits = (amount: number) => Math.abs((amount / dailyValue) * 100 - percent) <= Math.max(1.5, percent * 0.1);
  if (fits(Number(literal))) return Number(literal);
  const matches = [...options].filter((amount) => amount > 0 && fits(amount));
  return matches.length === 1 ? matches[0]! : null;
}

const MG_ROWS = /^(cholesterol|sodium)/;

/** +: the cell's unit and printed %DV fit this row; -: the unit rules the row out. */
function cellRowFit(row: string, cell: string): number {
  const normalized = normalizeCellDigits(cell);
  if (!normalized || isBlankCellPlaceholder(normalized)) return 0;
  const mgRow = MG_ROWS.test(row);
  let score = 0;
  if (/\d\s*mg\b/i.test(normalized)) score += mgRow ? 2 : -3;
  else if (/\d\s*g\b/i.test(normalized)) score += mgRow ? -3 : 1;
  const dailyValue = ROW_DAILY_VALUES.find(([prefix]) => row.startsWith(prefix))?.[1];
  if (dailyValue && reconcileAmountWithDailyValue(normalized, dailyValue) !== null) score += 2;
  return score;
}

/**
 * On curved packs one column's lower rows can land a row above or below their labels
 * ("55mg 2%" under Total Carbohydrate). Per column, try shifting every row from some point
 * down by one row either way and keep the shift when units and %DV fit clearly better.
 * A missing trailing Protein row is added so a column shifted up can still fill it.
 */
export function realignShiftedColumns(rows: TableRow[], columnCount: number): void {
  const block = rows.filter((row) => !row.row.startsWith('calories'));
  if (block.length < 4) return;
  if (!block.some((row) => row.row.startsWith('protein')) && block[block.length - 1]!.row.startsWith('includes')) {
    const protein = tableRow('protein', Array.from({ length: columnCount }, () => ''));
    rows.push(protein);
    block.push(protein);
  }
  const fitOf = (cells: string[]) => cells.reduce((sum, cell, i) => sum + cellRowFit(block[i]!.row, cell), 0);
  for (let c = 0; c < columnCount; c += 1) {
    const cells = block.map((row) => row.values[c] ?? '');
    let best = { fit: fitOf(cells) + 2, cells };
    for (let start = 0; start < cells.length; start += 1) {
      for (const offset of [-1, 1]) {
        const shifted = cells.map((cell, i) => {
          if (i < start) return offset === -1 && i === start - 1 ? '' : cell;
          return cells[i + offset] ?? '';
        });
        const fit = fitOf(shifted);
        if (fit > best.fit) best = { fit, cells: shifted };
      }
    }
    if (best.cells !== cells) best.cells.forEach((cell, i) => (block[i]!.values[c] = cell));
  }
}

function applyRowValues(columns: MultiProductColumn[], row: string, values: string[]): void {
  const key = row.replace(/\s+/g, ' ').trim();
  const dailyValue = ROW_DAILY_VALUES.find(([prefix]) => key.startsWith(prefix))?.[1];
  for (let i = 0; i < columns.length; i += 1) {
    const cell = values[i] ?? '';
    const amount = (dailyValue ? reconcileAmountWithDailyValue(cell, dailyValue) : null) ?? parseCellAmount(cell);
    if (amount === null) continue;
    const nutrients = columns[i]!.nutrients;
    if (key.startsWith('calories')) nutrients.calories = amount;
    else if (key.startsWith('total fat')) nutrients.fat = amount;
    else if (key.startsWith('saturated')) {
      nutrients.extras.push({ key: 'saturated_fat', label: 'Saturated fat', amount, unit: 'g' });
    } else if (key.startsWith('sodium')) nutrients.sodium = amount;
    else if (key.startsWith('total carb')) nutrients.carbs = amount;
    else if (key.startsWith('dietary fiber') || key === 'fiber') nutrients.fiber = amount;
    else if (key.startsWith('includes')) {
      nutrients.extras.push({ key: 'added_sugars', label: 'Added sugars', amount, unit: 'g' });
    } else if (key.startsWith('total sugar')) {
      nutrients.extras.push({ key: 'sugar', label: 'Total sugars', amount, unit: 'g' });
    } else if (key.startsWith('protein')) nutrients.protein = amount;
    else if (key.startsWith('cholesterol')) {
      nutrients.extras.push({ key: 'cholesterol', label: 'Cholesterol', amount, unit: 'mg' });
    }
  }
}

/**
 * Amount that breaks the label's own limits: try the usual misreads — "g" read as a trailing 9
 * ("129" for 12g) and a lost half-gram decimal ("35" for 3.5g; labels round small fat/sugar
 * amounts to 0.5 g, so only a trailing 5 can hide a decimal) — and keep the first that fits.
 */
function stripTrailingNineToFit(amount: number, limit: number): number {
  if (!(limit > 0) || amount <= limit) return amount;
  const literal = String(amount);
  const candidates: number[] = [];
  const withoutNine = /^\d+9$/.test(literal) ? literal.slice(0, -1) : null;
  if (withoutNine) candidates.push(Number(withoutNine));
  for (const digits of [withoutNine, literal]) {
    if (digits && /^\d+5$/.test(digits)) candidates.push(Number(digits) / 10);
  }
  return candidates.find((candidate) => candidate > 0 && candidate <= limit) ?? amount;
}

export function repairTrailingNineAgainstLabelMath(nutrients: Nutrients): void {
  if (nutrients.calories > 0) {
    nutrients.carbs = stripTrailingNineToFit(nutrients.carbs, nutrients.calories / 4);
    nutrients.fat = stripTrailingNineToFit(nutrients.fat, nutrients.calories / 9);
    nutrients.protein = stripTrailingNineToFit(nutrients.protein, nutrients.calories / 4);
  }
  nutrients.fiber = stripTrailingNineToFit(nutrients.fiber, nutrients.carbs);
  for (const extra of nutrients.extras) {
    if (extra.key === 'sugar') extra.amount = stripTrailingNineToFit(extra.amount, nutrients.carbs);
    if (extra.key === 'saturated_fat') extra.amount = stripTrailingNineToFit(extra.amount, nutrients.fat);
  }
  const totalSugars = nutrients.extras.find((extra) => extra.key === 'sugar')?.amount ?? 0;
  for (const extra of nutrients.extras) {
    if (extra.key === 'added_sugars') extra.amount = stripTrailingNineToFit(extra.amount, totalSugars || nutrients.carbs);
  }
}
