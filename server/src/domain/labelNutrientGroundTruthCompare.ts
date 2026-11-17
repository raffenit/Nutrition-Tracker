import { inferLabelLayoutFromText } from './labelLayout.js';
import type { MultiProductColumn } from './parseMultiProductLabelTable.js';
import { parseMultiProductLabelTable } from './parseMultiProductLabelTable.js';
import { parseNutritionLabel } from './parseLabel.js';
import type {
  GroundTruthLessThanSpec,
  LabelGroundTruthLayout,
  LabelProductGroundTruth,
} from './labelNutrientGroundTruth.js';
import type { Nutrients } from '../types.js';
import { applySlotMergedNutrients } from './nutrients.js';
import type { PipelineStageTiming } from './ocrPipelineStages.js';

export type NutrientCompareVerdict = 'ok' | 'off' | 'unusable';

export type NutrientCompareCell = {
  field: string;
  label: string;
  expectedDisplay: string;
  gotDisplay: string;
  verdict: NutrientCompareVerdict;
  expected: number | null;
  got: number | null;
};

export type ColumnGroundTruthCompare = {
  valueColumnIndex: number;
  productName: string;
  cells: NutrientCompareCell[];
  okCount: number;
  offCount: number;
  unusableCount: number;
};

export type GroundTruthCompareSummary = {
  layout: LabelGroundTruthLayout;
  columnCount: number;
  matchedColumnCount: number;
  totalCells: number;
  ok: number;
  off: number;
  unusable: number;
};

export type NutrientRowSpec = {
  field: string;
  label: string;
  unit: string;
  core?: keyof Nutrients;
  extraKey?: string;
};

export const DEFAULT_NUTRIENT_ROW_SPECS: NutrientRowSpec[] = [
  { field: 'calories', label: 'Cal', unit: 'kcal', core: 'calories' },
  { field: 'fat', label: 'Fat', unit: 'g', core: 'fat' },
  { field: 'saturated_fat', label: 'Sat fat', unit: 'g', extraKey: 'saturated_fat' },
  { field: 'trans_fat', label: 'Trans', unit: 'g', extraKey: 'trans_fat' },
  { field: 'cholesterol', label: 'Chol', unit: 'mg', extraKey: 'cholesterol' },
  { field: 'sodium', label: 'Sodium', unit: 'mg', core: 'sodium' },
  { field: 'carbs', label: 'Carb', unit: 'g', core: 'carbs' },
  { field: 'fiber', label: 'Fiber', unit: 'g', core: 'fiber' },
  { field: 'sugar', label: 'Sugars', unit: 'g', extraKey: 'sugar' },
  { field: 'added_sugars', label: 'Added', unit: 'g', extraKey: 'added_sugars' },
  { field: 'protein', label: 'Prot', unit: 'g', core: 'protein' },
];

export type ParsedLabelProduct = {
  name: string;
  nutrients: Nutrients;
};

export function inferNutrientRowSpecs(
  groundTruth: LabelProductGroundTruth[],
  compareFields?: string[],
): NutrientRowSpec[] {
  if (compareFields?.length) {
    const picked = compareFields
      .map((id) => DEFAULT_NUTRIENT_ROW_SPECS.find((r) => r.field === id))
      .filter((r): r is NutrientRowSpec => r != null);
    if (picked.length > 0) return picked;
  }

  const always = new Set(['calories', 'fat', 'sodium', 'carbs', 'protein']);
  const active = new Set<string>(always);

  for (const product of groundTruth) {
    const n = product.nutrients;
    for (const row of DEFAULT_NUTRIENT_ROW_SPECS) {
      if (row.core && (n[row.core] as number) > 0) active.add(row.field);
      if (row.extraKey) {
        const extra = n.extras.find((e) => e.key === row.extraKey);
        if (extra && extra.amount > 0) active.add(row.field);
      }
    }
    for (const lt of product.lessThan ?? []) {
      if (lt.field === 'fiber' || lt.field === 'protein' || lt.field === 'cholesterol') {
        active.add(lt.field === 'cholesterol' ? 'cholesterol' : lt.field);
      }
    }
  }

  return DEFAULT_NUTRIENT_ROW_SPECS.filter((r) => active.has(r.field));
}

export function layoutHintFromOcrText(text: string): LabelGroundTruthLayout {
  const layout = inferLabelLayoutFromText([text]);
  if (layout.kind === 'single') return 'single';
  if (layout.kind === 'multi_column_table' && (layout.multiProductColumnCount ?? 0) > 1) {
    return 'multi_column';
  }
  return 'single';
}

export function resolveParsedProductsFromOcrText(
  text: string,
  layout?: LabelGroundTruthLayout,
  /** Best per-row values from multi-variant OCR (same signal as import draft). */
  slotMergedNutrients?: Nutrients | null,
): ParsedLabelProduct[] | null {
  const kind = layout ?? layoutHintFromOcrText(text);
  if (kind === 'single') {
    const single = parseNutritionLabel(text);
    applySlotMergedNutrients(single.nutrients, slotMergedNutrients);
    if (!single.looksLikeLabel && !single.nutrients.calories) return null;
    return [
      {
        name: 'Nutrition Facts',
        nutrients: single.nutrients,
      },
    ];
  }

  const table = parseMultiProductLabelTable(text);
  if (!table?.length) {
    const fallback = parseNutritionLabel(text);
    applySlotMergedNutrients(fallback.nutrients, slotMergedNutrients);
    if (fallback.looksLikeLabel || fallback.nutrients.calories > 0) {
      return [{ name: 'Nutrition Facts', nutrients: fallback.nutrients }];
    }
    return null;
  }

  return table.map((col: MultiProductColumn) => ({
    name: col.name,
    nutrients: col.nutrients,
  }));
}

function lessThanFor(
  product: LabelProductGroundTruth,
  field: GroundTruthLessThanSpec['field'],
): GroundTruthLessThanSpec | undefined {
  return product.lessThan?.find((lt) => lt.field === field);
}

function formatAmount(value: number, unit: string, lessThan?: GroundTruthLessThanSpec): string {
  if (lessThan && value === 0) return `<${lessThan.amount}${lessThan.unit === 'g' ? 'g' : 'mg'}`;
  if (unit === 'kcal') return String(value);
  return `${value}${unit === 'mg' ? 'mg' : 'g'}`;
}

function readExpected(
  product: LabelProductGroundTruth,
  row: NutrientRowSpec,
): { value: number; display: string; lessThan?: GroundTruthLessThanSpec } {
  const n = product.nutrients;
  if (row.core) {
    const value = n[row.core] as number;
    const lt =
      row.field === 'fiber'
        ? lessThanFor(product, 'fiber')
        : row.field === 'protein'
          ? lessThanFor(product, 'protein')
          : undefined;
    return { value, display: formatAmount(value, row.unit, lt), lessThan: lt };
  }
  if (row.extraKey === 'cholesterol') {
    const lt = lessThanFor(product, 'cholesterol');
    if (lt) return { value: 0, display: formatAmount(0, 'mg', lt), lessThan: lt };
    const extra = n.extras.find((e) => e.key === 'cholesterol');
    const value = extra?.amount ?? 0;
    return { value, display: formatAmount(value, 'mg') };
  }
  const extra = n.extras.find((e) => e.key === row.extraKey);
  const value = extra?.amount ?? 0;
  return { value, display: formatAmount(value, row.unit) };
}

function readGot(col: ParsedLabelProduct | undefined, row: NutrientRowSpec): number | null {
  if (!col) return null;
  const n = col.nutrients;
  if (row.core) {
    const v = n[row.core] as number;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  const extra = n.extras.find((e) => e.key === row.extraKey);
  if (extra && Number.isFinite(extra.amount)) return extra.amount;
  if (row.extraKey === 'cholesterol' || row.extraKey === 'trans_fat') return 0;
  return null;
}

/** Labels print rounded values, so a correct read matches exactly; only decimals get a hair of slack (1.5 vs 1.6). */
function toleranceFor(field: string, unit: string, expected: number): number {
  if (field === 'calories' || unit === 'mg') return 0.5;
  return Number.isInteger(expected) ? 0.05 : 0.15;
}

/** Parsed but wrong (e.g. 15g for 16g), as opposed to unusable (wrong row, garbage). */
function offToleranceFor(expected: number, tol: number): number {
  return Math.max(tol * 2.5, Math.max(expected, 2) * 0.25);
}

export function compareNutrientValues(input: {
  field: string;
  unit: string;
  expected: number;
  got: number | null;
  lessThan?: GroundTruthLessThanSpec;
}): NutrientCompareVerdict {
  const { field, unit, expected, got, lessThan } = input;
  if (got == null || !Number.isFinite(got)) return 'unusable';

  if (lessThan && expected === 0) {
    if (got === 0) return 'ok';
    if (got > 0 && got < lessThan.amount) return 'ok';
    if (got === lessThan.amount) return 'off';
    return 'unusable';
  }

  if (expected === 0 && got === 0) return 'ok';
  if (expected > 0 && got === 0) return 'unusable';

  const tol = toleranceFor(field, unit, expected);
  const delta = Math.abs(got - expected);
  if (delta <= tol) return 'ok';
  if (delta <= offToleranceFor(expected, tol)) return 'off';
  return 'unusable';
}

export function compareLabelProductsToGroundTruth(input: {
  layout: LabelGroundTruthLayout;
  groundTruth: LabelProductGroundTruth[];
  parsed: ParsedLabelProduct[] | null;
  rowSpecs?: NutrientRowSpec[];
}): { columns: ColumnGroundTruthCompare[]; summary: GroundTruthCompareSummary; rowSpecs: NutrientRowSpec[] } {
  const rowSpecs = input.rowSpecs ?? inferNutrientRowSpecs(input.groundTruth);
  const columnCount = input.groundTruth.length;
  const columns: ColumnGroundTruthCompare[] = [];

  let ok = 0;
  let off = 0;
  let unusable = 0;
  let matchedColumnCount = 0;

  for (let i = 0; i < columnCount; i += 1) {
    const gt = input.groundTruth[i]!;
    const gotCol = input.parsed?.[i];
    const cells: NutrientCompareCell[] = [];

    for (const row of rowSpecs) {
      const exp = readExpected(gt, row);
      const gotVal = readGot(gotCol, row);
      const verdict = compareNutrientValues({
        field: row.field,
        unit: row.unit,
        expected: exp.value,
        got: gotVal,
        lessThan: exp.lessThan,
      });
      if (verdict === 'ok') ok += 1;
      else if (verdict === 'off') off += 1;
      else unusable += 1;

      const gotDisplay =
        gotVal == null ? '—' : row.field === 'calories' ? String(gotVal) : formatAmount(gotVal, row.unit);

      cells.push({
        field: row.field,
        label: row.label,
        expectedDisplay: exp.display,
        gotDisplay,
        verdict,
        expected: exp.value,
        got: gotVal,
      });
    }

    if (cells.some((c) => c.field === 'calories' && c.verdict === 'ok')) matchedColumnCount += 1;
    columns.push({
      valueColumnIndex: i,
      productName: gt.productName,
      cells,
      okCount: cells.filter((c) => c.verdict === 'ok').length,
      offCount: cells.filter((c) => c.verdict === 'off').length,
      unusableCount: cells.filter((c) => c.verdict === 'unusable').length,
    });
  }

  return {
    columns,
    rowSpecs,
    summary: {
      layout: input.layout,
      columnCount,
      matchedColumnCount,
      totalCells: columnCount * rowSpecs.length,
      ok,
      off,
      unusable,
    },
  };
}

/** @deprecated Use {@link compareLabelProductsToGroundTruth}. */
export function compareParsedColumnsToGroundTruth(
  groundTruth: LabelProductGroundTruth[],
  parsed: MultiProductColumn[] | null,
  layout: LabelGroundTruthLayout = 'shared_rail',
) {
  const products =
    parsed?.map((col) => ({ name: col.name, nutrients: col.nutrients })) ?? null;
  return compareLabelProductsToGroundTruth({ layout, groundTruth, parsed: products });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function verdictClass(verdict: NutrientCompareVerdict): string {
  if (verdict === 'ok') return 'cell-ok';
  if (verdict === 'off') return 'cell-off';
  return 'cell-bad';
}

function layoutColumnCaption(layout: LabelGroundTruthLayout): string {
  if (layout === 'single') return 'Single Nutrition Facts panel (one product column).';
  if (layout === 'multi_column') return 'Columns are 0-based product columns left → right (multi-column table).';
  return 'Columns are 0-based value strips left → right (shared-label variety pack).';
}

/** Browser + CLI title for nutrient compare HTML reports. */
export function ocrPerformanceReportTitle(sourceImage: string): string {
  return `OCR Performance Report — ${sourceImage}`;
}

export function formatOcrRuntimeSeconds(seconds: number | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  return `${seconds.toFixed(1)}s`;
}

export function renderGroundTruthCompareHtml(input: {
  title: string;
  sourceImage: string;
  dataSourceNote: string;
  compare: ReturnType<typeof compareLabelProductsToGroundTruth>;
  /** Wall time for extractImageLabel (or full diagnostic run) when available. */
  runtimeSeconds?: number;
  generatedAtIso?: string;
  pipelineStages?: PipelineStageTiming[];
}): string {
  const { title, sourceImage, dataSourceNote, compare, runtimeSeconds, generatedAtIso, pipelineStages } = input;
  const rowLabels = compare.rowSpecs.map((r) => r.label);
  const headerCells = compare.columns
    .map((col) => {
      const idx =
        compare.summary.layout === 'single'
          ? ''
          : `<span class="col-idx">${col.valueColumnIndex}</span><br/>`;
      const shortName = col.productName.replace(/®/g, '').slice(0, 14);
      return `<th title="${escapeHtml(col.productName)}">${idx}${escapeHtml(shortName)}${col.productName.length > 14 ? '…' : ''}</th>`;
    })
    .join('');

  const bodyRows = rowLabels
    .map((rowLabel, rowIdx) => {
      const cells = compare.columns
        .map((col) => {
          const cell = col.cells[rowIdx]!;
          return `<td class="${verdictClass(cell.verdict)}" title="expected ${escapeHtml(cell.expectedDisplay)}"><span class="exp">${escapeHtml(cell.expectedDisplay)}</span><span class="got">${escapeHtml(cell.gotDisplay)}</span></td>`;
        })
        .join('');
      return `<tr><th scope="row">${escapeHtml(rowLabel)}</th>${cells}</tr>`;
    })
    .join('\n');

  const { summary } = compare;
  const pctOk = summary.totalCells ? Math.round((100 * summary.ok) / summary.totalCells) : 0;
  const calLine =
    summary.layout === 'single'
      ? `Calories match: <strong>${summary.matchedColumnCount >= 1 ? 'yes' : 'no'}</strong>`
      : `Calories match on <strong>${summary.matchedColumnCount}</strong> / ${summary.columnCount} columns`;

  const runtimeLabel = formatOcrRuntimeSeconds(runtimeSeconds);
  const runtimeMeta = runtimeLabel ? `Runtime: <strong>${runtimeLabel}</strong>` : '';
  const generatedMeta = generatedAtIso ? `Generated: <code>${escapeHtml(generatedAtIso)}</code>` : '';
  const perfMeta = [runtimeMeta, generatedMeta].filter(Boolean).join(' · ');
  const stageRows =
    pipelineStages && pipelineStages.length > 0
      ? pipelineStages
          .filter((s) => s.id !== 'total')
          .map(
            (s) =>
              `<tr><th scope="row">${escapeHtml(s.label)}</th><td>${escapeHtml((s.durationMs / 1000).toFixed(2))}s</td><td>${escapeHtml(s.detail ?? '—')}</td></tr>`,
          )
          .join('\n')
      : '';
  const stagesSection = stageRows
    ? `<h2 class="stages-title">Pipeline stages</h2>
  <table class="stages-table">
    <thead><tr><th scope="col">Stage</th><th scope="col">Time</th><th scope="col">Detail</th></tr></thead>
    <tbody>${stageRows}</tbody>
  </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #121212;
      --text: #e8e8e8;
      --muted: #a8a8a8;
      --panel: #1e1e1e;
      --border: #404040;
      --ok: #2e7d32;
      --ok-fg: #c8e6c9;
      --off: #f9a825;
      --off-fg: #fff8e1;
      --bad: #c62828;
      --bad-fg: #ffcdd2;
    }
    body { font-family: system-ui, sans-serif; margin: 1.25rem; line-height: 1.35; color: var(--text); background: var(--bg); }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    code { background: var(--panel); padding: 0.1rem 0.35rem; border-radius: 3px; }
    .meta { font-size: 0.9rem; color: var(--muted); margin-bottom: 1rem; }
    .legend { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem; font-size: 0.85rem; }
    .swatch { display: inline-block; width: 1rem; height: 1rem; border: 1px solid var(--border); vertical-align: middle; margin-right: 0.25rem; border-radius: 2px; }
    .swatch.ok { background: var(--ok); }
    .swatch.off { background: var(--off); }
    .swatch.bad { background: var(--bad); }
    table { border-collapse: collapse; width: 100%; max-width: 100%; font-size: 0.8rem; }
    th, td { border: 1px solid var(--border); padding: 0.35rem 0.4rem; text-align: center; vertical-align: middle; }
    th { background: var(--panel); font-weight: 600; }
    th[scope="row"] { text-align: left; white-space: nowrap; }
    .col-idx { font-weight: 400; color: var(--muted); font-size: 0.75rem; }
    td .exp { display: block; color: var(--muted); font-size: 0.72rem; }
    td .got { display: block; font-weight: 600; font-size: 0.85rem; }
    .cell-ok { background: var(--ok); color: var(--ok-fg); }
    .cell-off { background: var(--off); color: #1a1a1a; }
    .cell-bad { background: var(--bad); color: var(--bad-fg); }
    .summary { margin-top: 1rem; font-size: 0.9rem; }
    .stages-title { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
    .stages-table { max-width: 36rem; font-size: 0.85rem; }
    .stages-table th[scope="row"] { font-weight: 500; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Image: <code>${escapeHtml(sourceImage)}</code> · layout <code>${escapeHtml(summary.layout)}</code> · ${escapeHtml(dataSourceNote)}</p>
  ${perfMeta ? `<p class="meta">${perfMeta}</p>` : ''}
  ${stagesSection}
  <div class="legend">
    <span><span class="swatch ok"></span>Match (within tolerance)</span>
    <span><span class="swatch off"></span>Off (parsed, wrong)</span>
    <span><span class="swatch bad"></span>Unusable (missing / zero / wrong row)</span>
  </div>
  <p class="meta">Each cell: <em>ground truth</em> (gray) over <strong>OCR parse</strong>. ${layoutColumnCaption(summary.layout)}</p>
  <table>
    <thead>
      <tr><th scope="col">Nutrient</th>${headerCells}</tr>
    </thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
  <p class="summary">
    Cells: <strong>${summary.ok}</strong> ok, <strong>${summary.off}</strong> off, <strong>${summary.unusable}</strong> unusable
    (${pctOk}% ok) · ${calLine}
  </p>
</body>
</html>`;
}