import { blocksLookLikeSeparateLabels, splitNutritionLabelTexts } from './labelTextBlocks.js';
import { parseMultiProductLabelTable } from './parseMultiProductLabelTable.js';
import { primaryCandidateIndex } from './labelSlotExtract.js';
import { scoreLabelExtraction } from './labelSlots.js';

/** Landscape variety-pack photos: width clearly exceeds height. */
export const WIDE_PANEL_MIN_ASPECT = 1.35;

export type LabelLayoutHint = {
  widePanel: boolean;
  width: number;
  height: number;
  aspectRatio: number;
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

/** Which OCR string to feed import parsers (may differ from primaryCandidateIndex for tables). */
export function pickImportTextCandidateIndex(
  candidates: string[],
  layout: LabelLayoutFromText,
): number {
  if (candidates.length === 0) return 0;
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
