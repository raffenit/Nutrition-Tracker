import { looksLikePlausibleCalorieCell } from './sharedLabelGridStageReport.js';

/**
 * Scan full per-column header OCR (product name, Varies, display calories, serving size).
 * Does not skip lines — content is unknown until read.
 */
export function pickPlausibleCalorieFromHeaderColumnOcr(columnText: string): string {
  const lines = columnText.replace(/\r/g, '\n').split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (looksLikePlausibleCalorieCell(line)) {
      const digits = line.match(/^(\d{2,4})\b/)?.[1];
      return digits ?? line;
    }
    const tokens = line.split(/\s+/);
    for (const token of tokens) {
      if (looksLikePlausibleCalorieCell(token)) {
        return token.match(/^(\d{2,4})\b/)?.[1] ?? token;
      }
    }
  }
  return '';
}

export function headerColumnCalorieCells(headerColumnTexts: string[] | undefined): string[] {
  if (!headerColumnTexts?.length) return [];
  return headerColumnTexts.map((text) => pickPlausibleCalorieFromHeaderColumnOcr(text));
}

export function shouldUseHeaderColumnCalories(headerColumnTexts: string[] | undefined): boolean {
  const cells = headerColumnCalorieCells(headerColumnTexts);
  if (cells.length < 2) return false;
  return cells.filter((c) => looksLikePlausibleCalorieCell(c)).length >= 2;
}

/** Display kcal above % Daily Value — not present in body value strips on many variety packs. */
export function pickPlausibleCalorieFromValueColumnPreamble(text: string): string {
  let afterJunkFallback = '';
  let inNutrientRows = false;
  for (const raw of text.replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Garbled headings ("%Dally Valu", "% Daily Walue") still end the preamble.
    if (/%\s*d[a-z]{2,4}\s*[vw][a-z]{2,4}/i.test(line)) break;
    if (/\d\s*(?:m?g\b|%)/i.test(line)) inNutrientRows = true;
    if (/amount\s+per\s+serving/i.test(line)) continue;
    if (looksLikePlausibleCalorieCell(line)) {
      return line.match(/^(\d{2,4})\b/)?.[1] ?? line.trim();
    }
    const solo = line.match(/^(\d{2,4})\s*$/);
    if (solo) return solo[1]!;
    // Stray rule / glare glyphs ahead of the count ("| Sl 80"); words like "Bar 17" don't count,
    // and a clean count later in the preamble still wins.
    const afterJunk = line.match(/^(?:[^\d\s]{1,2}\s+){1,2}(\d{2,4})\s*$/);
    if (afterJunk && !afterJunkFallback && !inNutrientRows) afterJunkFallback = afterJunk[1]!;
  }
  return afterJunkFallback;
}

/**
 * Per-column serving-size display calories (header stack, then value-column preamble).
 * Returns null when too few columns look like kcal (stitch keeps index-based fallback).
 */
export function buildCalorieRowCellsForStitch(
  valueColumnTexts: string[],
  headerColumnTexts?: string[],
): string[] | null {
  const cells = valueColumnTexts.map((text, i) => {
    const fromHeader = pickPlausibleCalorieFromHeaderColumnOcr(headerColumnTexts?.[i] ?? '');
    if (fromHeader) return fromHeader;
    return pickPlausibleCalorieFromValueColumnPreamble(text);
  });
  const plausible = cells.filter((c) => looksLikePlausibleCalorieCell(c)).length;
  if (plausible < 2) return null;
  return cells.map((c) => c.trim());
}

export function shouldInjectCalorieRowOverride(cells: string[] | null): cells is string[] {
  return cells != null && cells.filter((c) => looksLikePlausibleCalorieCell(c)).length >= 2;
}