export type FuzzyMeasureUnit = 'g' | 'mg' | 'mcg' | 'ml' | 'kcal';

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[] = new Array(rows * cols);
  for (let i = 0; i < rows; i += 1) matrix[i * cols] = i;
  for (let j = 0; j < cols; j += 1) matrix[j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const idx = i * cols + j;
      matrix[idx] = Math.min(
        matrix[(i - 1) * cols + j]! + 1,
        matrix[i * cols + (j - 1)]! + 1,
        matrix[(i - 1) * cols + (j - 1)]! + cost,
      );
    }
  }
  return matrix[(rows - 1) * cols + (cols - 1)]!;
}

/** Same-shape OCR slips when reading digits (not product-specific). */
const DIGIT_LOOKALIKE: Record<string, string> = {
  i: '1',
  l: '1',
  I: '1',
  L: '1',
  '|': '1',
  o: '0',
  O: '0',
  z: '2',
  Z: '2',
  s: '5',
  S: '5',
  b: '8',
  B: '8',
};

/** In unit/amount context, `g` is often misread as `9` and vice versa. */
export function normalizeDigitRun(text: string): string {
  let out = '';
  for (const char of text) {
    if (char >= '0' && char <= '9') {
      out += char;
      continue;
    }
    if (char === 'g' || char === 'G') {
      out += '9';
      continue;
    }
    const mapped = DIGIT_LOOKALIKE[char];
    out += mapped ?? char;
  }
  return out;
}

/** Single-character amount OCR: `I` / `l` → 1 when followed by a mass unit. */
export function parseConfusableAmountToken(token: string): number | null {
  const trimmed = token.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[Il|1]$/.test(trimmed)) return 1;
  if (/^[Il|]\d$/.test(trimmed)) return Number(normalizeDigitRun(trimmed));
  const normalized = normalizeDigitRun(trimmed);
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  return null;
}

const MASS_UNITS: FuzzyMeasureUnit[] = ['mg', 'mcg', 'ml', 'g', 'kcal'];

/** `mng`, `m9`, `Ng` → mg; trailing noise allowed within edit distance. */
export function parseFuzzyMassUnit(raw: string): FuzzyMeasureUnit | null {
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned) return null;

  for (const unit of MASS_UNITS) {
    if (cleaned === unit) return unit;
  }

  if (cleaned.length <= 5) {
    let best: FuzzyMeasureUnit | null = null;
    let bestDist = 99;
    for (const unit of MASS_UNITS) {
      const dist = levenshtein(cleaned, unit);
      const max = unit.length <= 2 ? 1 : 2;
      if (dist <= max && dist < bestDist) {
        bestDist = dist;
        best = unit;
      }
    }
    if (best) return best;
  }

  if (cleaned.startsWith('m') && cleaned.length <= 4 && levenshtein(cleaned, 'mg') <= 2) return 'mg';
  if (/^m[9g8]$/i.test(cleaned)) return 'mg';
  if (cleaned.length === 1 && cleaned === 'g') return 'g';

  return null;
}

export type ExpectedMassUnit = 'g' | 'mg';

/** Unit letter glued to this specific amount token (not another nutrient later in the slice). */
export function hasExplicitMassUnitForAmount(
  fragment: string,
  amountLiteral: string,
  expected: ExpectedMassUnit,
): boolean {
  const escaped = amountLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (expected === 'g') {
    return new RegExp(`${escaped}\\s*(?:g|gm|gr)\\b`, 'i').test(fragment)
      || new RegExp(`${escaped}(?:g|gm|gr)\\b`, 'i').test(fragment);
  }
  return new RegExp(`${escaped}\\s*(?:mg|mcg|μg|ug)\\b`, 'i').test(fragment)
    || new RegExp(`${escaped}(?:mg|mcg)\\b`, 'i').test(fragment)
    || new RegExp(`${escaped}(?:m9|mng|Ng)\\b`, 'i').test(fragment);
}

/** @deprecated prefer hasExplicitMassUnitForAmount for amount correction context */
export function hasExplicitMassUnitInFragment(fragment: string, expected: ExpectedMassUnit): boolean {
  if (expected === 'g') {
    return /(?:\d+(?:\.\d+)?\s*(?:g|gm|gr)\b)|(?:\d+(?:\.\d+)?(?:g|gm|gr)\b)/i.test(fragment);
  }
  return /(?:\d+(?:\.\d+)?\s*(?:mg|mcg|μg|ug)\b)|(?:\d+(?:\.\d+)?(?:mg|mcg)\b)/i.test(fragment)
    || /\d\s*(?:mg|m\s*g|Ng|mng|m9)\b/i.test(fragment);
}

/** @deprecated use hasExplicitMassUnitInFragment(fragment, 'g') */
export function hasExplicitGramUnitInFragment(fragment: string): boolean {
  return hasExplicitMassUnitInFragment(fragment, 'g');
}

type TrailingMisreadRule = {
  re: RegExp;
  base: (match: RegExpMatchArray) => string | null;
  maxAmount?: number;
  /** Extra guard so we do not strip a real trailing digit (e.g. 4.59 g as 4.5). */
  validate?: (literal: string, corrected: number) => boolean;
};

/**
 * When OCR glues a unit glyph onto the amount and the unit token disappears,
 * the last character is often a confusable stand-in for the unit letter.
 */
const TRAILING_UNIT_MISREAD_RULES: Record<ExpectedMassUnit, TrailingMisreadRule[]> = {
  g: [
    {
      re: /^(\d+\.\d)([9gq6])$/i,
      base: (m) => m[1] ?? null,
      maxAmount: 100,
    },
    {
      re: /^(\d+)([9gq])$/i,
      base: (m) => m[1] ?? null,
      maxAmount: 100,
      validate: (literal, corrected) => {
        const merged = Number(literal);
        return merged > corrected && merged < corrected * 10 + 10;
      },
    },
  ],
  mg: [
    {
      re: /^(\d+\.\d)([9])$/,
      base: (m) => m[1] ?? null,
      maxAmount: 999,
    },
  ],
};

/** Confusable suffix chars → unit they stand in for (for docs/tests). */
export const UNIT_SUFFIX_MISREAD_CHARS: Record<ExpectedMassUnit, string> = {
  g: '9gq6 (9 most common — merged g)',
  mg: '9 (merged g on mg rows when “mg” collapsed)',
};

export function correctAmountIfUnitMisreadAsSuffix(
  amountLiteral: string,
  expected: ExpectedMassUnit,
  contextFragment: string,
): number {
  const trimmed = amountLiteral.trim();
  if (!trimmed) return Number.NaN;
  if (hasExplicitMassUnitForAmount(contextFragment, trimmed, expected)) {
    return Number(trimmed);
  }

  for (const rule of TRAILING_UNIT_MISREAD_RULES[expected]) {
    const match = trimmed.match(rule.re);
    if (!match) continue;
    const base = rule.base(match);
    if (!base) continue;
    const corrected = Number(base);
    if (!Number.isFinite(corrected) || corrected <= 0) continue;
    if (rule.maxAmount != null && corrected > rule.maxAmount) continue;
    if (rule.validate && !rule.validate(trimmed, corrected)) continue;
    return corrected;
  }

  return Number(trimmed);
}

/** @deprecated use correctAmountIfUnitMisreadAsSuffix(literal, 'g', fragment) */
export function correctGramAmountIfTrailingNineIsMisreadUnit(
  amountLiteral: string,
  contextFragment: string,
): number {
  return correctAmountIfUnitMisreadAsSuffix(amountLiteral, 'g', contextFragment);
}

/** Parse `25mng`, `Ig`, `2.5g`, `I g` with confusable digits/units. */
export function parseAmountWithFuzzyUnit(fragment: string): { amount: number; unit: FuzzyMeasureUnit } | null {
  const trimmed = fragment.trim();
  if (!trimmed) return null;

  const glued = trimmed.match(/^(\d+(?:\.\d+)?|[Il|1])([A-Za-z]{1,6})/);
  if (glued) {
    const amount = parseConfusableAmountToken(glued[1] ?? '');
    const unit = parseFuzzyMassUnit(glued[2] ?? '');
    if (amount != null && unit) return { amount, unit };
  }

  const spaced = trimmed.match(/^(\d+(?:\.\d+)?|[Il|1])\s*([A-Za-z]{1,6})\b/);
  if (spaced) {
    const amount = parseConfusableAmountToken(spaced[1] ?? '');
    const unit = parseFuzzyMassUnit(spaced[2] ?? '');
    if (amount != null && unit) return { amount, unit };
  }

  return null;
}

export function ocrLabelLettersEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const pair = `${a}${b}`;
  if (pair === 'il' || pair === 'li' || pair === 'i1' || pair === '1i' || pair === 'l1' || pair === '1l') return true;
  return false;
}

/** Canonical label word embedded in a noisy alphanumeric blob (`Icholesterol25mng`). */
export function findEmbeddedCanonicalSpan(
  blob: string,
  canonical: string,
): { start: number; end: number } | null {
  const hay = blob.toLowerCase();
  const needle = canonical.toLowerCase();
  if (needle.length < 4) return null;

  for (let start = 0; start < hay.length; start += 1) {
    let hi = start;
    let matched = 0;
    for (let ci = 0; ci < needle.length; ci += 1) {
      const want = needle[ci]!;
      let found = false;
      while (hi < hay.length) {
        const have = hay[hi]!;
        hi += 1;
        if (!/[a-z]/.test(have)) continue;
        if (have === want || ocrLabelLettersEquivalent(have, want)) {
          matched += 1;
          found = true;
          break;
        }
        if (matched === 0) continue;
        break;
      }
      if (!found) break;
    }
    if (matched === needle.length) {
      return { start, end: hi };
    }
  }
  return null;
}
