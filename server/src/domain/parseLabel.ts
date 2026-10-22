import type { Nutrients } from '../types.js';
import {
  correctAmountIfUnitMisreadAsSuffix,
  expandOcrDecimalBeforeGram,
  findEmbeddedCanonicalSpan,
  parseAmountWithFuzzyUnit,
} from './ocrConfusables.js';
import { classifyVariantLabelLine, embeddedCanonicalForSlot, matchVariantLabelToken } from './labelVariants.js';
import { parseServingsPerContainerVariant, parseServingSizeVariant } from './labelHeaderParse.js';
import { estimateSaturatedFatFromOcrSlice } from './labelUnits.js';
import {
  inferNutrientsFromUnits,
  normalizeOcrUnitNoise,
  parseMeasuredAmount,
  readSodiumFromMacroGap,
} from './labelUnits.js';
import { emptyNutrients } from './nutrients.js';

export type LabelParse = {
  servingLabel: string | null;
  /** From “N servings per container” when present on the label. */
  servingsPerContainer: number | null;
  nutrients: Nutrients;
  looksLikeLabel: boolean;
};

export function parseNutritionLabel(text: string): LabelParse {
  const raw = text.replace(/\r/g, '\n');
  const compact = normalizeCompact(raw);
  const nutrients = emptyNutrients();
  const inline = scanInlineLines(raw);
  const columnar = parseColumnarLabel(raw);
  const linePairs = nutrientsFromLabelLinePairs(raw);

  if (columnar) {
    mergeNutrients(nutrients, columnar);
    mergeNutrients(nutrients, inline);
    mergeNutrients(nutrients, linePairs ?? emptyNutrients());
  } else {
    nutrients.calories = readCalories(compact, raw) ?? 0;
    nutrients.fat =
      readAmount(compact, raw, ['total fat'], 'g') ?? readStandaloneFatGrams(raw) ?? readTotalFatGramsNoisy(raw) ?? 0;
    nutrients.carbs = readAmount(compact, raw, ['total carb\\.?', 'total carbohydrates?', 'carbohydrates?'], 'g') ?? 0;
    nutrients.fiber = readAmount(compact, raw, ['dietary fiber', 'fiber'], 'g') ?? readFiberGramsNoisy(raw) ?? 0;
    nutrients.protein = readAmount(compact, raw, ['protein'], 'g') ?? 0;
    nutrients.sodium = readAmount(compact, raw, ['sodium'], 'mg') ?? readSodiumMgNoisy(raw) ?? 0;

    mergeNutrients(nutrients, inline);
    mergeNutrients(nutrients, linePairs ?? emptyNutrients());
    mergeNutrients(nutrients, columnar);
  }

  mergeNutrients(nutrients, inferNutrientsFromUnits(raw));

  addExtra(
    nutrients,
    'saturated_fat',
    'Saturated fat',
    readAmount(compact, raw, ['saturated fat'], 'g') ?? readSaturatedFatGramsNoisy(raw, nutrients.fat),
    'g',
  );
  addExtra(nutrients, 'sugar', 'Total sugars', readSugar(compact, raw), 'g');
  addExtra(nutrients, 'cholesterol', 'Cholesterol', readAmount(compact, raw, ['cholesterol'], 'mg'), 'mg');

  const servingLabel =
    servingSize(compact, raw) ?? parseServingSizeVariant(raw) ?? mealKitServing(raw);
  const servingsPerContainer =
    servingsPerContainerFromLabel(compact, raw) ?? parseServingsPerContainerVariant(raw);
  const looksLikeLabel = hasAnyMacro(nutrients) || /nutrition facts/i.test(compact);

  return { servingLabel, servingsPerContainer, nutrients, looksLikeLabel };
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
    const cleaned = line.replace(/^[\s|[\]()]+/, '');
    applySlot(nutrients, matchInlineLine(cleaned));
  }
  return nutrients;
}

/** Interleaved OCR: label row then amount row (not the separate label block / value block layout). */
function nutrientsFromLabelLinePairs(raw: string): Nutrients | null {
  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /nutrition facts|nutrition values|amount per serving/i.test(line));
  const window = (start >= 0 ? lines.slice(start) : lines).slice(0, 55);
  if (looksLikeColumnarBlock(window)) return null;

  const nutrients = emptyNutrients();
  for (let index = 0; index < window.length; index += 1) {
    const line = window[index] ?? '';
    applySlot(nutrients, matchInlineLine(line));

    const slot = classifyLabelOnlyLine(line);
    if (!slot || slotValue(nutrients, slot) > 0) continue;

    const amount = readAmountFollowing(window, index, slot);
    if (amount != null) applySlot(nutrients, { slot, amount });
  }
  return nutrients;
}

function looksLikeColumnarBlock(lines: string[]): boolean {
  let consecutiveLabels = 0;
  let maxLabelRun = 0;
  let valueLinesAfterLabelRun = 0;
  let inValueBlock = false;
  for (const line of lines) {
    if (classifyLabelOnlyLine(line)) {
      if (inValueBlock) continue;
      consecutiveLabels += 1;
      maxLabelRun = Math.max(maxLabelRun, consecutiveLabels);
      continue;
    }
    const amount = parseStandaloneAmount(line);
    if (consecutiveLabels >= 2 && amount != null && !isLikelyDailyValuePercentLine(line, amount)) {
      inValueBlock = true;
      valueLinesAfterLabelRun += 1;
      consecutiveLabels = 0;
      continue;
    }
    if (matchInlineLine(line) && inValueBlock) continue;
    consecutiveLabels = 0;
  }
  return maxLabelRun >= 2 && valueLinesAfterLabelRun >= 2;
}

function readAmountFollowing(lines: string[], labelIndex: number, slot: LabelSlot): number | null {
  for (let index = labelIndex + 1; index < Math.min(labelIndex + 12, lines.length); index += 1) {
    const line = lines[index] ?? '';
    if (matchInlineLine(line)) return null;
    if (classifyLabelOnlyLine(line)) continue;
    const amount = parseStandaloneAmount(line);
    if (amount == null) continue;
    if (isLikelyDailyValuePercentLine(line, amount)) continue;
    if (!amountMatchesSlot(line, slot)) continue;
    return finalizeMassAmountForSlot(line, amount, slot);
  }
  return null;
}

function isGramMacroSlot(slot: LabelSlot): boolean {
  return (
    slot === 'total_fat' ||
    slot === 'saturated_fat' ||
    slot === 'trans_fat' ||
    slot === 'total_carb' ||
    slot === 'fiber' ||
    slot === 'sugars' ||
    slot === 'protein'
  );
}

function finalizeMassAmountForSlot(line: string, amount: number, slot: LabelSlot): number {
  const literal = line.match(/^<?\s*(\d+(?:\.\d+)?)/)?.[1] ?? String(amount);
  if (isGramMacroSlot(slot)) {
    return correctAmountIfUnitMisreadAsSuffix(literal, 'g', line);
  }
  if (slot === 'sodium' || slot === 'cholesterol') {
    return correctAmountIfUnitMisreadAsSuffix(literal, 'mg', line);
  }
  return amount;
}

function amountMatchesSlot(line: string, slot: LabelSlot): boolean {
  const normalized = normalizeOcrUnitNoise(line);
  const measured = parseMeasuredAmount(normalized);
  if (measured) {
    if (slot === 'calories') return measured.unit === 'kcal';
    if (slot === 'sodium' || slot === 'cholesterol') return measured.unit === 'mg';
    if (slot === 'total_fat' || slot === 'saturated_fat' || slot === 'trans_fat' || slot === 'total_carb' || slot === 'fiber' || slot === 'sugars' || slot === 'protein') {
      return measured.unit === 'g';
    }
  }
  if (slot === 'calories') return !/\d\s*g\b/i.test(line) && !/\d\s*mg\b/i.test(line);
  if (slot === 'sodium' || slot === 'cholesterol') return /\d\s*mg\b/i.test(line) || /mg\b/i.test(line) || /Ng\b/i.test(normalized);
  if (
    slot === 'total_fat' ||
    slot === 'saturated_fat' ||
    slot === 'trans_fat' ||
    slot === 'total_carb' ||
    slot === 'fiber' ||
    slot === 'sugars' ||
    slot === 'protein'
  ) {
    return /\d\s*g\b/i.test(line) || /\dg\b/i.test(line) || /\d\s*gm\b/i.test(normalized);
  }
  return true;
}

function slotValue(nutrients: Nutrients, slot: LabelSlot): number {
  if (slot === 'calories') return nutrients.calories;
  if (slot === 'total_fat') return nutrients.fat;
  if (slot === 'total_carb') return nutrients.carbs;
  if (slot === 'fiber') return nutrients.fiber;
  if (slot === 'protein') return nutrients.protein;
  if (slot === 'sodium') return nutrients.sodium;
  if (slot === 'saturated_fat') return nutrients.extras.find((row) => row.key === 'saturated_fat')?.amount ?? 0;
  if (slot === 'sugars') return nutrients.extras.find((row) => row.key === 'sugar')?.amount ?? 0;
  if (slot === 'cholesterol') return nutrients.extras.find((row) => row.key === 'cholesterol')?.amount ?? 0;
  return 0;
}

function isLikelyDailyValuePercentLine(line: string, amount: number): boolean {
  if (amount < 0) return /^\d{1,2}\s*%?\s*$/.test(line.trim());
  if (!/^\d{1,2}\s*%?\s*$/.test(line.trim())) return false;
  return amount <= 99;
}

function matchInlineLine(line: string): { slot: LabelSlot; amount: number } | null {
  const rules: Array<[RegExp, LabelSlot]> = [
    [/^calories(?!\s+from\s+fat)\s*:?\s*(\d+(?:\.\d+)?)\b/i, 'calories'],
    [/^total fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_fat'],
    [/^fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_fat'],
    [/^s\w*at\w*\s+fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'saturated_fat'],
    [/^sq\w*at\w*\s+fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'saturated_fat'],
    [/^saturated fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'saturated_fat'],
    [/^trans fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'trans_fat'],
    [/^cholesterol\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*mg\b/i, 'cholesterol'],
    [/^sodium\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*mg\b/i, 'sodium'],
    [/^total carb(?:ohydrate)?\.?\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_carb'],
    [/^carbohydrate\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'total_carb'],
    [/^dietary fiber\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'fiber'],
    [/^d\w*et\w*\s+fi\w*\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'fiber'],
    [/^fiber\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'fiber'],
    [/^total sugars?\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'sugars'],
    [/^sugars?\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'sugars'],
    [/^protein\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i, 'protein'],
  ];
  for (const [pattern, slot] of rules) {
    const match = line.match(pattern);
    if (match) return { slot, amount: Number(match[1]) };
  }
  return matchVariantInlineLine(line);
}

function matchVariantInlineLine(line: string): { slot: LabelSlot; amount: number } | null {
  const trimmed = line.trim();
  const gluedBlob = trimmed.match(/^([A-Za-z][A-Za-z0-9]{5,40})/);
  if (gluedBlob) {
    const blob = gluedBlob[1] ?? '';
    const slot = matchVariantLabelToken(blob);
    if (slot) {
      const canonical = embeddedCanonicalForSlot(blob, slot);
      const span = canonical ? findEmbeddedCanonicalSpan(blob, canonical) : null;
      const parsed = span ? parseAmountWithFuzzyUnit(blob.slice(span.end)) : null;
      if (parsed) {
        if (slot === 'sodium' || slot === 'cholesterol') {
          if (parsed.unit === 'mg') return { slot, amount: parsed.amount };
        } else if (parsed.unit === 'g') {
          return { slot, amount: parsed.amount };
        }
      }
    }
  }

  const labelFirst = trimmed.match(/^([A-Za-z][A-Za-z_]{0,22}[A-Za-z]|[A-Za-z]{3,22})\s*:?\s*(.+)$/);
  if (!labelFirst) return null;

  const slot = matchVariantLabelToken(labelFirst[1] ?? '');
  if (!slot) return null;

  const rest = (labelFirst[2] ?? '').trim();
  const measured = parseMeasuredAmount(normalizeOcrUnitNoise(rest));
  if (measured) {
    if (slot === 'sodium' || slot === 'cholesterol') {
      if (measured.unit !== 'mg') return null;
    } else if (slot !== 'calories' && measured.unit !== 'g') {
      return null;
    }
    return { slot, amount: measured.amount };
  }

  const bare = rest.match(/^<?\s*(\d+(?:\.\d+)?)\s*(?:g|mg|kcal)\b/i);
  if (bare) return { slot, amount: Number(bare[1]) };

  return null;
}

function parseColumnarLabel(raw: string): Nutrients | null {
  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /nutrition facts|nutrition values|amount per serving/i.test(line));
  const window = (start >= 0 ? lines.slice(start + 1) : lines).slice(0, 40);

  const slots: LabelSlot[] = [];
  const amountRows: Array<{ line: string; amount: number }> = [];

  for (const line of window) {
    if (/^(serving size|about \d|servings per|daily value|amount per)/i.test(line)) continue;
    if (matchInlineLine(line)) continue;
    const slot = classifyLabelOnlyLine(line);
    if (slot) {
      slots.push(slot);
      continue;
    }
    const amount = parseStandaloneAmount(line);
    if (amount != null && !isLikelyDailyValuePercentLine(line, amount)) {
      amountRows.push({ line, amount });
    }
  }

  if (slots.length < 2 || amountRows.length < 2) return null;

  const nutrients = emptyNutrients();
  let amountIndex = 0;
  for (const slot of slots) {
    while (amountIndex < amountRows.length) {
      const row = amountRows[amountIndex]!;
      amountIndex += 1;
      if (!amountMatchesSlot(row.line, slot)) continue;
      applySlot(nutrients, { slot, amount: row.amount });
      break;
    }
  }
  return nutrients;
}

function classifyLabelOnlyLine(line: string): LabelSlot | null {
  if (matchInlineLine(line)) return null;
  if (/\d/.test(line)) return null;
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
  return classifyVariantLabelLine(line);
}

function parseStandaloneAmount(line: string): number | null {
  const measured = parseMeasuredAmount(normalizeOcrUnitNoise(line));
  if (measured) return measured.amount;
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
  const slashCompact = compact.match(/\bcalories(?!\s+from\s+fat)\s*:?\s*(\d{2,4})\/(\d{1,2})\b/i);
  if (slashCompact) return caloriesFromSlashOcr(slashCompact[1] ?? '', slashCompact[2] ?? '');

  const direct = compact.match(/\bcalories(?!\s+from\s+fat)\s*:?\s*(\d+(?:\.\d+)?)\b/i);
  if (direct) return Number(direct[1]);

  for (const line of raw.split(/\n/)) {
    const slashDv = line.match(/\bcalories\b(?!\s+from\s+fat)[^\d]{0,32}(\d{2,4})\/(\d{1,2})\b/i);
    if (slashDv) return caloriesFromSlashOcr(slashDv[1] ?? '', slashDv[2] ?? '');

    const noisy = line.match(/\bcalories\b(?!\s+from\s+fat)[^\d]{0,24}(\d{2,4})\b/i);
    if (noisy) return Number(noisy[1]);
  }
  return lineAmount(raw, 'calories', '');
}

/** OCR often glues kcal to the daily-value column: `152/22` for 150 cal + 22% DV. */
function caloriesFromSlashOcr(main: string, dvPart: string): number {
  const merged = Number(main);
  const dv = Number(dvPart);
  if (dv >= 1 && dv <= 99 && merged >= 100 && merged % 10 !== 0) {
    return merged - (merged % 10);
  }
  return merged;
}

/** Total fat only — ignore saturated/trans lines where OCR still says "Fat Ng". */
function readSodiumMgNoisy(raw: string): number | null {
  const fromGap = readSodiumFromMacroGap(raw);
  if (fromGap != null) return fromGap;

  const text = normalizeOcrUnitNoise(raw);
  for (const line of text.split(/\n/).map((row) => row.trim()).filter(Boolean)) {
    const variant = matchVariantInlineLine(line);
    if (variant?.slot === 'sodium') return variant.amount;

    const inline = line.match(/\bsod\w*\b[^0-9]{0,20}(\d{2,4})\s*(?:mg|m\s*g|Ng)\b/i);
    if (inline) return Number(inline[1]);
  }
  return null;
}

function readSaturatedFatGramsNoisy(raw: string, totalFatG: number): number | null {
  const flat = raw.replace(/\s+/g, ' ');
  for (const match of flat.matchAll(/\bs\w*at\w*[^a-z]{0,10}fat\b/gi)) {
    const index = match.index ?? 0;
    const slice = flat.slice(index, index + 48);
    const amount = estimateSaturatedFatFromOcrSlice(slice, totalFatG);
    if (amount != null && amount > 0) return amount;
  }
  return null;
}

function readTotalFatGramsNoisy(raw: string): number | null {
  for (const line of raw.split(/\n/).map((row) => row.trim()).filter(Boolean)) {
    if (/saturat|sq\w*at|trans\s+fat/i.test(line)) continue;
    const fuzzyTotal = line.match(/\bt[a-z]{3,7}l\s+fat[^0-9]{0,6}(\d+(?:\.\d+)?)/i);
    if (fuzzyTotal) {
      const tail = line.slice(fuzzyTotal.index ?? 0, (fuzzyTotal.index ?? 0) + 32);
      const glued = tail.match(/\bfat(\d+)\.([A-Za-z]{1,3})/i);
      if (glued) {
        const fromDot = expandOcrDecimalBeforeGram(glued[1] ?? '', glued[2] ?? '');
        if (fromDot != null && fromDot > 0) return fromDot;
      }
    }
    const match = line.match(/\btotal fat\b[^0-9]{0,12}(\d+(?:\.\d+)?)\s*g\b/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function readFiberGramsNoisy(raw: string): number | null {
  for (const line of raw.split(/\n/).map((row) => row.trim()).filter(Boolean)) {
    const fiberMatch = line.match(/\b(?:dietary\s+)?fiber\b/i);
    if (!fiberMatch) continue;
    const slice = line.slice(fiberMatch.index ?? 0, (fiberMatch.index ?? 0) + 28);
    const fuzzyIg = slice.match(/\bfiber\b[^A-Za-z0-9]{0,10}([Il|]\s*(?:g|9)|Ig\b)/i);
    if (fuzzyIg) {
      const token = (fuzzyIg[1] ?? '').replace(/\s/g, '');
      const parsed = parseAmountWithFuzzyUnit(/g|9/i.test(token) ? token : `${token}g`);
      if (parsed?.unit === 'g' && parsed.amount >= 0 && parsed.amount <= 100) return parsed.amount;
    }
    const match = slice.match(/\bfiber\b[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:g|9)\b/i);
    if (match) return Number(match[1]);
    const loose = slice.match(/\bfiber\b[^0-9]{0,12}(\d+(?:\.\d+)?)\b/i);
    if (loose) return Number(loose[1]);
  }
  return null;
}

function readStandaloneFatGrams(raw: string): number | null {
  for (const line of raw.split(/\n/).map((row) => row.trim()).filter(Boolean)) {
    if (/saturat|trans\s+fat/i.test(line)) continue;
    const inline = line.match(/^total fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i);
    if (inline) return Number(inline[1]);
    const short = line.match(/^fat\s*:?\s*<?\s*(\d+(?:\.\d+)?)\s*g\b/i);
    if (short) return Number(short[1]);
  }
  return null;
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
  if (value == null || value <= 0) return;
  if (nutrients.extras.some((row) => row.key === key)) return;
  nutrients.extras.push({ key, label, amount: value, unit });
}

function servingsPerContainerFromLabel(compact: string, raw: string): number | null {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*servings?\s+per\s+container/i,
    /about\s+(\d+(?:\.\d+)?)\s*servings?\s+per\s+container/i,
  ];
  for (const pattern of patterns) {
    const match = compact.match(pattern) ?? raw.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (value > 0 && value <= 999) return value;
    }
  }

  if (/\b1\s*servings?\s+per\s+container\b/i.test(compact) || /\b1\s*serving\s+per\s+container\b/i.test(raw)) {
    return 1;
  }

  const lines = raw.split(/\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const match = line.match(/^(\d+(?:\.\d+)?)\s*servings?\s+per\s+container/i);
    if (match) {
      const value = Number(match[1]);
      if (value > 0 && value <= 999) return value;
    }

    if (!/per\s+container/i.test(line)) continue;

    const inline = line.match(/(\d+(?:\.\d+)?)\s*servings?\s+per\s+container/i);
    if (inline) {
      const value = Number(inline[1]);
      if (value > 0 && value <= 999) return value;
    }

    const prev = lines[index - 1] ?? '';
    if (/^\d{1,2}$/.test(prev)) {
      const value = Number(prev);
      if (value > 0 && value <= 99) return value;
    }

    const trailing = line.match(/per\s+container[^\d]{0,28}(\d{1,2})\s*$/i)
      ?? line.match(/per\s+container[^\d]{0,28}[^\d]*(\d{1,2})\b/i);
    if (trailing) {
      let value = Number(trailing[1]);
      if (value === 15 && /\bcalories\b[^\d]{0,20}150\b/i.test(raw)) value = 1;
      if (value > 0 && value <= 99) return value;
    }

    if (/\bper\s+container\b/i.test(line) && /\b1\b/.test(line.replace(/150/g, ''))) return 1;
  }
  return null;
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
