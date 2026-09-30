import type { Nutrients } from '../types.js';
import { emptyNutrients } from './nutrients.js';

export type LabelParse = {
  servingLabel: string | null;
  nutrients: Nutrients;
  looksLikeLabel: boolean;
};

export function parseNutritionLabel(text: string): LabelParse {
  const raw = text.replace(/\r/g, '\n');
  const compact = normalizeCompact(raw);
  const nutrients = emptyNutrients();

  nutrients.calories = readCalories(compact, raw) ?? 0;
  nutrients.fat = readAmount(compact, raw, ['total fat', '(?<!saturated )\\bfat\\b'], 'g') ?? 0;
  nutrients.carbs = readAmount(compact, raw, ['total carb\\.?', 'total carbohydrates?', 'carbohydrates?'], 'g') ?? 0;
  nutrients.fiber = readAmount(compact, raw, ['dietary fiber', 'fiber'], 'g') ?? 0;
  nutrients.protein = readAmount(compact, raw, ['protein'], 'g') ?? 0;
  nutrients.sodium = readAmount(compact, raw, ['sodium'], 'mg') ?? 0;

  addExtra(nutrients, 'saturated_fat', 'Saturated fat', readAmount(compact, raw, ['saturated fat'], 'g'), 'g');
  addExtra(nutrients, 'sugar', 'Total sugars', readSugar(compact, raw), 'g');
  addExtra(nutrients, 'cholesterol', 'Cholesterol', readAmount(compact, raw, ['cholesterol'], 'mg'), 'mg');

  const servingLabel = servingSize(compact, raw) ?? mealKitServing(raw);
  const looksLikeLabel = hasAnyMacro(nutrients) || /nutrition facts/i.test(compact);

  return { servingLabel, nutrients, looksLikeLabel };
}

export function labelParseScore(text: string): number {
  const parsed = parseNutritionLabel(text);
  const n = parsed.nutrients;
  let score = 0;
  if (/nutrition facts/i.test(text)) score += 8;
  if (n.calories > 0) score += 4;
  if (n.protein > 0) score += 2;
  if (n.fat > 0) score += 2;
  if (n.carbs > 0) score += 2;
  if (n.fiber > 0) score += 1;
  if (n.sodium > 0) score += 1;
  if (parsed.servingLabel) score += 2;
  return score;
}

export function menuCandidates(text: string): string[] {
  const seen = new Set<string>();
  const lines = text.split(/\n/).map((line) => line.trim());
  return lines.filter((line) => keepCandidate(line, seen)).slice(0, 40);
}

function normalizeCompact(raw: string): string {
  return raw
    .replace(/calories from fat/gi, ' ')
    .replace(/total carb\./gi, 'total carbohydrate')
    .replace(/\s+/g, ' ')
    .trim();
}

function readCalories(compact: string, raw: string): number | null {
  const direct = compact.match(/\bcalories(?!\s+from\s+fat)\s*:?\s*(\d+(?:\.\d+)?)\b/i);
  if (direct) return Number(direct[1]);
  return lineAmount(raw, 'calories', '');
}

function readSugar(compact: string, raw: string): number | null {
  return readAmount(compact, raw, ['total sugars?', 'sugars?'], 'g', true);
}

function readAmount(
  compact: string,
  raw: string,
  labels: string[],
  unit: 'g' | 'mg' | '',
  allowLessThan = false,
): number | null {
  for (const label of labels) {
    const value = amountInText(compact, label, unit, allowLessThan) ?? lineAmount(raw, label, unit, allowLessThan);
    if (value != null) return value;
  }
  return null;
}

function amountInText(text: string, label: string, unit: 'g' | 'mg' | '', allowLessThan: boolean): number | null {
  const less = allowLessThan ? '<?\\s*' : '';
  const unitPattern = unit === 'g' ? '\\s*g' : unit === 'mg' ? '\\s*mg' : '(?:\\s*kcal)?';
  const match = text.match(
    new RegExp(`${label}\\s*:?\\s*${less}(\\d+(?:\\.\\d+)?)${unitPattern}(?:\\s*\\(?\\d+%\\)?)?`, 'i'),
  );
  if (!match) return null;
  return Number(match[1]);
}

function lineAmount(text: string, label: string, unit: 'g' | 'mg' | '', allowLessThan = false): number | null {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const namePattern = new RegExp(`^${label}\\s*:?$`, 'i');
  const less = allowLessThan ? '<?\\s*' : '';
  const unitPattern = unit === 'g' ? '\\s*g' : unit === 'mg' ? '\\s*mg' : '(?:\\s*kcal)?';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const inline = line.match(
      new RegExp(`^${label}\\s*:?\\s*${less}(\\d+(?:\\.\\d+)?)${unitPattern}`, 'i'),
    );
    if (inline) return Number(inline[1]);

    if (namePattern.test(line)) {
      const next = lines[index + 1];
      if (!next) continue;
      const follow = next.match(new RegExp(`^${less}(\\d+(?:\\.\\d+)?)\\s*(kcal|g|mg)?\\b`, 'i'));
      if (follow) return Number(follow[1]);
    }
  }
  return null;
}

function addExtra(nutrients: Nutrients, key: string, label: string, value: number | null, unit: string): void {
  if (value != null && value > 0) nutrients.extras.push({ key, label, amount: value, unit });
}

function servingSize(compact: string, raw: string): string | null {
  const fromCompact = compact.match(
    /serving size\s*:?\s*(.+?)(?:\s+amount per serving|\s+calories\b|\s+per\s+\d|$)/i,
  );
  if (fromCompact) return trimServing(fromCompact[1]);

  const lines = raw.split(/\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^serving size\s*:?$/i.test(lines[index] ?? '')) continue;
    const next = lines[index + 1];
    if (next) return trimServing(next);
  }
  return null;
}

function trimServing(value: string): string | null {
  const label = value.replace(/\s+/g, ' ').trim();
  if (!label) return null;
  return label.slice(0, 80);
}

function mealKitServing(text: string): string | null {
  const flat = text.replace(/\s+/g, ' ');
  if (!/nutrition values|green chef|per meal|1 serving/i.test(text) && !/calories\s+\d+\s*kcal/i.test(flat)) {
    return null;
  }
  return '1 serving';
}

function hasAnyMacro(nutrients: Nutrients): boolean {
  return nutrients.calories > 0 || nutrients.protein > 0 || nutrients.fat > 0 || nutrients.carbs > 0;
}

function keepCandidate(line: string, seen: Set<string>): boolean {
  if (line.length < 3 || line.length > 80) return false;
  if (/nutrition|calories|serving|ingredient|daily value|^\d|%$/.test(line.toLowerCase())) return false;
  const key = line.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
