/**
 * Fuzzy match for Nutrition Facts row labels when OCR garbles spelling
 * (e.g. "Sedium" → sodium). Pattern-based, not product-specific.
 */

import { findEmbeddedCanonicalSpan, levenshtein } from './ocrConfusables.js';

export { levenshtein } from './ocrConfusables.js';

export type VariantLabelSlot =
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

type SingleWordLabel = {
  slot: VariantLabelSlot;
  canonical: string;
  /** Shorter tokens must match exactly (e.g. fat, carb). */
  exactOnlyBelowLength?: number;
};

const SINGLE_WORD_LABELS: SingleWordLabel[] = [
  { slot: 'calories', canonical: 'calories', exactOnlyBelowLength: 6 },
  { slot: 'sodium', canonical: 'sodium' },
  { slot: 'protein', canonical: 'protein' },
  { slot: 'cholesterol', canonical: 'cholesterol' },
  { slot: 'fiber', canonical: 'fiber', exactOnlyBelowLength: 5 },
  { slot: 'total_carb', canonical: 'carbohydrate' },
  { slot: 'sugars', canonical: 'sugars', exactOnlyBelowLength: 5 },
  { slot: 'total_fat', canonical: 'fat', exactOnlyBelowLength: 4 },
];

const CARB_SHORT = 'carb';

/** Letters plus `_` gaps (missing OCR strokes). */
export function normalizeOcrLabelToken(text: string): string {
  return text.toLowerCase().replace(/[^a-z_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export function normalizeLabelLetters(text: string): string {
  return normalizeOcrLabelToken(text).replace(/_/g, '');
}

/** OCR tokens like `S_dium` — underscores are not word separators. */
export const OCR_LABEL_TOKEN_PATTERN = /\b[A-Za-z](?:[A-Za-z_]*[A-Za-z])?\b/g;

/** Blobs where label, amount, and unit run together (`Icholesterol25mng`). */
export const OCR_ALNUM_BLOB_PATTERN = /\b[A-Za-z][A-Za-z0-9_]{3,42}\b/g;

function maxEditDistance(canonicalLength: number): number {
  if (canonicalLength <= 5) return 1;
  if (canonicalLength <= 9) return 2;
  return 2;
}

function fuzzyIndexOf(haystack: string, needle: string, fromIndex: number): number {
  const max = haystack.length - needle.length;
  for (let start = fromIndex; start <= max; start += 1) {
    const slice = haystack.slice(start, start + needle.length);
    if (slice === needle) return start;
    if (needle.length >= 4 && levenshtein(slice, needle) <= 1) return start;
  }
  return -1;
}

/** `s_dium` → ordered parts `s`, `dium` must appear in `sodium` (gap = missing letters). */
function gapSequenceMatches(tokenWithGaps: string, canonical: string): boolean {
  const parts = tokenWithGaps.split(/_+/).filter((part) => part.length > 0);
  if (parts.length < 2) return false;

  const collapsed = parts.join('');
  if (collapsed.length < canonical.length - maxEditDistance(canonical.length) - 1) return false;
  if (collapsed.length > canonical.length + 1) return false;

  let idx = 0;
  for (const part of parts) {
    let found = canonical.indexOf(part, idx);
    if (found < 0) found = fuzzyIndexOf(canonical, part, idx);
    if (found < 0) return false;
    idx = found + part.length;
  }

  return idx >= canonical.length - maxEditDistance(canonical.length);
}

function tokenMatchesCanonical(token: string, entry: SingleWordLabel): boolean {
  const withGaps = normalizeOcrLabelToken(token);
  const t = withGaps.replace(/_/g, '');
  const c = entry.canonical;
  if (!t) return false;

  if (findEmbeddedCanonicalSpan(token, c)) return true;

  if (t === c) return true;

  if (entry.exactOnlyBelowLength != null && c.length < entry.exactOnlyBelowLength) {
    return t === c;
  }

  if (withGaps.includes('_') && gapSequenceMatches(withGaps, c)) return true;

  if (entry.slot === 'total_carb' && t.startsWith(CARB_SHORT) && t.length >= 4) {
    if (t === CARB_SHORT || t === 'carbs') return true;
    if (levenshtein(t, c) <= maxEditDistance(c.length)) return true;
    return false;
  }

  const lenDelta = Math.abs(t.length - c.length);
  if (lenDelta > 2) return false;

  if (t.length >= 4 && c.startsWith(t)) return true;
  if (t.length >= 4 && t.startsWith(c.slice(0, 3)) && levenshtein(t, c) <= maxEditDistance(c.length)) {
    return true;
  }

  return levenshtein(t, c) <= maxEditDistance(c.length);
}

export function matchVariantLabelToken(token: string): VariantLabelSlot | null {
  const collapsed = normalizeLabelLetters(token);
  if (collapsed.length < 3 && !/[0-9]/.test(token)) return null;

  for (const entry of SINGLE_WORD_LABELS) {
    if (tokenMatchesCanonical(token, entry)) return entry.slot;
  }
  return null;
}

export function embeddedCanonicalForSlot(blob: string, slot: VariantLabelSlot): string | null {
  for (const entry of SINGLE_WORD_LABELS) {
    if (entry.slot !== slot) continue;
    if (findEmbeddedCanonicalSpan(blob, entry.canonical)) return entry.canonical;
  }
  return null;
}

/** Label-only OCR line (no digits): exact phrases first, then fuzzy tokens. */
export function classifyVariantLabelLine(line: string): VariantLabelSlot | null {
  const trimmed = line.trim();
  if (!trimmed || /\d/.test(trimmed)) return null;

  const lower = trimmed.toLowerCase();
  if (/calories\b/i.test(lower) && !/from\s+fat/i.test(lower)) return 'calories';
  if (/saturated\s+fat/i.test(lower)) return 'saturated_fat';
  if (/trans\s+fat/i.test(lower)) return 'trans_fat';
  if (/total\s+fat/i.test(lower)) return 'total_fat';
  if (/^fat\b/i.test(trimmed)) return 'total_fat';
  if (/total\s+carb/i.test(lower)) return 'total_carb';
  if (/^carbohydrate\b/i.test(trimmed)) return 'total_carb';
  if (/dietary\s+fiber/i.test(lower)) return 'fiber';
  if (/^fiber\b/i.test(trimmed)) return 'fiber';
  if (/added\s+sugars/i.test(lower)) return null;
  if (/total\s+sugars?/i.test(lower)) return 'sugars';
  if (/^sugars?\b/i.test(trimmed)) return 'sugars';
  if (/^protein\b/i.test(trimmed)) return 'protein';
  if (/^sodium\b/i.test(trimmed)) return 'sodium';
  if (/^cholesterol\b/i.test(trimmed)) return 'cholesterol';

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return matchVariantLabelToken(words[0]!);
  }

  if (/^total\b/i.test(words[0] ?? '')) {
    const second = words[1] ?? '';
    if (tokenMatchesCanonical(second, { slot: 'total_fat', canonical: 'fat', exactOnlyBelowLength: 4 })) {
      return 'total_fat';
    }
    if (tokenMatchesCanonical(second, { slot: 'total_carb', canonical: 'carbohydrate' })) {
      return 'total_carb';
    }
    if (tokenMatchesCanonical(second, { slot: 'sugars', canonical: 'sugars', exactOnlyBelowLength: 5 })) {
      return 'sugars';
    }
  }

  if (/^dietary\b/i.test(words[0] ?? '') && matchVariantLabelToken(words[1] ?? '') === 'fiber') {
    return 'fiber';
  }

  return null;
}

/** Find start indices in text where a fuzzy label token for `slot` appears. */
export function findVariantLabelAnchors(text: string, slot: VariantLabelSlot): number[] {
  const anchors: number[] = [];
  const push = (index: number) => {
    if (slot === 'total_fat' && isSaturatedOrTransBefore(text, index)) return;
    if (!anchors.includes(index)) anchors.push(index);
  };

  for (const match of text.matchAll(OCR_LABEL_TOKEN_PATTERN)) {
    const word = match[0] ?? '';
    const index = match.index ?? 0;
    if (normalizeLabelLetters(word).length < 3) continue;
    if (matchVariantLabelToken(word) !== slot) continue;
    push(index);
  }

  for (const match of text.matchAll(OCR_ALNUM_BLOB_PATTERN)) {
    const blob = match[0] ?? '';
    const index = match.index ?? 0;
    if (embeddedCanonicalForSlot(blob, slot)) push(index);
  }

  if (slot === 'total_fat') {
    for (const match of text.matchAll(/\btotal\s+fat\b/gi)) {
      const index = match.index ?? 0;
      if (!anchors.includes(index)) anchors.push(index);
    }
    for (const match of text.matchAll(/\bt[a-z]{3,7}l\s+fat(?![a-z])/gi)) {
      const index = match.index ?? 0;
      if (!/saturat|trans/i.test(text.slice(Math.max(0, index - 10), index))) push(index);
    }
    for (const match of text.matchAll(/(?<![a-z])fat(\d+(?:\.\d+)?)/gi)) {
      const index = match.index ?? 0;
      if (isSaturatedOrTransBefore(text, index)) continue;
      push(index);
    }
  }

  if (slot === 'saturated_fat') {
    for (const match of text.matchAll(/\bs\w*at\w*[^a-z]{0,10}fat\b/gi)) {
      const index = match.index ?? 0;
      const before = text.slice(Math.max(0, index - 12), index);
      if (/trans\s*$/i.test(before)) continue;
      push(index);
    }
  }

  if (slot === 'trans_fat') {
    for (const match of text.matchAll(/\btrans\s+fat\b/gi)) {
      push(match.index ?? 0);
    }
    for (const match of text.matchAll(/\btrans\s+fat\s+o?g\b/gi)) {
      push(match.index ?? 0);
    }
  }

  return anchors.sort((a, b) => a - b);
}

function isSaturatedOrTransBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 24), index);
  return /saturat|trans\s*$/i.test(before);
}
