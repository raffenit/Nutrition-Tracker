import { emptyNutrients } from './nutrients.js';
import type { Nutrients } from '../types.js';

export type MenuItemDraft = {
  name: string;
  servingLabel: string;
  nutrients: Nutrients;
};

export type NutrientKey =
  | 'calories'
  | 'fat'
  | 'saturatedFat'
  | 'cholesterol'
  | 'sodium'
  | 'carbs'
  | 'fiber'
  | 'sugar'
  | 'protein';

export type ColumnSchema = {
  nameCol: number;
  servingCol: number | null;
  fields: Partial<Record<NutrientKey, number>>;
};

type HeaderRole = 'name' | 'serving' | NutrientKey | 'skip' | null;

const HEADER_RULES: { role: Exclude<HeaderRole, null>; pattern: RegExp }[] = [
  { role: 'name', pattern: /\b(item|menu|food|product|description|meal|dish)\b/i },
  { role: 'name', pattern: /^name$/i },
  { role: 'serving', pattern: /\b(serving|portion|size)\b/i },
  { role: 'calories', pattern: /\b(calories|calorie|energy\s*\(kcal\)|\bkcal\b)/i },
  { role: 'calories', pattern: /^cal\b/i },
  { role: 'fat', pattern: /\btotal\s*fat\b/i },
  { role: 'fat', pattern: /^fat(\s*\(g\))?$/i },
  { role: 'saturatedFat', pattern: /\b(saturated|sat\.?\s*fat)/i },
  { role: 'cholesterol', pattern: /\bcholesterol\b/i },
  { role: 'sodium', pattern: /\b(sodium|salt)\b/i },
  { role: 'carbs', pattern: /\b(total\s*)?(carb|carbohydrate)/i },
  { role: 'fiber', pattern: /\b(dietary\s*)?(fiber|fibre)\b/i },
  { role: 'sugar', pattern: /\b(total\s*)?sugars?\b/i },
  { role: 'protein', pattern: /\bprotein\b/i },
  { role: 'skip', pattern: /\b(trans\s*fat|added\s*sugars?|weight\s*watchers)\b/i },
];

export function classifyHeaderCell(cell: string): HeaderRole {
  const trimmed = cell.replace(/\([^)]*\)/g, ' ').trim();
  for (const { role, pattern } of HEADER_RULES) {
    if (pattern.test(trimmed) || pattern.test(cell)) return role;
  }
  return null;
}

export function isNutritionHeaderRow(cells: string[]): boolean {
  const roles = cells.map((c) => classifyHeaderCell(c));
  const hasCalories = roles.includes('calories');
  const hasMacro = roles.some((r) => r === 'fat' || r === 'protein' || r === 'carbs');
  return hasCalories && hasMacro;
}

export function schemaFromHeader(cells: string[]): ColumnSchema | null {
  let nameCol = -1;
  let servingCol: number | null = null;
  const fields: Partial<Record<NutrientKey, number>> = {};

  cells.forEach((cell, index) => {
    const role = classifyHeaderCell(cell);
    if (role === 'name') nameCol = index;
    else if (role === 'serving') servingCol = index;
    else if (role === 'skip' || role === null) return;
    else if (fields[role] === undefined) fields[role] = index;
  });

  if (fields.calories === undefined) return null;
  if (nameCol < 0) nameCol = 0;
  if (Object.keys(fields).length < 2) return null;

  return { nameCol, servingCol, fields };
}

/** When the header omits a serving column but data rows include one before calories. */
export function effectiveSchema(schema: ColumnSchema, cells: string[]): ColumnSchema {
  const calIdx = schema.fields.calories;
  if (calIdx === undefined) return schema;
  if (looksNumeric(cells[calIdx] ?? '')) return schema;
  if (!looksNumeric(cells[calIdx + 1] ?? '')) return schema;

  const servingCol = calIdx;
  const bump = (idx: number) => (idx >= calIdx ? idx + 1 : idx);
  const fields: Partial<Record<NutrientKey, number>> = {};
  for (const [key, idx] of Object.entries(schema.fields) as [NutrientKey, number][]) {
    fields[key] = bump(idx);
  }
  return { nameCol: schema.nameCol, servingCol, fields };
}

const INFER_TEMPLATES: ColumnSchema[] = [
  {
    nameCol: 0,
    servingCol: null,
    fields: {
      calories: 1,
      fat: 2,
      saturatedFat: 3,
      cholesterol: 5,
      sodium: 6,
      carbs: 7,
      fiber: 8,
      sugar: 9,
      protein: 10,
    },
  },
  {
    nameCol: 0,
    servingCol: 1,
    fields: {
      calories: 2,
      fat: 3,
      saturatedFat: 4,
      cholesterol: 6,
      sodium: 7,
      carbs: 8,
      fiber: 9,
      sugar: 10,
      protein: 12,
    },
  },
];

export function inferSchemaFromRows(rows: string[][]): ColumnSchema | null {
  let best: { schema: ColumnSchema; score: number } | null = null;
  for (const schema of INFER_TEMPLATES) {
    const score = scoreSchema(schema, rows);
    if (score > 0 && (!best || score > best.score)) best = { schema, score };
  }
  return best?.schema ?? null;
}

function scoreSchema(schema: ColumnSchema, rows: string[][]): number {
  let score = 0;
  for (const row of rows) {
    const item = rowToMenuItem(row, schema);
    if (item && item.nutrients.calories > 0) score += 2;
    else if (item) score += 1;
  }
  return score;
}

export function rowToMenuItem(cells: string[], schema: ColumnSchema): MenuItemDraft | null {
  const active = effectiveSchema(schema, cells);
  const name = cleanName(cells[active.nameCol] ?? '');
  if (!name || isHeaderLikeName(name)) return null;

  const calIdx = active.fields.calories;
  if (calIdx === undefined || !looksNumeric(cells[calIdx] ?? '')) return null;

  let servingLabel = '1 serving';
  if (active.servingCol != null) {
    const raw = (cells[active.servingCol] ?? '').trim();
    if (raw && !looksNumeric(raw)) servingLabel = raw;
  }

  const nutrients = nutrientsFromMappedFields(cells, active.fields);
  if (nutrients.calories <= 0 && nutrients.protein <= 0 && nutrients.fat <= 0) return null;

  return { name, servingLabel, nutrients };
}

function nutrientsFromMappedFields(
  cells: string[],
  fields: Partial<Record<NutrientKey, number>>,
): Nutrients {
  const pick = (key: NutrientKey) => {
    const idx = fields[key];
    return idx === undefined ? '' : cells[idx] ?? '';
  };
  const nutrients = emptyNutrients();
  nutrients.calories = parseAmount(pick('calories'));
  nutrients.fat = parseAmount(pick('fat'));
  nutrients.carbs = parseAmount(pick('carbs'));
  nutrients.fiber = parseAmount(pick('fiber'));
  nutrients.protein = parseAmount(pick('protein'));
  nutrients.sodium = parseAmount(pick('sodium'));
  const saturated = parseAmount(pick('saturatedFat'));
  const sugar = parseAmount(pick('sugar'));
  const cholesterol = parseAmount(pick('cholesterol'));
  if (saturated > 0) {
    nutrients.extras.push({ key: 'saturated_fat', label: 'Saturated fat', amount: saturated, unit: 'g' });
  }
  if (sugar > 0) nutrients.extras.push({ key: 'sugar', label: 'Total sugars', amount: sugar, unit: 'g' });
  if (cholesterol > 0) {
    nutrients.extras.push({ key: 'cholesterol', label: 'Cholesterol', amount: cholesterol, unit: 'mg' });
  }
  return nutrients;
}

export function parseAmount(raw: string): number {
  const value = raw.replace(/,/g, '').trim();
  if (!value || value === '—' || value === '-') return 0;
  if (value.startsWith('<')) {
    const less = Number(value.slice(1));
    return Number.isFinite(less) ? less : 0.5;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function looksNumeric(raw: string): boolean {
  const trimmed = raw.replace(/,/g, '').trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return false;
  if (trimmed.startsWith('<')) return /^<\d+(\.\d+)?$/.test(trimmed);
  return /^\d+(\.\d+)?$/.test(trimmed);
}

export function cleanName(raw: string): string {
  const title = raw.match(/\btitle=["']([^"']+)["']/i);
  if (title) return decodeHtml(title[1]).trim();
  const markdown = raw.match(/\[([^\]]+)\]/);
  if (markdown) return markdown[1].trim();
  const stripped = raw.replace(/\[more info\].*/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return decodeHtml(stripped);
}

function isHeaderLikeName(name: string): boolean {
  return /\b(calories|total fat|protein|sodium)\b/i.test(name) && name.length < 40;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}
