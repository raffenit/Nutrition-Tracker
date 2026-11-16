/**
 * Per-slot OCR merge: match expected row names + units only (never expected numeric values).
 */

import { sliceForLabelAnchor } from './labelBoundaries.js';
import { parseMeasuredAmount, readNutrientAmountInSlice, readSodiumFromMacroGap } from './labelUnits.js';
import { findVariantLabelAnchors, type VariantLabelSlot } from './labelVariants.js';
import { emptyNutrients } from './nutrients.js';
import { scoreLabelExtraction } from './labelSlots.js';
import type { Nutrients } from '../types.js';

export type LabelSlotKey =
  | 'calories'
  | 'fat'
  | 'sodium'
  | 'protein'
  | 'fiber'
  | 'carbs'
  | 'saturated_fat'
  | 'cholesterol'
  | 'sugar';

type SlotSpec = {
  key: LabelSlotKey;
  variantSlot: VariantLabelSlot;
  unit: 'g' | 'mg' | 'kcal';
  window: number;
  extraKey?: string;
  extraLabel?: string;
};

const SLOT_SPECS: SlotSpec[] = [
  { key: 'calories', variantSlot: 'calories', unit: 'kcal', window: 32 },
  { key: 'fat', variantSlot: 'total_fat', unit: 'g', window: 28 },
  { key: 'sodium', variantSlot: 'sodium', unit: 'mg', window: 28 },
  { key: 'protein', variantSlot: 'protein', unit: 'g', window: 22 },
  { key: 'fiber', variantSlot: 'fiber', unit: 'g', window: 24 },
  { key: 'carbs', variantSlot: 'total_carb', unit: 'g', window: 26 },
  { key: 'saturated_fat', variantSlot: 'saturated_fat', unit: 'g', window: 30, extraKey: 'saturated_fat', extraLabel: 'Saturated fat' },
  { key: 'cholesterol', variantSlot: 'cholesterol', unit: 'mg', window: 24, extraKey: 'cholesterol', extraLabel: 'Cholesterol' },
  { key: 'sugar', variantSlot: 'sugars', unit: 'g', window: 24, extraKey: 'sugar', extraLabel: 'Total sugars' },
];

export type SlotReading = {
  slot: LabelSlotKey;
  amount: number | null;
  /** How clearly the row *name* matched (not the numeric value). */
  labelStrength: number;
  unitMatched: boolean;
  candidateIndex: number;
};

const PHRASE_AT: Array<{ slot: VariantLabelSlot; re: RegExp; strength: number }> = [
  { slot: 'calories', re: /\bcalories\b/i, strength: 100 },
  { slot: 'total_fat', re: /\btotal\s+fat\b/i, strength: 100 },
  { slot: 'saturated_fat', re: /\bsaturated\s+fat\b/i, strength: 100 },
  { slot: 'trans_fat', re: /\btrans\s+fat\b/i, strength: 100 },
  { slot: 'cholesterol', re: /\bcholesterol\b/i, strength: 100 },
  { slot: 'sodium', re: /\bsodium\b/i, strength: 100 },
  { slot: 'total_carb', re: /\btotal\s+carb(?:ohydrate)?\.?\b/i, strength: 100 },
  { slot: 'fiber', re: /\bdietary\s+fiber\b/i, strength: 95 },
  { slot: 'fiber', re: /\bfiber\b/i, strength: 85 },
  { slot: 'sugars', re: /\btotal\s+sugars?\b/i, strength: 100 },
  { slot: 'protein', re: /\bprotein\b/i, strength: 100 },
  { slot: 'sodium', re: /\bs[oei]?d[iu]?[a-z]{0,8}m\b/i, strength: 82 },
  { slot: 'total_fat', re: /\bt[a-z]{3,7}l\s+fat\b/i, strength: 80 },
];

/** Anchors can land on the second word ("Carbohydrate" in "Total Carbohydrate"); look back on the same line. */
const LABEL_STRENGTH_LOOKBACK = 10;

/** Fuzzy row-label slot used to find a nutrient's line (e.g. carbs → total_carb). */
export function variantLabelSlotFor(slot: LabelSlotKey): VariantLabelSlot | null {
  return SLOT_SPECS.find((spec) => spec.key === slot)?.variantSlot ?? null;
}

function labelStrengthAt(text: string, index: number, variantSlot: VariantLabelSlot): number {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  const slice = text.slice(Math.max(lineStart, index - LABEL_STRENGTH_LOOKBACK), index + 28);
  let best = 65;
  for (const row of PHRASE_AT) {
    if (row.slot !== variantSlot) continue;
    if (row.re.test(slice)) best = Math.max(best, row.strength);
  }
  return best;
}

function readCaloriesInSlice(slice: string): { amount: number | null; unitMatched: boolean } {
  const region = slice.slice(0, 36);
  const measured = parseMeasuredAmount(region);
  if (measured?.unit === 'kcal') return { amount: measured.amount, unitMatched: true };
  const slash = region.match(/\bcalories\b(?!\s+from\s+fat)[^\d]{0,20}(\d{2,4})\/(\d{1,2})\b/i);
  if (slash) {
    const merged = Number(slash[1] ?? '');
    const dv = Number(slash[2] ?? '');
    if (dv >= 1 && dv <= 99 && merged >= 100 && merged % 10 !== 0) {
      return { amount: merged - (merged % 10), unitMatched: false };
    }
    return { amount: merged, unitMatched: false };
  }
  const bare = region.match(/\bcalories\b(?!\s+from\s+fat)[^\d]{0,20}(\d{2,4})\b/i);
  if (bare) return { amount: Number(bare[1]), unitMatched: false };
  return { amount: null, unitMatched: false };
}

function readSlotInSlice(
  spec: SlotSpec,
  slice: string,
): { amount: number | null; unitMatched: boolean } {
  if (spec.unit === 'kcal') return readCaloriesInSlice(slice);
  const unitSlot =
    spec.key === 'carbs' ? 'total_carb'
    : spec.key === 'fat' ? 'total_fat'
    : spec.key === 'fiber' ? 'fiber'
    : spec.key === 'protein' ? 'protein'
    : spec.key === 'sodium' ? 'sodium'
    : spec.key === 'cholesterol' ? 'cholesterol'
    : spec.key === 'sugar' ? 'sugars'
    : undefined;
  const amount = readNutrientAmountInSlice(slice, spec.unit, unitSlot);
  return { amount, unitMatched: amount != null };
}

function readingScore(reading: SlotReading): number {
  if (reading.amount == null || reading.amount <= 0) return 0;
  let score = reading.labelStrength;
  if (reading.unitMatched) score += 50;
  else score += 20;
  return score;
}

/** All slot readings from one OCR candidate string. */
export function extractSlotReadingsFromText(text: string, candidateIndex: number): SlotReading[] {
  const readings: SlotReading[] = [];

  for (const spec of SLOT_SPECS) {
    let best: SlotReading | null = null;
    for (const index of findVariantLabelAnchors(text, spec.variantSlot)) {
      const slice = sliceForLabelAnchor(text, index, spec.variantSlot, spec.window);
      const { amount, unitMatched } = readSlotInSlice(spec, slice);
      const candidate: SlotReading = {
        slot: spec.key,
        amount,
        labelStrength: labelStrengthAt(text, index, spec.variantSlot),
        unitMatched,
        candidateIndex,
      };
      if (!best || readingScore(candidate) > readingScore(best)) best = candidate;
    }

    if (spec.key === 'sodium' && (!best || best.amount == null)) {
      const gap = readSodiumFromMacroGap(text);
      if (gap != null && gap > 0) {
        const layout: SlotReading = {
          slot: 'sodium',
          amount: gap,
          labelStrength: 28,
          unitMatched:
            /\bmg\b|m[a-z]{1,3}|Ng/i.test(text)
            || /[\[(]\s*\d\s*g[a-z]/i.test(text)
            || /\d\s*g[a-z0-9]{2,12}\s*(?:%|\d\s*%)/i.test(text),
          candidateIndex,
        };
        if (!best || readingScore(layout) > readingScore(best)) best = layout;
      }
    }

    if (best && best.amount != null && best.amount > 0) readings.push(best);
  }

  return readings;
}

function applyReadingToNutrients(nutrients: Nutrients, reading: SlotReading, spec: SlotSpec): void {
  const amount = reading.amount;
  if (amount == null || amount <= 0) return;
  if (spec.extraKey && spec.extraLabel) {
    if (nutrients.extras.some((row) => row.key === spec.extraKey)) return;
    nutrients.extras.push({ key: spec.extraKey, label: spec.extraLabel, amount, unit: spec.unit === 'mg' ? 'mg' : 'g' });
    return;
  }
  if (spec.key === 'calories') nutrients.calories = amount;
  else if (spec.key === 'fat') nutrients.fat = amount;
  else if (spec.key === 'sodium') nutrients.sodium = amount;
  else if (spec.key === 'protein') nutrients.protein = amount;
  else if (spec.key === 'fiber') nutrients.fiber = amount;
  else if (spec.key === 'carbs') nutrients.carbs = amount;
}

type SlotAmountGroup = {
  amount: number;
  best: SlotReading;
  bestScore: number;
  /** Distinct OCR candidates whose best reading for this slot has this amount. */
  support: number;
};

function groupSlotReadings(candidates: string[]): Map<LabelSlotKey, SlotAmountGroup[]> {
  const groups = new Map<LabelSlotKey, SlotAmountGroup[]>();
  candidates.forEach((text, candidateIndex) => {
    for (const reading of extractSlotReadingsFromText(text, candidateIndex)) {
      const amount = reading.amount;
      if (amount == null || amount <= 0) continue;
      const score = readingScore(reading);
      const list = groups.get(reading.slot) ?? [];
      const group = list.find((g) => g.amount === amount);
      if (group) {
        group.support += 1;
        if (score > group.bestScore) {
          group.best = reading;
          group.bestScore = score;
        }
      } else {
        list.push({ amount, best: reading, bestScore: score, support: 1 });
      }
      groups.set(reading.slot, list);
    }
  });
  for (const list of groups.values()) {
    list.sort((a, b) => b.bestScore - a.bestScore || b.support - a.support);
  }
  return groups;
}

/** Name/unit score gap under which a different amount still contests the winner. */
const SLOT_CONTEST_SCORE_MARGIN = 10;

export type SlotConsensus = {
  slot: LabelSlotKey;
  amount: number;
  support: number;
  /** Another amount scored within SLOT_CONTEST_SCORE_MARGIN of the winner. */
  contested: boolean;
  rivals: number[];
};

/**
 * Per-slot winner plus agreement across candidates. Equal name/unit scores are broken by how many
 * candidates read the same amount — never by expected values.
 */
export function assessSlotConsensus(candidates: string[]): Map<LabelSlotKey, SlotConsensus> {
  const out = new Map<LabelSlotKey, SlotConsensus>();
  for (const [slot, list] of groupSlotReadings(candidates)) {
    const winner = list[0];
    if (!winner) continue;
    const rivals = list
      .slice(1)
      .filter((g) => g.bestScore >= winner.bestScore - SLOT_CONTEST_SCORE_MARGIN)
      .map((g) => g.amount);
    out.set(slot, {
      slot,
      amount: winner.amount,
      support: winner.support,
      contested: rivals.length > 0,
      rivals,
    });
  }
  return out;
}

/** Merge best per-slot readings across OCR candidates (names + units, not target values). */
export function mergeSlotReadingsAcrossCandidates(candidates: string[]): Nutrients | null {
  if (candidates.length === 0) return null;

  const groups = groupSlotReadings(candidates);
  if (groups.size === 0) return null;

  const nutrients = emptyNutrients();
  for (const spec of SLOT_SPECS) {
    const winner = groups.get(spec.key)?.[0];
    if (winner) applyReadingToNutrients(nutrients, winner.best, spec);
  }
  return nutrients;
}

/** Index of candidate that contributed the most winning slots (for field review text). */
export function primaryCandidateIndex(candidates: string[]): number {
  if (candidates.length === 0) return 0;
  const wins = new Map<number, number>();
  const all = new Map<LabelSlotKey, SlotReading>();
  candidates.forEach((text, candidateIndex) => {
    for (const reading of extractSlotReadingsFromText(text, candidateIndex)) {
      const prev = all.get(reading.slot);
      if (!prev || readingScore(reading) > readingScore(prev)) {
        all.set(reading.slot, reading);
      }
    }
  });
  for (const reading of all.values()) {
    wins.set(reading.candidateIndex, (wins.get(reading.candidateIndex) ?? 0) + 1);
  }
  let bestIdx = 0;
  let bestWins = -1;
  for (const [idx, count] of wins) {
    if (count > bestWins) {
      bestWins = count;
      bestIdx = idx;
    }
  }
  if (bestWins <= 0) {
    let bestScore = -1;
    candidates.forEach((text, idx) => {
      const score = scoreLabelExtraction(text);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
  }
  return bestIdx;
}
