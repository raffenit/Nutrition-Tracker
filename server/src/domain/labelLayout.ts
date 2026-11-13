import { blocksLookLikeSeparateLabels, splitNutritionLabelTexts } from './labelTextBlocks.js';
import { parseMultiProductLabelTable } from './parseMultiProductLabelTable.js';
import { primaryCandidateIndex } from './labelSlotExtract.js';
import { scoreLabelExtraction } from './labelSlots.js';

/** Landscape variety-pack photos (multi-product tables): width clearly exceeds height. */
export const WIDE_PANEL_MIN_ASPECT = 1.35;

export type LabelLayoutHint = {
  widePanel: boolean;
  width: number;
  height: number;
  aspectRatio: number;
  /** Share of frame width that is sharply in focus (depth-of-field). */
  sharpFocusWidthFraction: number;
  /** Depth-of-field suggests one intentional label (incidental blur at sides). */
  singleSubjectInFocus: boolean;
  /** Sharp peaks on the horizontal focus profile (high → multi-column table in focus). */
  sharpPeakCount: number;
  focusRegion: { left: number; top: number; width: number; height: number } | null;
};

export type LabelLayoutKind = 'single' | 'repeated_nutrition_facts' | 'multi_column_table';

export type LabelLayoutFromText = {
  kind: LabelLayoutKind;
  bestCandidateIndex: number;
  multiProductColumnCount: number;
  nutritionFactsCount: number;
};

export type OcrLayoutProfile = 'default' | 'wideTable' | 'wideTableRetry';

export function initialOcrLayoutProfile(hint: LabelLayoutHint): OcrLayoutProfile {
  return hint.widePanel ? 'wideTable' : 'default';
}

export function shouldRetryWideTableOcr(hint: LabelLayoutHint, layout: LabelLayoutFromText): boolean {
  if (!hint.widePanel) return false;
  if (layout.kind === 'multi_column_table' && layout.multiProductColumnCount >= 2) return false;
  return true;
}

/** Part B — per-column OCR when full-page text did not parse as a multi-product table. */
export function shouldRunColumnStripOcr(hint: LabelLayoutHint, layout: LabelLayoutFromText): boolean {
  if (!hint.widePanel) return false;
  if (layout.kind === 'multi_column_table' && layout.multiProductColumnCount >= 2) return false;
  if (layout.kind === 'repeated_nutrition_facts') return false;
  return layout.nutritionFactsCount >= 1;
}

export function inferLabelLayoutFromText(candidates: string[]): LabelLayoutFromText {
  const scored = candidates.map((text, index) => scoreTextLayout(text, index));
  let best = scored[0] ?? emptyLayoutScore(0);
  for (const entry of scored) {
    if (layoutScoreRank(entry) > layoutScoreRank(best)) best = entry;
  }

  const maxNf = scored.reduce((max, entry) => Math.max(max, entry.nfCount), 0);
  const hasRepeatedPanels = candidates.some((text) =>
    blocksLookLikeSeparateLabels(splitNutritionLabelTexts(text)),
  );

  const kind: LabelLayoutKind =
    best.tableColumns >= 2
      ? 'multi_column_table'
      : maxNf >= 2 && hasRepeatedPanels
        ? 'repeated_nutrition_facts'
        : 'single';

  return {
    kind,
    bestCandidateIndex: best.index,
    multiProductColumnCount: best.tableColumns,
    nutritionFactsCount: best.nfCount,
  };
}

export type PickImportTextOptions = {
  /** Geometry column count — prefer structured/stitched OCR over noisy full-page text. */
  varietyPackExpectedColumns?: number;
  /** Index of variety-pack stitched table in `candidates` (if known). */
  structuredTableCandidateIndex?: number;
};

/** Which OCR string to feed import parsers (may differ from primaryCandidateIndex for tables). */
export function pickImportTextCandidateIndex(
  candidates: string[],
  layout: LabelLayoutFromText,
  options?: PickImportTextOptions,
): number {
  if (candidates.length === 0) return 0;

  const expectedCols = options?.varietyPackExpectedColumns ?? 0;
  if (expectedCols >= 2) {
    if (
      options?.structuredTableCandidateIndex != null &&
      options.structuredTableCandidateIndex >= 0 &&
      options.structuredTableCandidateIndex < candidates.length
    ) {
      return options.structuredTableCandidateIndex;
    }
    let bestIdx = -1;
    let bestCols = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      const cols = parseMultiProductLabelTable(candidates[i]!)?.length ?? 0;
      if (cols > bestCols) {
        bestCols = cols;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestCols >= 1) return bestIdx;
    const structuredIdx = candidates.findIndex((text) => looksLikeStructuredVarietyTable(text));
    if (structuredIdx >= 0) return structuredIdx;
  }

  if (layout.kind === 'multi_column_table' && layout.multiProductColumnCount >= 2) {
    return layout.bestCandidateIndex;
  }
  if (layout.kind === 'repeated_nutrition_facts') {
    return pickMostNutritionFactsCandidate(candidates);
  }
  if (layout.nutritionFactsCount >= 1) {
    const wideTableish = candidates.findIndex((text) => looksLikeWideTableOcr(text));
    if (wideTableish >= 0) return wideTableish;
  }
  return primaryCandidateIndex(candidates);
}

/** Stitched shared-rail table or wide columnar OCR — not a scored single panel. */
export function looksLikeStructuredVarietyTable(text: string): boolean {
  if (!/nutrition\s+facts/i.test(text)) return false;
  if (looksLikeWideTableOcr(text)) return true;
  const lines = text.replace(/\r/g, '\n').split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const nutrientRows = lines.filter((line) =>
    /^(calories|total fat|saturated|trans fat|cholesterol|sodium|total carb|dietary fiber|protein)\b/i.test(line),
  );
  if (nutrientRows.length >= 2) return true;
  if (/\bcolumn\s+\d+/i.test(text) && nutrientRows.length >= 1) return true;
  return false;
}

type LayoutScore = {
  index: number;
  tableColumns: number;
  nfCount: number;
  labelScore: number;
  length: number;
};

function scoreTextLayout(text: string, index: number): LayoutScore {
  const table = parseMultiProductLabelTable(text);
  const tableColumns = table?.length ?? 0;
  const nfCount = countNutritionFactsHeadings(text);
  return {
    index,
    tableColumns,
    nfCount,
    labelScore: scoreLabelExtraction(text),
    length: text.trim().length,
  };
}

function emptyLayoutScore(index: number): LayoutScore {
  return { index, tableColumns: 0, nfCount: 0, labelScore: 0, length: 0 };
}

function layoutScoreRank(entry: LayoutScore): number {
  return entry.tableColumns * 1_000_000 + entry.nfCount * 10_000 + entry.labelScore * 100 + entry.length;
}

function countNutritionFactsHeadings(text: string): number {
  return (text.match(/nutrition\s+facts/gi) ?? []).length;
}

function pickMostNutritionFactsCandidate(candidates: string[]): number {
  let bestIdx = 0;
  let bestNf = -1;
  let bestLen = -1;
  candidates.forEach((text, idx) => {
    const nf = countNutritionFactsHeadings(text);
    const len = text.trim().length;
    if (nf > bestNf || (nf === bestNf && len > bestLen)) {
      bestNf = nf;
      bestLen = len;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

/** OCR residue for variety-pack tables without a successful Part A parse. */
function looksLikeWideTableOcr(text: string): boolean {
  if (!/nutrition\s+facts/i.test(text)) return false;
  if (/\|.+\|/.test(text)) return true;
  if (/^calories\b.+\d+\s+\d+/im.test(text)) return true;
  if (/\bcalories\b[^\n]{0,32}\d+(?:\s+\d+){2,}/i.test(text)) return true;
  return false;
}

export function variantCapBoost(profile: OcrLayoutProfile): { tess: number; easy: number } {
  if (profile === 'wideTableRetry') return { tess: 4, easy: 2 };
  if (profile === 'wideTable') return { tess: 2, easy: 1 };
  return { tess: 0, easy: 0 };
}
