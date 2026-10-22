import {
  findVariantLabelAnchors,
  type VariantLabelSlot,
} from './labelVariants.js';

export type NutrientLabelBoundary = {
  index: number;
  slot: VariantLabelSlot;
};

const ALL_VARIANT_SLOTS: VariantLabelSlot[] = [
  'calories',
  'total_fat',
  'saturated_fat',
  'trans_fat',
  'cholesterol',
  'sodium',
  'total_carb',
  'fiber',
  'sugars',
  'protein',
];

/** More specific rows win when OCR puts two labels at the same index. */
const BOUNDARY_SLOT_RANK: Record<VariantLabelSlot, number> = {
  saturated_fat: 95,
  trans_fat: 95,
  total_fat: 85,
  cholesterol: 80,
  sodium: 80,
  total_carb: 75,
  fiber: 70,
  sugars: 70,
  protein: 70,
  calories: 65,
};

const PHRASE_BOUNDARIES: Array<{ slot: VariantLabelSlot; re: RegExp }> = [
  { slot: 'saturated_fat', re: /\bs\w*at\w*\s+fat\b/gi },
  { slot: 'saturated_fat', re: /\bsaturated\s+fat\b/gi },
  { slot: 'trans_fat', re: /\btrans\s+fat\b/gi },
  { slot: 'total_fat', re: /\btotal\s+fat\b/gi },
  { slot: 'total_carb', re: /\btotal\s+carb(?:ohydrate)?\.?\b/gi },
  { slot: 'fiber', re: /\bdietary\s+fiber\b/gi },
  { slot: 'sugars', re: /\btotal\s+sugars?\b/gi },
  { slot: 'cholesterol', re: /\bcholesterol\b/gi },
  { slot: 'sodium', re: /\bsodium\b/gi },
  { slot: 'protein', re: /\bprotein\b/gi },
  { slot: 'calories', re: /\bcalories\b/gi },
  { slot: 'fiber', re: /\bfiber\b/gi },
  { slot: 'sugars', re: /\bsugars?\b/gi },
];

/**
 * Ordered label starts in OCR text (including single-line paragraph runs).
 * Used to split a window so `Fat 2.59 … Protein 30g` does not share one amount region.
 *
 * UI option (not wired): when two+ boundaries fall within a short OCR span with no newline,
 * `assessLabelFieldReview` could add a `review` entry explaining that import split rows
 * automatically — see `findNutrientLabelBoundaries` + `sliceForLabelAnchor`.
 */
export function findNutrientLabelBoundaries(text: string): NutrientLabelBoundary[] {
  const hits: Array<NutrientLabelBoundary & { rank: number }> = [];

  for (const { slot, re } of PHRASE_BOUNDARIES) {
    for (const match of text.matchAll(re)) {
      const index = match.index ?? 0;
      if (slot === 'calories' && /from\s+fat/i.test(text.slice(index, index + 22))) continue;
      hits.push({ index, slot, rank: BOUNDARY_SLOT_RANK[slot] });
    }
  }

  for (const slot of ALL_VARIANT_SLOTS) {
    for (const index of findVariantLabelAnchors(text, slot)) {
      hits.push({ index, slot, rank: BOUNDARY_SLOT_RANK[slot] - 5 });
    }
  }

  hits.sort((a, b) => a.index - b.index || b.rank - a.rank);

  const merged: NutrientLabelBoundary[] = [];
  for (const hit of hits) {
    const prev = merged[merged.length - 1];
    if (prev && prev.index === hit.index) {
      if (hit.rank > BOUNDARY_SLOT_RANK[prev.slot]) prev.slot = hit.slot;
      continue;
    }
    if (prev && hit.index - prev.index <= 1 && prev.slot === hit.slot) continue;
    merged.push({ index: hit.index, slot: hit.slot });
  }

  return merged;
}

/** Slice for one nutrient row, stopping at the next different label (or max length). */
export function sliceForLabelAnchor(
  text: string,
  anchorIndex: number,
  anchorSlot: VariantLabelSlot,
  maxChars: number,
): string {
  const boundaries = findNutrientLabelBoundaries(text);
  const next = boundaries.find((row) => row.index > anchorIndex && row.slot !== anchorSlot);
  const end = next ? Math.min(next.index, anchorIndex + maxChars) : anchorIndex + maxChars;
  return text.slice(anchorIndex, end);
}
