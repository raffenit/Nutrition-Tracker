import type { GroundTruthCompareSummary } from './labelNutrientGroundTruthCompare.js';
import type { ColumnGroundTruthCompare } from './labelNutrientGroundTruthCompare.js';

/** Per-fixture gates for local/test-images (see manifest `nutrientGroundTruthRegression`). */
export type NutrientGroundTruthRegressionSpec = {
  /** shared_rail: minimum columns with calories verdict ok */
  minCalorieColumnsMatch?: number;
  /** single / multi: each field id must have verdict ok on product 0 */
  requireFieldsOk?: string[];
  /** Log + HTML only; never fail the run */
  trackOnly?: boolean;
};

export type NutrientGroundTruthRegressionResult = {
  pass: boolean;
  trackOnly: boolean;
  reasons: string[];
  summary: GroundTruthCompareSummary;
};

function cellByField(columns: ColumnGroundTruthCompare[], field: string): { verdict: string } | null {
  const col = columns[0];
  if (!col) return null;
  return col.cells.find((c) => c.field === field) ?? null;
}

export function evaluateNutrientGroundTruthRegression(input: {
  compare: { columns: ColumnGroundTruthCompare[]; summary: GroundTruthCompareSummary };
  spec: NutrientGroundTruthRegressionSpec;
}): NutrientGroundTruthRegressionResult {
  const { compare, spec } = input;
  const reasons: string[] = [];
  if (spec.trackOnly) {
    return { pass: true, trackOnly: true, reasons, summary: compare.summary };
  }

  if (spec.minCalorieColumnsMatch != null) {
    const need = spec.minCalorieColumnsMatch;
    const got = compare.summary.matchedColumnCount;
    if (got < need) {
      reasons.push(`calorie columns match ${got}/${compare.summary.columnCount} (need >= ${need})`);
    }
  }

  for (const field of spec.requireFieldsOk ?? []) {
    const cell = cellByField(compare.columns, field);
    if (!cell) reasons.push(`missing compare cell for field ${field}`);
    else if (cell.verdict !== 'ok') reasons.push(`field ${field} verdict=${cell.verdict}`);
  }

  return {
    pass: reasons.length === 0,
    trackOnly: false,
    reasons,
    summary: compare.summary,
  };
}

export function groundTruthPercentOk(summary: GroundTruthCompareSummary): number {
  if (!summary.totalCells) return 0;
  return Math.round((100 * summary.ok) / summary.totalCells);
}

export function formatGroundTruthScoreLine(input: {
  imageBasename: string;
  summary: GroundTruthCompareSummary;
  spec?: NutrientGroundTruthRegressionSpec;
  strictResult?: NutrientGroundTruthRegressionResult;
}): string {
  const { imageBasename, summary, spec, strictResult } = input;
  const pct = groundTruthPercentOk(summary);
  let line = `${imageBasename}: ${pct}% ok (${summary.ok}/${summary.totalCells} cells; ${summary.off} off; ${summary.unusable} unusable`;
  if (summary.layout === 'single') {
    line += `; calories ${summary.matchedColumnCount >= 1 ? 'match' : 'miss'}`;
  } else {
    line += `; calorie cols ${summary.matchedColumnCount}/${summary.columnCount}`;
  }
  line += ')';
  if (spec?.trackOnly) {
    line += ' · diagnostic (no pass/fail gate)';
  } else if (strictResult && !strictResult.pass && strictResult.reasons.length > 0) {
    line += ` · below manifest target: ${strictResult.reasons.join('; ')}`;
  }
  return line;
}

/** Strict CI gate — off by default for `ocr:local-test-images` debugging. */
export function formatNutrientGroundTruthRegressionLine(
  imageBasename: string,
  result: NutrientGroundTruthRegressionResult,
): string {
  return formatGroundTruthScoreLine({
    imageBasename,
    summary: result.summary,
    strictResult: result.trackOnly ? undefined : result,
  });
}