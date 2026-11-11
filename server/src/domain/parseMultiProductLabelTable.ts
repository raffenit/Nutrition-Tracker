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

const TABLE_END = /^(ingredients|distributed by|contains:|% daily value)/i;
const SKIP_LINE = /^(serving size|servings per|amount per serving|daily value|\*)\b/i;
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

  let pendingRow: string | null = null;
  for (const line of window) {
    if (line === header.sourceLine) continue;
    const rowLabel = matchNutrientRowLabel(line);
    const cells = splitTableCells(line);

    if (rowLabel) {
      pendingRow = rowLabel;
      const values = cells.length > 1 ? cells.slice(1) : [];
      if (values.length >= columnCount) {
        applyRowValues(columns, pendingRow, values.slice(0, columnCount));
        pendingRow = null;
      } else if (values.length > 0) {
        applyRowValues(columns, pendingRow, padValues(values, columnCount));
        pendingRow = null;
      }
      continue;
    }

    if (pendingRow && isValueOnlyLine(cells)) {
      applyRowValues(columns, pendingRow, padValues(cells, columnCount));
      pendingRow = null;
      continue;
    }

    if (isValueOnlyLine(cells) && cells.length >= columnCount) {
      continue;
    }

    const inlineLabel = cells[0] ? matchNutrientRowLabel(cells[0]) : null;
    if (inlineLabel && cells.length > 1) {
      applyRowValues(columns, inlineLabel, padValues(cells.slice(1), columnCount));
    }
  }

  const filled = columns.filter((col) => col.nutrients.calories > 0 || col.nutrients.protein > 0);
  if (filled.length < 2) return null;
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
  if (line.includes('|')) return line.split('|').map((cell) => cell.trim()).filter(Boolean);
  return line.split(/\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
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
  return /^\d+(?:\.\d+)?\s*(?:g|mg|kcal)?$/i.test(cell.trim()) || /^\d+(?:\.\d+)?$/.test(cell.trim());
}

function padValues(values: string[], columnCount: number): string[] {
  const next = [...values];
  while (next.length < columnCount) next.push('');
  return next.slice(0, columnCount);
}

function parseCellAmount(cell: string): number | null {
  const trimmed = cell.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function applyRowValues(columns: MultiProductColumn[], row: string, values: string[]): void {
  const key = row.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < columns.length; i += 1) {
    const amount = parseCellAmount(values[i] ?? '');
    if (amount === null) continue;
    const nutrients = columns[i]!.nutrients;
    if (key.startsWith('calories')) nutrients.calories = amount;
    else if (key.startsWith('total fat')) nutrients.fat = amount;
    else if (key.startsWith('saturated')) {
      nutrients.extras.push({ key: 'saturated_fat', label: 'Saturated fat', amount, unit: 'g' });
    } else if (key.startsWith('sodium')) nutrients.sodium = amount;
    else if (key.startsWith('total carb')) nutrients.carbs = amount;
    else if (key.startsWith('dietary fiber') || key === 'fiber') nutrients.fiber = amount;
    else if (key.startsWith('total sugar')) {
      nutrients.extras.push({ key: 'sugar', label: 'Total sugars', amount, unit: 'g' });
    } else if (key.startsWith('protein')) nutrients.protein = amount;
    else if (key.startsWith('cholesterol')) {
      nutrients.extras.push({ key: 'cholesterol', label: 'Cholesterol', amount, unit: 'mg' });
    }
  }
}
