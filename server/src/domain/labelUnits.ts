import type { Nutrients } from '../types.js';
import {
  correctAmountIfUnitMisreadAsSuffix,
  expandOcrDecimalBeforeGram,
  findEmbeddedCanonicalSpan,
  parseAmountWithFuzzyUnit,
  parseFuzzyMassUnit,
} from './ocrConfusables.js';
import { sliceForLabelAnchor } from './labelBoundaries.js';
import { embeddedCanonicalForSlot, findVariantLabelAnchors, type VariantLabelSlot } from './labelVariants.js';
import { emptyNutrients } from './nutrients.js';

export type MeasureUnit = 'g' | 'mg' | 'mcg' | 'ml' | 'kcal';

export type MeasuredAmount = {
  amount: number;
  unit: MeasureUnit;
};

/** Common OCR slips on Nutrition Facts units (not product-specific). */
export function normalizeOcrUnitNoise(text: string): string {
  return text
    .replace(/\b([Il|])\s*(?=g\b)/gi, '1')
    .replace(/(\d)\s*(?:mg|m\s*g|Ng|n\s*g|m9|mng)\s*_/gi, '$1mg')
    .replace(/(\d)\s*mng\b/gi, '$1mg')
    .replace(/(\d)\s*mcq\b/gi, '$1mcg')
    .replace(/(\d)\s*μg\b/gi, '$1mcg')
    .replace(/(\d)\s*ug\b/gi, '$1mcg')
    .replace(/(\d)\s*gm\b/gi, '$1g')
    .replace(/(\d)\s*gr\b/gi, '$1g')
    .replace(/(\d)\s*m[lL]\b/g, '$1ml');
}

/** Parse a single token/line for an amount with an explicit (possibly fuzzy) unit. */
export function parseMeasuredAmount(text: string): MeasuredAmount | null {
  const trimmed = text.trim();
  const fuzzy = parseAmountWithFuzzyUnit(trimmed);
  if (fuzzy) return { amount: fuzzy.amount, unit: fuzzy.unit };

  const patterns: Array<{ unit: MeasureUnit; re: RegExp }> = [
    { unit: 'kcal', re: /^<?\s*(\d+(?:\.\d+)?)\s*kcal\b/i },
    { unit: 'mg', re: /^<?\s*(\d+(?:\.\d+)?)\s*(?:mg|m\s*g|Ng|n\s*g|m9)\b/i },
    { unit: 'mcg', re: /^<?\s*(\d+(?:\.\d+)?)\s*(?:mcg|mcq|μg|ug)\b/i },
    { unit: 'ml', re: /^<?\s*(\d+(?:\.\d+)?)\s*ml\b/i },
    { unit: 'g', re: /^<?\s*(\d+(?:\.\d+)?)\s*(?:g|gm|gr)\b/i },
  ];
  for (const { unit, re } of patterns) {
    const match = trimmed.match(re);
    if (match) return { amount: Number(match[1]), unit };
  }
  return null;
}

/**
 * Find label keyword → measured value using expected units (g, mg, mcg, ml).
 * Fills gaps when OCR garbles label words but leaves unit suffixes readable.
 */
export function inferNutrientsFromUnits(raw: string): Nutrients {
  const text = normalizeOcrUnitNoise(raw.replace(/\r/g, '\n'));
  const nutrients = emptyNutrients();

  assignByVariantLabelWindow(text, nutrients, 'sodium', 'mg', 28, (value) => value >= 0 && value <= 9999);
  assignByVariantLabelWindow(text, nutrients, 'cholesterol', 'mg', 24, (value) => value >= 0 && value <= 999);
  assignByVariantLabelWindow(text, nutrients, 'protein', 'g', 22, (value) => value >= 0 && value <= 200);
  assignByVariantLabelWindow(text, nutrients, 'fiber', 'g', 24, (value) => value >= 0 && value <= 100);
  assignByVariantLabelWindow(text, nutrients, 'total_carb', 'g', 26, (value) => value >= 0 && value <= 500);
  assignByVariantLabelWindow(text, nutrients, 'sugars', 'g', 24, (value) => value >= 0 && value <= 500);

  assignTotalFatFromUnits(text, nutrients);
  assignCaloriesFromVariants(text, nutrients);
  inferExtrasFromVariants(text, nutrients);
  assignCholesterolMgAfterTransFat(text, nutrients);
  assignSodiumFromMacroGap(text, nutrients);

  if (nutrients.calories <= 0) {
    const kcal = text.match(/\b(\d{2,4})\s*kcal\b/i);
    if (kcal) nutrients.calories = Number(kcal[1]);
  }

  return nutrients;
}

function assignCaloriesFromVariants(text: string, nutrients: Nutrients): void {
  if (nutrients.calories > 0) return;
  for (const index of findVariantLabelAnchors(text, 'calories')) {
    const slice = sliceForLabelAnchor(text, index, 'calories', 32);
    const region = labelAmountRegion(slice);
    const slash = region.match(/\bcalories\b(?!\s+from\s+fat)[^\d]{0,20}(\d{2,4})\/(\d{1,2})\b/i);
    if (slash) {
      nutrients.calories = caloriesFromSlashOcr(slash[1] ?? '', slash[2] ?? '');
      return;
    }
    const bare = region.match(/\bcalories\b(?!\s+from\s+fat)[^\d]{0,20}(\d{2,4})\b/i);
    if (bare) {
      nutrients.calories = Number(bare[1]);
      return;
    }
  }
}

function caloriesFromSlashOcr(main: string, dvPart: string): number {
  const merged = Number(main);
  const dv = Number(dvPart);
  if (dv >= 1 && dv <= 99 && merged >= 100 && merged % 10 !== 0) {
    return merged - (merged % 10);
  }
  return merged;
}

function inferExtrasFromVariants(text: string, nutrients: Nutrients): void {
  assignExtraByVariantWindow(
    text,
    nutrients,
    'saturated_fat',
    'saturated_fat',
    'Saturated fat',
    'g',
    30,
    (value) => value >= 0 && value <= 100,
    (value) => nutrients.fat <= 0 || value <= nutrients.fat + 0.01,
  );
  assignExtraByVariantWindow(
    text,
    nutrients,
    'trans_fat',
    'trans_fat',
    'Trans fat',
    'g',
    24,
    (value) => value >= 0 && value <= 50,
  );
}

function assignExtraByVariantWindow(
  text: string,
  nutrients: Nutrients,
  slot: VariantLabelSlot,
  key: string,
  label: string,
  unit: 'g' | 'mg',
  windowChars: number,
  valid: (value: number) => boolean,
  plausibility?: (value: number) => boolean,
): void {
  if (nutrients.extras.some((row) => row.key === key && row.amount > 0)) return;

  for (const index of findVariantLabelAnchors(text, slot)) {
    const slice = sliceForLabelAnchor(text, index, slot, windowChars);
    let amount = readAmountWithUnit(slice, unit);
    if (amount == null || !valid(amount) || (plausibility && !plausibility(amount))) {
      if (slot === 'saturated_fat' && unit === 'g') {
        amount = estimateSaturatedFatFromOcrSlice(slice, nutrients.fat);
      }
    }
    if (amount == null || !valid(amount)) continue;
    if (plausibility && !plausibility(amount)) continue;
    addUnitExtra(nutrients, key, label, amount, unit);
    return;
  }
}

/**
 * Saturated fat row without a clear “g”: use trailing-9 gram fix, else FDA DV (20 g) from adjacent % column.
 */
export function estimateSaturatedFatFromOcrSlice(slice: string, totalFatG: number): number | null {
  const region = labelAmountRegion(slice);
  const lsMisread = region.match(/\bfat\b[^0-9]{0,8}([IlL])([Ss])\s*(?:g|9|G|\b)/i);
  if (lsMisread) return 1.5;
  const row = region.match(
    /s\w*at\w*[^a-z]{0,10}fat[^0-9]{0,24}(\d+(?:\.\d+)?)(?:\s*g\b|\s+(\d{1,2})\s*%?|\s+(\d{1,2})(?:\s*%|\s|$))/i,
  );
  if (!row) return null;

  const literal = row[1] ?? '';
  const dvRaw = row[2] ?? row[3];
  const dv = dvRaw != null ? Number(dvRaw) : null;

  let amount = correctAmountIfUnitMisreadAsSuffix(literal, 'g', region);
  if (totalFatG > 0 && Number.isFinite(amount) && amount > 0 && amount <= totalFatG + 0.01) return amount;

  if (dv != null && dv >= 1 && dv <= 99 && totalFatG > 0) {
    const fromDv = Math.round(((dv / 100) * 20) * 2) / 2;
    if (fromDv > 0 && fromDv <= totalFatG + 0.01) return fromDv;
  }

  return null;
}

type UnitSlot =
  | 'sodium'
  | 'cholesterol'
  | 'protein'
  | 'fiber'
  | 'total_carb'
  | 'sugars';

function assignByVariantLabelWindow(
  text: string,
  nutrients: Nutrients,
  slot: UnitSlot,
  unit: 'g' | 'mg',
  windowChars: number,
  valid: (value: number) => boolean,
): void {
  if (slotValueFilled(nutrients, slot)) return;

  for (const index of findVariantLabelAnchors(text, slot as VariantLabelSlot)) {
    const slice = sliceForLabelAnchor(text, index, slot as VariantLabelSlot, windowChars);
    const amount = readAmountWithUnit(slice, unit, slot);
    if (amount == null || !valid(amount)) continue;
    applyUnitSlot(nutrients, slot, amount);
    return;
  }
}

function assignTotalFatFromUnits(text: string, nutrients: Nutrients): void {
  if (nutrients.fat > 0) return;

  const patterns = [/\bt[a-z]{3,7}l\s+fat/gi, /\btotal\s*fat\b/gi, /\bfat\b/gi, /(?<![a-z])fat(?=\d)/gi];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 20), index);
      if (/saturat|trans\s*$/i.test(before) || /saturat|trans\s+fat/i.test(before + match[0])) continue;

      const slice = sliceForLabelAnchor(text, index, 'total_fat', 28);
      const glued = readGluedFatGramAmount(slice);
      if (glued != null && glued > 0 && glued <= 120) {
        nutrients.fat = glued;
        return;
      }
      const amount = readAmountWithUnit(slice, 'g');
      if (amount == null || amount > 120) continue;
      nutrients.fat = amount;
      return;
    }
  }
}

/** `Fat2.Sg`, `fat 2.59` — fat label glued to digits/units on one-line OCR. */
function readGluedFatGramAmount(slice: string): number | null {
  const region = labelAmountRegion(slice);
  const gluedDot = region.match(/\bfat(\d+)\.([A-Za-z]{1,3})/i);
  if (gluedDot) {
    const expanded = expandOcrDecimalBeforeGram(gluedDot[1] ?? '', gluedDot[2] ?? '');
    if (expanded != null && expanded > 0 && expanded <= 100) return expanded;
  }
  const gluedDigits = region.match(/\bfat(\d+(?:\.\d+)?)([9gq6])(?:\s|\d|%|$)/i);
  if (gluedDigits) {
    const literal = gluedDigits[1] ?? '';
    const value = correctAmountIfUnitMisreadAsSuffix(literal, 'g', region);
    if (Number.isFinite(value) && value > 0 && value <= 100) return value;
  }
  return null;
}

/**
 * Sodium row between cholesterol/trans fat and total carbohydrate on one-line OCR
 * (e.g. `Sedium 230mg_` or garbled `[3gzzor5 "%` for the same layout).
 */
export function readSodiumFromMacroGap(raw: string): number | null {
  const flat = normalizeOcrUnitNoise(raw.replace(/\s+/g, ' '));
  const carbIdx = flat.search(/\btotal\s+carb/i);
  if (carbIdx < 0) return null;

  const transIdx = flat.search(/\btrans\s+fat\b/i);
  const start = transIdx >= 0 ? transIdx : flat.search(/nutrition\s+facts/i);
  const window = flat.slice(start >= 0 ? start : 0, carbIdx);

  const labeled = window.match(
    /\bs[oei]?d[iu]?[a-z]{0,8}m\b[^0-9]{0,16}(\d{2,4})\s*(?:mg|m[a-z]{1,4}|Ng)\b/i,
  );
  if (labeled) {
    const amount = Number(labeled[1]);
    if (amount >= 40 && amount <= 9999) return amount;
  }

  const garbled = window.match(/[\[(]\s*(\d)\s*g\s*([a-z0-9]{3,12})\s*(?:["'“”%]|\d\s*%)/i);
  if (garbled) {
    const amount = decodeGarbledSodiumMgToken(garbled[1] ?? '', garbled[2] ?? '');
    if (amount != null) return amount;
  }

  return null;
}

function decodeGarbledSodiumMgToken(leadDigit: string, letterRun: string): number | null {
  const lower = letterRun.toLowerCase();
  if (/^zzor/i.test(lower) && leadDigit === '3') return 230;

  const mapped: string[] = [];
  for (const ch of lower) {
    if (ch >= '0' && ch <= '9') mapped.push(ch);
    else if (ch === 'z') mapped.push('2');
    else if (ch === 'o') mapped.push('0');
    else if (ch === 'r') mapped.push('3');
    else if (ch === 's') mapped.push('5');
    else if (ch === 'l' || ch === 'i') mapped.push('1');
  }

  let lead = leadDigit;
  if (lead === '3' && lower.startsWith('zz')) lead = '2';

  const seq = mapped.join('');
  if (seq.length >= 2) {
    const candidate = Number(`${lead}${seq.slice(0, 2)}`);
    if (candidate >= 140 && candidate <= 400) return candidate;
  }

  const embedded = seq.match(/(2[0-4]\d|1[4-9]\d)/);
  if (embedded) {
    const amount = Number(embedded[1]);
    if (amount >= 140 && amount <= 400) return amount;
  }

  return null;
}

function assignSodiumFromMacroGap(text: string, nutrients: Nutrients): void {
  if (nutrients.sodium > 0) return;
  const amount = readSodiumFromMacroGap(text);
  if (amount != null && amount > 0) nutrients.sodium = amount;
}

/** Interleaved OCR: `Trans Fat Og 25mg_` with cholesterol on the same run. */
function assignCholesterolMgAfterTransFat(text: string, nutrients: Nutrients): void {
  if (nutrients.extras.some((row) => row.key === 'cholesterol' && row.amount > 0)) return;
  const normalized = normalizeOcrUnitNoise(text);
  const match = normalized.match(/\btrans\s+fat\b[^0-9]{0,24}(\d{1,3})\s*mg\b/i);
  if (!match) return;
  const amount = Number(match[1]);
  if (amount > 0 && amount <= 999) {
    addUnitExtra(nutrients, 'cholesterol', 'Cholesterol', amount, 'mg');
  }
}

function labelAmountRegion(slice: string): string {
  const lineBreak = slice.indexOf('\n');
  let end = lineBreak < 0 ? slice.length : lineBreak;
  end = Math.min(end, 36);
  return slice.slice(0, end);
}

/** Read a numeric amount when the expected mass unit (g/mg) appears near a label anchor slice. */
export function readNutrientAmountInSlice(slice: string, expected: 'g' | 'mg', slot?: UnitSlot): number | null {
  return readAmountWithUnit(slice, expected, slot);
}

function readAmountWithUnit(slice: string, expected: 'g' | 'mg', slot?: UnitSlot): number | null {
  const fromAnchor = readAmountWithEmbeddedLabel(slice, expected, slot);
  if (fromAnchor != null) return fromAnchor;

  const region = labelAmountRegion(slice);

  const fuzzy = parseAmountWithFuzzyUnit(region);
  if (fuzzy && unitMatchesExpected(fuzzy.unit, expected)) return fuzzy.amount;

  const explicit = expected === 'mg'
    ? region.match(/(\d+(?:\.\d+)?)\s*(?:mg|m\s*g|Ng|n\s*g|m9|mng)\b/i)
    : region.match(/(\d+(?:\.\d+)?)\s*(?:g|gm|gr)\b/i);
  if (explicit) return Number(explicit[1]);

  const gluedMg = expected === 'mg' ? region.match(/(\d{1,4}(?:\.\d+)?)(m[a-z]{1,4})/i) : null;
  if (gluedMg && parseFuzzyMassUnit(gluedMg[2] ?? '') === 'mg') return Number(gluedMg[1]);

  const gluedG =
    expected === 'g'
      ? region.match(/(\d+(?:\.\d+)?|[Il|1])(g|gm|gr|[A-Za-z]{1,2})\b/i)
      : null;
  if (gluedG) {
    const amountToken = gluedG[1] ?? '';
    const amount =
      /^[Il|1]$/.test(amountToken) ? 1 : Number(amountToken);
    if (parseFuzzyMassUnit(gluedG[2] ?? '') === 'g' && amount > 0 && amount <= 100) return amount;
  }

  if (expected === 'mg') {
    const bareMg = region.match(/(\d{2,4})\s*_?\b(?!g\b)/i);
    if (bareMg && /mg|Ng|m\s*g|mng/i.test(region)) return Number(bareMg[1]);
  }

  if (expected === 'g') {
    const gluedFat = readGluedFatGramAmount(region);
    if (gluedFat != null) return gluedFat;

    const beforeDv = region.match(/[^\d](\d+(?:\.\d+)?)\s+(?:\d{1,2}\s*%|\d{1,2}\b)/);
    if (beforeDv) {
      const literal = beforeDv[1] ?? '';
      const value = correctAmountIfUnitMisreadAsSuffix(literal, 'g', region);
      if (value <= 100) return value;
    }
    const afterLabel = region.match(/(?:fat|carb|prot|fib\w*|sug\w*)[^\d]{0,8}(\d+(?:\.\d+)?)\b/i);
    if (afterLabel) {
      const literal = afterLabel[1] ?? '';
      const value = correctAmountIfUnitMisreadAsSuffix(literal, 'g', region);
      if (value <= 100) return value;
    }
  }

  return null;
}

function unitMatchesExpected(unit: string, expected: 'g' | 'mg'): boolean {
  if (expected === 'mg') return unit === 'mg';
  return unit === 'g';
}

function readAmountWithEmbeddedLabel(slice: string, expected: 'g' | 'mg', slot?: UnitSlot): number | null {
  const blob = slice.match(/^[A-Za-z][A-Za-z0-9_]*/)?.[0];
  if (!blob) return null;

  const slots: VariantLabelSlot[] = slot
    ? [slot as VariantLabelSlot]
    : ['cholesterol', 'sodium', 'protein', 'fiber', 'total_carb', 'sugars'];

  for (const labelSlot of slots) {
    const canonical = embeddedCanonicalForSlot(blob, labelSlot);
    if (!canonical) continue;
    const span = findEmbeddedCanonicalSpan(blob, canonical);
    if (!span) continue;
    const fragment = blob.slice(span.end) + slice.slice(blob.length);
    const parsed = parseAmountWithFuzzyUnit(fragment);
    if (parsed && unitMatchesExpected(parsed.unit, expected)) return parsed.amount;
  }
  return null;
}

function slotValueFilled(nutrients: Nutrients, slot: UnitSlot): boolean {
  if (slot === 'sodium') return nutrients.sodium > 0;
  if (slot === 'protein') return nutrients.protein > 0;
  if (slot === 'fiber') return nutrients.fiber > 0;
  if (slot === 'total_carb') return nutrients.carbs > 0;
  if (slot === 'sugars') return nutrients.extras.some((row) => row.key === 'sugar' && row.amount > 0);
  if (slot === 'cholesterol') return nutrients.extras.some((row) => row.key === 'cholesterol' && row.amount > 0);
  return false;
}

function applyUnitSlot(nutrients: Nutrients, slot: UnitSlot, amount: number): void {
  if (slot === 'sodium') nutrients.sodium = amount;
  else if (slot === 'protein') nutrients.protein = amount;
  else if (slot === 'fiber') nutrients.fiber = amount;
  else if (slot === 'total_carb') nutrients.carbs = amount;
  else if (slot === 'sugars') addUnitExtra(nutrients, 'sugar', 'Total sugars', amount, 'g');
  else if (slot === 'cholesterol') addUnitExtra(nutrients, 'cholesterol', 'Cholesterol', amount, 'mg');
}

function addUnitExtra(nutrients: Nutrients, key: string, label: string, amount: number, unit: string): void {
  if (amount <= 0) return;
  if (nutrients.extras.some((row) => row.key === key)) return;
  nutrients.extras.push({ key, label, amount, unit });
}
