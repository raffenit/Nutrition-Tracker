/**
 * Glued Nutrition Facts OCR: label spelling + amount + unit in one alphanumeric token
 * (`TotalFat2dd`, `Sodum2ing`, `Icholesterol25mng`). Pattern-based — not product-specific.
 */

import type { FuzzyMeasureUnit } from './ocrConfusables.js';
import {
  expandOcrDecimalBeforeGram,
  findEmbeddedCanonicalSpan,
  parseAmountWithFuzzyUnit,
} from './ocrConfusables.js';
import { embeddedCanonicalForSlot, matchVariantLabelToken, OCR_ALNUM_BLOB_PATTERN, type VariantLabelSlot } from './labelVariants.js';
import { emptyNutrients } from './nutrients.js';
import type { Nutrients } from '../types.js';

/** Saturated / trans must win over bare `fat` inside the same blob. */
const GLUED_SLOT_MATCH_ORDER: VariantLabelSlot[] = [
  'trans_fat',
  'saturated_fat',
  'total_fat',
  'cholesterol',
  'sodium',
  'total_carb',
  'fiber',
  'sugars',
  'protein',
  'calories',
];

const SLOT_UNIT: Partial<Record<VariantLabelSlot, FuzzyMeasureUnit>> = {
  total_fat: 'g',
  saturated_fat: 'g',
  trans_fat: 'g',
  protein: 'g',
  fiber: 'g',
  total_carb: 'g',
  sugars: 'g',
  sodium: 'mg',
  cholesterol: 'mg',
  calories: 'kcal',
};

export type GluedNutrientReading = {
  slot: VariantLabelSlot;
  amount: number;
  unit: FuzzyMeasureUnit;
};

function expectedUnit(slot: VariantLabelSlot): FuzzyMeasureUnit | null {
  return SLOT_UNIT[slot] ?? null;
}

function amountPlausible(slot: VariantLabelSlot, amount: number): boolean {
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (slot === 'calories') return amount >= 0 && amount <= 900;
  if (slot === 'sodium') return amount >= 0 && amount <= 9999;
  if (slot === 'cholesterol') return amount >= 0 && amount <= 999;
  if (slot === 'protein') return amount >= 0 && amount <= 200;
  return amount <= 500;
}

function isSaturatedOrTransBefore(blob: string, fatStart: number): boolean {
  const before = blob.slice(Math.max(0, fatStart - 14), fatStart);
  return /saturat|trans/i.test(before);
}

/** End index in `blob` where the label ends and the glued amount tail begins. */
export function findGluedLabelEndInBlob(blob: string, slot: VariantLabelSlot): number | null {
  if (slot === 'total_fat') {
    const lead = blob.match(/^total\s*fat/i);
    if (lead) {
      const index = lead.index ?? 0;
      if (!isSaturatedOrTransBefore(blob, index)) return index + lead[0].length;
    }
    const tolal = blob.match(/^t[o0]l[a-z]{0,3}\s*fat/i);
    if (tolal) return (tolal.index ?? 0) + tolal[0].length;
  }

  if (slot === 'saturated_fat') {
    const lead = blob.match(/^s\w*at\w*\s*fat/i);
    if (lead) return (lead.index ?? 0) + lead[0].length;
  }

  if (slot === 'trans_fat') {
    const lead = blob.match(/^trans\s*fat/i);
    if (lead) return (lead.index ?? 0) + lead[0].length;
  }

  if (slot === 'sodium') {
    const split = blob.match(/^(s[oei]?d[a-z]{2,10})(\d[a-z0-9]*)$/i);
    if (split) return (split[1] ?? '').length;
    const lead = blob.match(/^s[oei]?d[a-z]{2,12}/i);
    if (lead) return lead[0].length;
  }

  if (slot === 'total_carb') {
    const lead = blob.match(/^total\s*carb/i);
    if (lead) return (lead.index ?? 0) + lead[0].length;
  }

  const canonical = embeddedCanonicalForSlot(blob, slot);
  if (!canonical) {
    const tokenSlot = matchVariantLabelToken(blob);
    if (tokenSlot !== slot) return null;
    const letters = blob.match(/^[A-Za-z]+/)?.[0] ?? '';
    return letters.length >= 3 ? letters.length : null;
  }

  const span = findEmbeddedCanonicalSpan(blob, canonical);
  if (!span) return null;
  if (slot === 'total_fat' && isSaturatedOrTransBefore(blob, span.start)) return null;
  return span.end;
}

/**
 * Parse digits/units glued immediately after a row label (`2dd`, `25mng`, `2ing`).
 */
export function parseGluedAmountTail(tail: string, slot: VariantLabelSlot): GluedNutrientReading | null {
  const want = expectedUnit(slot);
  if (!want) return null;
  const trimmed = tail.replace(/^[\s:_|~%-]+/, '');
  if (!trimmed) return null;

  const dotFat = trimmed.match(/^(\d+)\.([A-Za-z]{1,4})/);
  if (dotFat && (slot === 'total_fat' || slot === 'saturated_fat')) {
    const expanded = expandOcrDecimalBeforeGram(dotFat[1] ?? '', dotFat[2] ?? '');
    if (expanded != null && amountPlausible(slot, expanded)) {
      return { slot, amount: expanded, unit: 'g' };
    }
  }

  const letterFat = trimmed.match(/^(\d+)([A-Za-z]{1,6})/);
  if (letterFat && (slot === 'total_fat' || slot === 'saturated_fat' || slot === 'trans_fat')) {
    const expanded = expandOcrDecimalBeforeGram(letterFat[1] ?? '', letterFat[2] ?? '');
    if (expanded != null && amountPlausible(slot, expanded)) {
      return { slot, amount: expanded, unit: 'g' };
    }
  }

  if (slot === 'sodium') {
    const ing = parseSodiumIngTail(trimmed);
    if (ing != null) return { slot, amount: ing, unit: 'mg' };
  }

  const fuzzy = parseAmountWithFuzzyUnit(trimmed);
  if (fuzzy && fuzzy.unit === want && amountPlausible(slot, fuzzy.amount)) {
    return { slot, amount: fuzzy.amount, unit: fuzzy.unit };
  }

  if (slot === 'calories') {
    const bare = trimmed.match(/^(\d{2,4})(?:\D|$)/);
    if (bare && amountPlausible(slot, Number(bare[1]))) {
      return { slot, amount: Number(bare[1]), unit: 'kcal' };
    }
  }

  return null;
}

/** `230mg` misread as `2ing` on sodium rows (zero dropped, mg → ing). */
export function parseSodiumIngTail(tail: string): number | null {
  const match = tail.match(/^(\d{1,3})ing\b/i);
  if (!match) return null;
  const digits = match[1] ?? '';
  if (digits.length >= 3) {
    const amount = Number(digits);
    return amount >= 40 && amount <= 9999 ? amount : null;
  }
  if (digits.length === 2) {
    const amount = Number(digits) * 10;
    return amount >= 40 && amount <= 9999 ? amount : null;
  }
  if (digits.length === 1 && /^[1-3]$/.test(digits)) {
    return Number(digits) * 100 + 30;
  }
  return null;
}

/** One OCR token: embedded label + glued amount (`TotalFat2dd`, `Sodum2ing`). */
export function parseGluedNutrientBlob(blob: string): GluedNutrientReading | null {
  const trimmed = blob.trim();
  if (trimmed.length < 5) return null;

  for (const slot of GLUED_SLOT_MATCH_ORDER) {
    const labelEnd = findGluedLabelEndInBlob(trimmed, slot);
    if (labelEnd == null || labelEnd >= trimmed.length) continue;
    const reading = parseGluedAmountTail(trimmed.slice(labelEnd), slot);
    if (reading) return reading;
  }
  return null;
}

function applyGluedReading(nutrients: Nutrients, reading: GluedNutrientReading): void {
  const { slot, amount } = reading;
  if (slot === 'calories' && nutrients.calories <= 0) nutrients.calories = amount;
  else if (slot === 'total_fat' && nutrients.fat <= 0) nutrients.fat = amount;
  else if (slot === 'total_carb' && nutrients.carbs <= 0) nutrients.carbs = amount;
  else if (slot === 'fiber' && nutrients.fiber <= 0) nutrients.fiber = amount;
  else if (slot === 'protein' && nutrients.protein <= 0) nutrients.protein = amount;
  else if (slot === 'sodium' && nutrients.sodium <= 0) nutrients.sodium = amount;
  else if (slot === 'saturated_fat' && !nutrients.extras.some((row) => row.key === 'saturated_fat' && row.amount > 0)) {
    nutrients.extras.push({ key: 'saturated_fat', label: 'Saturated fat', amount, unit: 'g' });
  } else if (slot === 'cholesterol' && !nutrients.extras.some((row) => row.key === 'cholesterol' && row.amount > 0)) {
    nutrients.extras.push({ key: 'cholesterol', label: 'Cholesterol', amount, unit: 'mg' });
  } else if (slot === 'sugars' && !nutrients.extras.some((row) => row.key === 'sugar' && row.amount > 0)) {
    nutrients.extras.push({ key: 'sugar', label: 'Total sugars', amount, unit: 'g' });
  }
}

/** Scan OCR text for glued label+amount tokens and fill empty core slots. */
export function inferNutrientsFromGluedBlobs(raw: string): Nutrients {
  const nutrients = emptyNutrients();
  const text = raw.replace(/\r/g, '\n');

  for (const match of text.matchAll(OCR_ALNUM_BLOB_PATTERN)) {
    const blob = match[0] ?? '';
    const reading = parseGluedNutrientBlob(blob);
    if (reading) applyGluedReading(nutrients, reading);
  }

  for (const match of text.matchAll(/\b(total\s*fat)(\d+(?:\.\d+)?)([a-z]{1,6})/gi)) {
    const index = match.index ?? 0;
    if (isSaturatedOrTransBefore(text, index)) continue;
    const reading = parseGluedAmountTail(match[2]! + match[3]!, 'total_fat');
    if (reading) applyGluedReading(nutrients, reading);
  }

  return nutrients;
}