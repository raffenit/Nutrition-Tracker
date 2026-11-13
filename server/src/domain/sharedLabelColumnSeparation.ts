import { extractRowLabels, extractValueLines } from './stitchSharedLabelGridTexts.js';

export type SharedLabelImageStripRegion = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Analysis-band segments strictly on the product side of {@link labelBoundaryX}. */
export function productValueSegmentsRightOfLabel(
  segments: Array<{ x0: number; x1: number }>,
  labelBoundaryX: number,
  minWidthAnalysisPx = 2,
): Array<{ x0: number; x1: number }> {
  return segments
    .map((seg) => ({
      x0: Math.max(seg.x0, labelBoundaryX),
      x1: seg.x1,
    }))
    .filter((seg) => seg.x1 - seg.x0 >= minWidthAnalysisPx);
}

/** Clamp image-space value crops so none overlap the label rail strip. */
export function enforceValueColumnsDisjointFromLabel(
  labelColumn: SharedLabelImageStripRegion,
  valueColumns: SharedLabelImageStripRegion[],
): SharedLabelImageStripRegion[] {
  const labelRight = labelColumn.left + labelColumn.width;
  const kept: SharedLabelImageStripRegion[] = [];
  for (let i = 0; i < valueColumns.length; i += 1) {
    const col = valueColumns[i]!;
    if (col.left + col.width <= labelRight) continue;
    const left = Math.max(col.left, labelRight);
    const width = col.left + col.width - left;
    if (width < 1) continue;
    kept.push({
      ...col,
      index: kept.length,
      left,
      width,
    });
  }
  return kept;
}

function normalizeLineKey(line: string): string {
  return line.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sharedNutrientLineKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const label of extractRowLabels(text)) {
    keys.add(normalizeLineKey(label));
  }
  for (const raw of text.replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(amount per serving|serving size|% daily value)/i.test(line)) {
      keys.add(normalizeLineKey(line));
    }
  }
  return keys;
}

/**
 * True when OCR from a value strip is almost certainly the shared label rail
 * (nutrient names / serving boilerplate, no extractable value lines).
 */
function valueTextHasProductValueSignals(text: string): boolean {
  if (/%\s*daily\s*value/i.test(text)) return true;
  if (/\bvaries\b/i.test(text)) return true;
  if (/®|™/.test(text)) return true;
  if (/\d+\s*(?:g|mg|kcal|%)/i.test(text)) return true;
  return false;
}

function valueTextLooksLikeLabelBoilerplateOnly(text: string): boolean {
  if (valueTextHasProductValueSignals(text)) return false;
  let signals = 0;
  if (/nutrition\s*facts/i.test(text)) signals += 1;
  if (/\bserving\b/i.test(text)) signals += 1;
  if (/amount\s+per/i.test(text)) signals += 1;
  if (/\b(calories|total fat|saturated fat|sodium|protein)\b/i.test(text)) signals += 1;
  return signals >= 2;
}

export function valueColumnTextLooksLikeLabelRail(labelColumnText: string, valueColumnText: string): boolean {
  const valueLines = extractValueLines(valueColumnText);
  if (valueLines.length > 0) return false;
  if (valueTextHasProductValueSignals(valueColumnText)) return false;

  const labelRowLabelCount = extractRowLabels(labelColumnText).length;
  if (labelRowLabelCount < 2) return false;

  const labelKeys = sharedNutrientLineKeys(labelColumnText);
  const valueRowLabels = extractRowLabels(valueColumnText);
  if (labelKeys.size > 0 && valueRowLabels.length >= 2) {
    const matched = valueRowLabels.filter((r) => labelKeys.has(normalizeLineKey(r))).length;
    if (matched >= 2) return true;
  }

  if (valueTextLooksLikeLabelBoilerplateOnly(valueColumnText)) return true;

  const noisyLabelSignals =
    (valueColumnText.match(/\b(?:facts?|serv\w*|amount|calor\w*|sodium|fat|protein)/gi) ?? []).length;
  const digitCount = (valueColumnText.match(/\d/g) ?? []).length;
  if (noisyLabelSignals >= 2 && digitCount <= 1) return true;

  let boilerplateHits = 0;
  for (const raw of valueColumnText.replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const key = normalizeLineKey(line);
    if (labelKeys.has(key)) boilerplateHits += 1;
    if (/^nutrition\s+facts/i.test(line)) boilerplateHits += 1;
    if (/^(amount per serving|serving size)/i.test(line)) boilerplateHits += 1;
  }
  return labelKeys.size > 0 && boilerplateHits >= 2;
}

/** Leading strip with no values while other columns have a table — usually label rail bleed. */
export function looksLikeLeadingLabelBleedColumn(
  columnIndex: number,
  valueColumnTexts: string[],
  labelColumnText: string,
): boolean {
  if (columnIndex !== 0) return false;
  const first = valueColumnTexts[0];
  if (!first) return false;
  if (extractValueLines(first).length > 0) return false;
  if (valueTextHasProductValueSignals(first)) return false;
  const siblingsHaveTable = valueColumnTexts
    .slice(1)
    .some((text) => extractValueLines(text).length >= 2 || valueTextHasProductValueSignals(text));
  if (!siblingsHaveTable) return false;
  return extractRowLabels(labelColumnText).length >= 2;
}

export function separateSharedLabelValueTexts(
  labelColumnText: string,
  valueColumnTexts: string[],
): { valueColumnTexts: string[]; droppedIndexes: number[] } {
  const kept: string[] = [];
  const dropped: number[] = [];
  for (let i = 0; i < valueColumnTexts.length; i += 1) {
    const text = valueColumnTexts[i]!;
    if (
      valueColumnTextLooksLikeLabelRail(labelColumnText, text) ||
      looksLikeLeadingLabelBleedColumn(i, valueColumnTexts, labelColumnText)
    ) {
      dropped.push(i);
      continue;
    }
    kept.push(text);
  }
  return { valueColumnTexts: kept, droppedIndexes: dropped };
}
