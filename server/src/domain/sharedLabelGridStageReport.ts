import { parseMultiProductLabelTable } from './parseMultiProductLabelTable.js';
import type { SharedLabelStitchAnalyzeOptions } from './sharedLabelStitchContract.js';
import {
  diagnoseSharedLabelGridStitch,
  extractRowLabels,
  extractValueLines,
  stitchSharedLabelGridTexts,
  type SharedLabelGridStitchFailure,
} from './stitchSharedLabelGridTexts.js';

function isLabelRailValueColumn(index: number, options?: SharedLabelStitchAnalyzeOptions): boolean {
  return options?.labelRailValueColumnIndex != null && index === options.labelRailValueColumnIndex;
}

/** Stages in the same order as {@link extractText} shared-rail import. */
export type SharedLabelGridStage =
  | 'label_column_extraction'
  | 'value_column_extraction'
  | 'stitch'
  | 'parse_macros';

export type SharedLabelGridStageBlocker =
  | { stage: 'label_column_extraction'; reason: 'no_row_labels'; rowLabelCount: number }
  | {
      stage: 'value_column_extraction';
      reason: 'column_has_zero_value_lines';
      columnIndex: number;
      valueLineCounts: number[];
    }
  | {
      stage: 'value_column_extraction';
      reason: 'value_lines_before_nutrient_table';
      columnIndex: number;
      leadingNonValueLineCount: number;
    }
  | {
      stage: 'stitch';
      reason: SharedLabelGridStitchFailure;
      stitchDiag: ReturnType<typeof diagnoseSharedLabelGridStitch>;
    }
  | {
      stage: 'parse_macros';
      reason: 'no_columns_with_macros';
      parsedColumnCount: number;
      caloriesRowNumericColumnCount: number;
    }
  | {
      stage: 'parse_macros';
      reason: 'calories_row_cells_not_numeric';
      caloriesRowCells: string[];
      caloriesRowNumericColumnCount: number;
    };

export type SharedLabelGridStageReport = {
  rowLabels: string[];
  valueLineCounts: number[];
  valueLinesByColumn: string[][];
  stitchDiag: ReturnType<typeof diagnoseSharedLabelGridStitch>;
  stitched: string | null;
  parsedColumnCount: number;
  macroColumnCount: number;
  calorieColumnCount: number;
  /** First blocker that prevents usable calorie import (not geometry / raw OCR). */
  macroImportBlocker: SharedLabelGridStageBlocker | null;
};

export function countSharedLabelMacroColumns(
  parsed: ReturnType<typeof parseMultiProductLabelTable>,
): number {
  if (!parsed) return 0;
  return parsed.filter(
    (col) => col.nutrients.calories > 0 || col.nutrients.protein > 0 || col.nutrients.fat > 0,
  ).length;
}

export function countSharedLabelCalorieColumns(
  parsed: ReturnType<typeof parseMultiProductLabelTable>,
): number {
  if (!parsed) return 0;
  return parsed.filter((col) => col.nutrients.calories > 0).length;
}

const SERVING_OR_PRODUCT =
  /\b(?:serving|pack|bar|piece|pieces|varies|oz\)|g\)|candies|chocolate)\b/i;

export function looksLikePlausibleCalorieCell(cell: string): boolean {
  const t = cell.trim();
  if (!t) return false;
  if (SERVING_OR_PRODUCT.test(t)) return false;
  if (/%/.test(t)) return false;
  if (/\b(?:g|mg|mcg)\b/i.test(t)) return false;
  if (/^varies$/i.test(t)) return true;
  return /^\d{2,4}\b/.test(t) || /^\d+\s*kcal/i.test(t);
}

export function caloriesRowCellsFromStitched(stitched: string): string[] | null {
  const lines = stitched.replace(/\r/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const calIdx = lines.findIndex((l) => /^calories\b/i.test(l));
  if (calIdx < 0 || calIdx + 1 >= lines.length) return null;
  const valueLine = lines[calIdx + 1]!;
  if (!/\d/.test(valueLine) && !/varies/i.test(valueLine)) return [];
  return splitWideTableCells(valueLine);
}

function splitWideTableCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  const byGap = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (byGap.length >= 2) return byGap;
  return byGap;
}

function countLeadingPreambleLines(columnText: string): number {
  let count = 0;
  let inTable = false;
  for (const raw of columnText.replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/%\s*daily\s*value/i.test(line) || /amount\s+per\s+serving/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) {
      if (/\d/.test(line) && /(?:g|mg|%)\b/.test(line)) inTable = true;
      else count += 1;
    } else break;
  }
  return count;
}

export function analyzeSharedLabelGridStageReport(
  labelColumnText: string,
  valueColumnTexts: string[],
  headerBandText?: string,
  options?: SharedLabelStitchAnalyzeOptions,
): SharedLabelGridStageReport {
  const rowLabels = extractRowLabels(labelColumnText);
  const valueLinesByColumn = valueColumnTexts.map((text) => extractValueLines(text));
  const valueLineCounts = valueLinesByColumn.map((lines) => lines.length);
  const stitchDiag = diagnoseSharedLabelGridStitch(labelColumnText, valueColumnTexts, headerBandText);
  const stitched = stitchSharedLabelGridTexts(labelColumnText, valueColumnTexts, headerBandText);
  const parsed = stitched ? parseMultiProductLabelTable(stitched) : null;
  const macroColumnCount = countSharedLabelMacroColumns(parsed);
  const calorieColumnCount = countSharedLabelCalorieColumns(parsed);
  const parsedColumnCount = parsed?.length ?? 0;

  const macroImportBlocker = pickMacroImportBlocker({
    rowLabels,
    valueLineCounts,
    valueColumnTexts,
    stitchDiag,
    stitched,
    parsedColumnCount,
    macroColumnCount,
    calorieColumnCount,
    options,
  });

  return {
    rowLabels,
    valueLineCounts,
    valueLinesByColumn,
    stitchDiag,
    stitched,
    parsedColumnCount,
    macroColumnCount,
    calorieColumnCount,
    macroImportBlocker,
  };
}

function pickMacroImportBlocker(input: {
  rowLabels: string[];
  valueLineCounts: number[];
  valueColumnTexts: string[];
  stitchDiag: ReturnType<typeof diagnoseSharedLabelGridStitch>;
  stitched: string | null;
  parsedColumnCount: number;
  macroColumnCount: number;
  calorieColumnCount: number;
  options?: SharedLabelStitchAnalyzeOptions;
}): SharedLabelGridStageBlocker | null {
  if (input.rowLabels.length === 0) {
    return { stage: 'label_column_extraction', reason: 'no_row_labels', rowLabelCount: 0 };
  }

  if (!input.stitchDiag.ok) {
    return {
      stage: 'stitch',
      reason: input.stitchDiag.failure ?? 'missing_calories_in_output',
      stitchDiag: input.stitchDiag,
    };
  }

  if (!input.stitched) {
    return {
      stage: 'stitch',
      reason: 'missing_calories_in_output',
      stitchDiag: input.stitchDiag,
    };
  }

  const caloriesCells = caloriesRowCellsFromStitched(input.stitched) ?? [];
  const caloriesNumeric = caloriesCells.filter((c) => looksLikePlausibleCalorieCell(c)).length;
  if (caloriesCells.length >= 2 && caloriesNumeric < 2) {
    return {
      stage: 'parse_macros',
      reason: 'calories_row_cells_not_numeric',
      caloriesRowCells: caloriesCells,
      caloriesRowNumericColumnCount: caloriesNumeric,
    };
  }

  if (input.calorieColumnCount < 1) {
    return {
      stage: 'parse_macros',
      reason: 'no_columns_with_macros',
      parsedColumnCount: input.parsedColumnCount,
      caloriesRowNumericColumnCount: caloriesNumeric,
    };
  }

  const zeroCol = input.valueLineCounts.findIndex(
    (n, index) => n === 0 && !isLabelRailValueColumn(index, input.options),
  );
  if (zeroCol >= 0) {
    return {
      stage: 'value_column_extraction',
      reason: 'column_has_zero_value_lines',
      columnIndex: zeroCol,
      valueLineCounts: input.valueLineCounts,
    };
  }

  return null;
}

/** All structural issues observed (for diagnostics; not ordered by severity). */
export function listSharedLabelGridStageIssues(
  labelColumnText: string,
  valueColumnTexts: string[],
  headerBandText?: string,
  options?: SharedLabelStitchAnalyzeOptions,
): SharedLabelGridStageBlocker[] {
  const report = analyzeSharedLabelGridStageReport(labelColumnText, valueColumnTexts, headerBandText, options);
  const issues: SharedLabelGridStageBlocker[] = [];
  if (report.rowLabels.length === 0) {
    issues.push({ stage: 'label_column_extraction', reason: 'no_row_labels', rowLabelCount: 0 });
  }
  for (let i = 0; i < report.valueLineCounts.length; i += 1) {
    if (report.valueLineCounts[i] === 0 && !isLabelRailValueColumn(i, options)) {
      issues.push({
        stage: 'value_column_extraction',
        reason: 'column_has_zero_value_lines',
        columnIndex: i,
        valueLineCounts: report.valueLineCounts,
      });
    }
    const preamble = countLeadingPreambleLines(valueColumnTexts[i]!);
    const lines = report.valueLineCounts[i] ?? 0;
    if (preamble > 0 && lines > 0) {
      issues.push({
        stage: 'value_column_extraction',
        reason: 'value_lines_before_nutrient_table',
        columnIndex: i,
        leadingNonValueLineCount: preamble,
      });
    }
  }
  if (!report.stitchDiag.ok) {
    issues.push({
      stage: 'stitch',
      reason: report.stitchDiag.failure ?? 'missing_calories_in_output',
      stitchDiag: report.stitchDiag,
    });
  }
  if (report.macroColumnCount < 1 && report.stitched) {
    const cells = caloriesRowCellsFromStitched(report.stitched) ?? [];
    const numeric = cells.filter((c) => looksLikePlausibleCalorieCell(c)).length;
    if (cells.length > 0 && numeric < 2) {
      issues.push({
        stage: 'parse_macros',
        reason: 'calories_row_cells_not_numeric',
        caloriesRowCells: cells,
        caloriesRowNumericColumnCount: numeric,
      });
    } else {
      issues.push({
        stage: 'parse_macros',
        reason: 'no_columns_with_macros',
        parsedColumnCount: report.parsedColumnCount,
        caloriesRowNumericColumnCount: numeric,
      });
    }
  }
  return issues;
}

export type SharedLabelRowBandRetryReason =
  | 'no_macro_columns'
  | 'calories_row_cells_not_numeric'
  | 'no_columns_with_calories';

export type SharedLabelRowBandOcrRetryAssessment = {
  shouldRetryBodyColumn: boolean;
  reason: SharedLabelRowBandRetryReason | null;
  caloriesNumericColumnCount: number;
};

/**
 * Whether row-band OCR output is safe to keep, or body-column OCR should be retried.
 * Uses stitched table quality (calories row), not {@link countSharedLabelMacroColumns} alone —
 * junk fat/calorie digits from misaligned bands must not block fallback.
 */
export function assessSharedLabelRowBandOcrRetry(
  stitched: string | null,
  parsed: ReturnType<typeof parseMultiProductLabelTable>,
): SharedLabelRowBandOcrRetryAssessment {
  const macroColumnCount = countSharedLabelMacroColumns(parsed);
  const calorieColumnCount = countSharedLabelCalorieColumns(parsed);
  const parsedColumnCount = parsed?.length ?? 0;
  const caloriesCells = stitched ? (caloriesRowCellsFromStitched(stitched) ?? []) : [];
  const caloriesNumeric = caloriesCells.filter((c) => looksLikePlausibleCalorieCell(c)).length;

  if (macroColumnCount < 1) {
    return {
      shouldRetryBodyColumn: true,
      reason: 'no_macro_columns',
      caloriesNumericColumnCount: caloriesNumeric,
    };
  }

  if (stitched && caloriesCells.length >= 2 && caloriesNumeric < 2) {
    return {
      shouldRetryBodyColumn: true,
      reason: 'calories_row_cells_not_numeric',
      caloriesNumericColumnCount: caloriesNumeric,
    };
  }

  if (parsedColumnCount >= 2 && calorieColumnCount < 1 && caloriesNumeric < 2) {
    return {
      shouldRetryBodyColumn: true,
      reason: 'no_columns_with_calories',
      caloriesNumericColumnCount: caloriesNumeric,
    };
  }

  return { shouldRetryBodyColumn: false, reason: null, caloriesNumericColumnCount: caloriesNumeric };
}
