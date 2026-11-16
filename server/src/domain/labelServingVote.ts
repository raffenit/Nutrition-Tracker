import { parseNutritionLabel } from './parseLabel.js';

export type LabelServingFields = { servingLabel: string | null; servingsPerContainer: number | null };

/** A lone servings-per-container read is often a stray number near the garbled phrase. */
const MIN_SERVINGS_PER_CONTAINER_VOTES = 2;

function mostCommon<T>(values: T[], key: (value: T) => string, minVotes = 1): T | null {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const k = key(value);
    const entry = counts.get(k);
    if (entry) entry.count += 1;
    else counts.set(k, { value, count: 1 });
  }
  let best: { value: T; count: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best && best.count >= minVotes ? best.value : null;
}

/**
 * The header rows ("Serving size", "N servings per container") are often garbled in the
 * candidate picked for nutrients, so vote across every OCR candidate instead.
 */
export function voteServingFields(candidates: string[]): LabelServingFields {
  const parsed = candidates.map((text) => parseNutritionLabel(text));
  const labels = parsed.map((p) => p.servingLabel).filter((v): v is string => Boolean(v && v.trim()));
  const counts = parsed.map((p) => p.servingsPerContainer).filter((v): v is number => v != null && v > 0);
  return {
    servingLabel: mostCommon(labels, (label) => label.toLowerCase().replace(/\s+/g, ' ').trim()),
    servingsPerContainer: mostCommon(counts, String, Math.min(MIN_SERVINGS_PER_CONTAINER_VOTES, candidates.length)),
  };
}
