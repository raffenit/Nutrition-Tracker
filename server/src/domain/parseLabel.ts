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

  mergeNutrients(nutrients, scanInlineLines(raw));
  mergeNutrients(nutrients, parseColumnarLabel(raw));

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
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/(\d+(?:\.\d+)?)\s*(g|mg|kcal)\b/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

type LabelSlot =
  | 'calories'
  | 'total_fat'
  | 'saturated_fat'
  | 'trans_fat'
  | 'cholesterol'
  | 'sodium'
  | 'total_carb'
  | 'fiber'
  | 'sugars'
  | 'protein';

function mergeNutrients(target: Nutrients, source: Nutrients | null): void {
  if (!source) return;
  if (target.calories <= 0 && source.calories > 0) target.calories = source.calories;
  if (target.fat <= 0 && source.fat > 0) target.fat = source.fat;
  if (target.carbs <= 0 && source.carbs > 0) target.carbs = source.carbs;
  if (target.fiber <= 0 && source.fiber > 0) target.fiber = source.fiber;
  if (target.protein <= 0 && source.protein > 0) target.protein = source.protein;
  if (target.sodium <= 0 && source.sodium > 0) target.sodium = source.sodium;
  for (const extra of source.extras) {
    if (target.extras.some((row) => row.key === extra.key)) continue;
    if (extra.amount > 0) target.extras.push({ ...extra });
  }
}

function scanInlineLines(raw: string): Nutrients {
  const nutrients = emptyNutrients();
  for (const line of raw.split(/\n/).map((row) => row.trim()).filter(Boolean)) {
    applySlot(nutrients, matchInlineLine(line));
  }
  return nutrients;
}

function matchInlineLine(line: string): { slot: LabelSlot; amount: number } | null {
  const rules: Array<[RegExp, LabelSlot]> = [
    [/^calories(?!\s+from\s+fat)\s*:?\s*(\d+(?:\.\d+)?)\b/i, 'calories'],
    [/^total fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_fat'],
    [/^fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_fat'],
    [/^saturated fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'saturated_fat'],
    [/^trans fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'trans_fat'],
    [/^cholesterol\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*mg\b/i, 'cholesterol'],
    [/^sodium\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*mg\b/i, 'sodium'],
    [/^total carb(?:ohydrate)?\.?\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_carb'],
    [/^carbohydrate\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_carb'],
    [/^dietary fiber\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'fiber'],
    [/^fiber\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'fiber'],
    [/^total sugars?\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'sugars'],
    [/^sugars?\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'sugars'],
    [/^protein\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'protein'],
  ];
  for (const [pattern, slot] of rules) {
    const match = line.match(pattern);
    if (match) return { slot, amount: Number(match[1]) };
  }
  return null;
}

function parseColumnarLabel(raw: string): Nutrients | null {
  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /nutrition facts|nutrition values|amount per serving/i.test(line));
  const window = (start >= 0 ? lines.slice(start + 1) : lines).slice(0, 40);

  const slots: LabelSlot[] = [];
  const amounts: number[] = [];

  for (const line of window) {
    if (/^(serving size|about \d|servings per|daily value)/i.test(line)) continue;
    const inline = matchInlineLine(line);
    if (inline) continue;
    const slot = classifyLabelOnlyLine(line);
    if (slot) {
      slots.push(slot);
      continue;
    }
    const amount = parseStandaloneAmount(line);
    if (amount != null) amounts.push(amount);
  }

  if (slots.length < 4 || amounts.length < 4) return null;
  if (Math.abs(slots.length - amounts.length) > 2) return null;

  const nutrients = emptyNutrients();
  const count = Math.min(slots.length, amounts.length);
  for (let index = 0; index < count; index += 1) {
    applySlot(nutrients, { slot: slots[index]!, amount: amounts[index]! });
  }
  return nutrients;
}

function classifyLabelOnlyLine(line: string): LabelSlot | null {
  if (/^calories\b/i.test(line) && !/from fat/i.test(line)) return 'calories';
  if (/saturated fat/i.test(line)) return 'saturated_fat';
  if (/trans fat/i.test(line)) return 'trans_fat';
  if (/total fat/i.test(line)) return 'total_fat';
  if (/^fat\b/i.test(line)) return 'total_fat';
  if (/cholesterol/i.test(line)) return 'cholesterol';
  if (/sodium/i.test(line)) return 'sodium';
  if (/total carb/i.test(line)) return 'total_carb';
  if (/^carbohydrate\b/i.test(line)) return 'total_carb';
  if (/dietary fiber/i.test(line)) return 'fiber';
  if (/^fiber\b/i.test(line)) return 'fiber';
  if (/added sugars/i.test(line)) return null;
  if (/total sugars?/i.test(line)) return 'sugars';
  if (/^sugars?\b/i.test(line)) return 'sugars';
  if (/^protein\b/i.test(line)) return 'protein';
  return null;
}

function parseStandaloneAmount(line: string): number | null {
  const withUnit = line.match(/^<?\s*(\d+(?:\.\d+)?)\s*(?:g|mg|kcal)\b/i);
  if (withUnit) return Number(withUnit[1]);
  if (/^\d+(?:\.\d+)?$/.test(line)) return Number(line);
  return null;
}

function applySlot(nutrients: Nutrients, row: { slot: LabelSlot; amount: number } | null): void {
  if (!row) return;
  const { slot, amount } = row;
  if (slot === 'calories') nutrients.calories = amount;
  else if (slot === 'total_fat') nutrients.fat = amount;
  else if (slot === 'total_carb') nutrients.carbs = amount;
  else if (slot === 'fiber') nutrients.fiber = amount;
  else if (slot === 'protein') nutrients.protein = amount;
  else if (slot === 'sodium') nutrients.sodium = amount;
  else if (slot === 'saturated_fat') addExtra(nutrients, 'saturated_fat', 'Saturated fat', amount, 'g');
  else if (slot === 'sugars') addExtra(nutrients, 'sugar', 'Total sugars', amount, 'g');
  else if (slot === 'cholesterol') addExtra(nutrients, 'cholesterol', 'Cholesterol', amount, 'mg');
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
  const plainName = label.includes('(') || label.includes('?') || label.includes('\\')
    ? null
    : new RegExp(`^${escapeRegex(label)}\\s*:?$`, 'i');
  const namePattern = plainName;
  const less = allowLessThan ? '<?\\s*' : '';
  const unitPattern = unit === 'g' ? '\\s*g' : unit === 'mg' ? '\\s*mg' : '(?:\\s*kcal)?';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const inline = line.match(
      new RegExp(`^${label}\\s*:?\\s*${less}(\\d+(?:\\.\\d+)?)${unitPattern}`, 'i'),
    );
    if (inline) return Number(inline[1]);

    if (namePattern?.test(line)) {
      const next = lines[index + 1];
      if (!next) continue;
      const withUnit = next.match(new RegExp(`^${less}(\\d+(?:\\.\\d+)?)\\s*(kcal|g|mg)\\b`, 'i'));
      if (withUnit) return Number(withUnit[1]);
      // Calories often appear as a bare number on the next OCR line; macros need a unit.
      if (/^calories$/i.test(label)) {
        const bare = next.match(new RegExp(`^${less}(\\d+(?:\\.\\d+)?)\\b`));
        if (bare) return Number(bare[1]);
      }
    }
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
