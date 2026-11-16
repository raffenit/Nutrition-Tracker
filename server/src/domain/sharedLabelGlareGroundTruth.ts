import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ColumnBodyGlareMask } from '../integrations/bandLuminanceCluster.js';
import type { SharedLabelRowBandSlice } from './sharedLabelGridLayout.js';
import {
  dailyValueRowSliceTopYForValueColumns,
} from './sharedLabelRowRegions.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from './sharedLabelGridParams.js';
import type {
  GroundTruthLessThanSpec,
  LabelProductGroundTruth,
} from './labelNutrientGroundTruth.js';

export type { GroundTruthLessThanSpec };

/** Fraction of analysis width (see {@link DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceGlareGroundTruthBandOverlapMinFraction}). */
export type GlareGroundTruthBandOverlapParams = {
  minBandOverlapFraction: number;
};

export type GlareGroundTruthRowRef =
  | { zone: 'header'; headerRowIndex: number; description?: string }
  | { zone: 'body'; bodyRowIndex: number; description?: string }
  | { zone: 'body'; bodyRowIndexFrom: number; bodyRowIndexTo: number; description?: string }
  | {
      zone: 'body';
      rowRole: 'calories' | 'daily_value';
      coverage?: 'full' | 'partial';
      description?: string;
    };

export type GlareGroundTruthColumnSpec = {
  valueColumnIndex: number;
  glare: GlareGroundTruthRowRef[];
};

/** @deprecated Use {@link LabelProductGroundTruth}. */
export type VarietyPackProductGroundTruth = LabelProductGroundTruth;

export type GlareGroundTruthFile = {
  sourceImage: string;
  valueColumnIndexBase?: number;
  valueColumnCount?: number;
  /** Per-product Calories (kcal) on the ruled body row, 0-based value column index. */
  caloriesKcalPerValueColumn?: number[];
  /** Full per-column Nutrition Facts (0-based value column, left → right on label). */
  productsPerValueColumn?: VarietyPackProductGroundTruth[];
  notes?: string;
  columns: GlareGroundTruthColumnSpec[];
};

export type GlareGroundTruthRowMesh = 'consensus' | 'per_column';

export type GlareGroundTruthRowTarget = {
  valueColumnIndex: number;
  zone: 'header' | 'body';
  rowIndex: number;
  /** Body row bands from fixture index refs track the shared mesh; preamble rowRole refs use per-column slices. */
  rowMesh?: GlareGroundTruthRowMesh;
  /** When set, only the top fraction of the row band counts (e.g. specular spill into % DV). */
  highlightTopFraction?: number;
  description?: string;
};

export type GlareGroundTruthYSpanAnalysis = {
  y0: number;
  y1: number;
  minOverlapFraction: number;
};

export function valueColumnIndexForAnalysisSegment(
  segment: { x0: number; x1: number } | undefined,
  step3ValueColumns: Array<{ x0: number; x1: number }>,
): number | null {
  if (!segment || !step3ValueColumns.length) return null;
  let bestIndex = 0;
  let bestOverlap = -1;
  for (let i = 0; i < step3ValueColumns.length; i += 1) {
    const s = step3ValueColumns[i]!;
    const overlap = Math.min(segment.x1, s.x1) - Math.max(segment.x0, s.x0);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIndex = i;
    }
  }
  return bestOverlap > 0 ? bestIndex : null;
}

export async function loadGlareGroundTruthForImage(
  imageBasename: string,
  fixturesDir: string,
): Promise<GlareGroundTruthFile | null> {
  let names: string[];
  try {
    names = await readdir(fixturesDir);
  } catch {
    return null;
  }
  const suffix = 'GlareGroundTruth.json';
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const raw = await readFile(path.join(fixturesDir, name), 'utf8');
    const parsed = JSON.parse(raw) as GlareGroundTruthFile;
    if (parsed.sourceImage === imageBasename) return parsed;
  }
  return null;
}

function bodyRowIndexForRole(
  role: 'calories' | 'daily_value',
  bodySlices: SharedLabelRowBandSlice[],
  bodyTopImage: number,
  dailyValueTopImage: number | undefined,
): number | undefined {
  if (bodySlices.length === 0) return undefined;
  if (role === 'calories') {
    const match = bodySlices.find((s) => Math.abs(s.top - bodyTopImage) <= 4);
    return match?.rowIndex ?? bodySlices[0]!.rowIndex;
  }
  if (dailyValueTopImage !== undefined) {
    const match = bodySlices.find((s) => Math.abs(s.top - dailyValueTopImage) <= 5);
    if (match) return match.rowIndex;
  }
  const sorted = [...bodySlices].sort((a, b) => a.top - b.top);
  return sorted[1]?.rowIndex ?? sorted[0]!.rowIndex;
}

function dailyValueTopImageForPlan(
  bodyTopImage: number,
  firstInteriorRuleYImage: number,
  rowPitchPx: number,
  valueRulesImagePerColumn: number[][],
): number | undefined {
  return dailyValueRowSliceTopYForValueColumns(
    bodyTopImage,
    firstInteriorRuleYImage,
    rowPitchPx,
    valueRulesImagePerColumn,
  );
}

/** Expand fixture row refs into per-column row targets using the current plan slices (no column-specific literals). */
export function resolveGlareGroundTruthRowTargets(input: {
  groundTruth: GlareGroundTruthFile;
  step3ValueColumns: Array<{ x0: number; x1: number }>;
  planStripColumnIndex: number;
  valueColumnIndex: number;
  headerSlices: SharedLabelRowBandSlice[];
  bodySlices: SharedLabelRowBandSlice[];
  bodyTopImage: number;
  firstInteriorRuleYImage: number;
  rowPitchPx: number;
  valueRulesImagePerColumn: number[][];
}): GlareGroundTruthRowTarget[] {
  const colSpec = input.groundTruth.columns.find((c) => c.valueColumnIndex === input.valueColumnIndex);
  if (!colSpec) return [];

  const partialFraction = DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceGlareGroundTruthPartialBandFraction;
  const dvTop = dailyValueTopImageForPlan(
    input.bodyTopImage,
    input.firstInteriorRuleYImage,
    input.rowPitchPx,
    input.valueRulesImagePerColumn,
  );

  const out: GlareGroundTruthRowTarget[] = [];
  for (const ref of colSpec.glare) {
    if (ref.zone === 'header' && 'headerRowIndex' in ref) {
      out.push({
        valueColumnIndex: input.valueColumnIndex,
        zone: 'header',
        rowIndex: ref.headerRowIndex,
        rowMesh: 'per_column',
        description: ref.description,
      });
      continue;
    }
    if (ref.zone === 'body' && 'bodyRowIndex' in ref && ref.bodyRowIndex !== undefined) {
      out.push({
        valueColumnIndex: input.valueColumnIndex,
        zone: 'body',
        rowIndex: ref.bodyRowIndex,
        rowMesh: 'per_column',
        description: ref.description,
      });
      continue;
    }
    if (ref.zone === 'body' && 'bodyRowIndexFrom' in ref && ref.bodyRowIndexFrom !== undefined) {
      const from = ref.bodyRowIndexFrom;
      const to = ref.bodyRowIndexTo ?? from;
      for (let rowIndex = from; rowIndex <= to; rowIndex += 1) {
        out.push({
          valueColumnIndex: input.valueColumnIndex,
          zone: 'body',
          rowIndex,
          rowMesh: 'per_column',
          description: ref.description,
        });
      }
      continue;
    }
    if (ref.zone === 'body' && 'rowRole' in ref) {
      const rowIndex = bodyRowIndexForRole(ref.rowRole, input.bodySlices, input.bodyTopImage, dvTop);
      if (rowIndex === undefined) continue;
      const coverage = ref.coverage ?? 'full';
      out.push({
        valueColumnIndex: input.valueColumnIndex,
        zone: 'body',
        rowIndex,
        rowMesh: 'per_column',
        highlightTopFraction: coverage === 'partial' ? partialFraction : undefined,
        description: ref.description,
      });
    }
  }
  return out;
}

export function rowBandSliceForGlareGroundTruthTarget(
  target: GlareGroundTruthRowTarget,
  consensusBodySlices: SharedLabelRowBandSlice[],
  perColumnBodySlices: SharedLabelRowBandSlice[],
  perColumnHeaderSlices: SharedLabelRowBandSlice[],
): SharedLabelRowBandSlice | undefined {
  if (target.zone === 'header') {
    return perColumnHeaderSlices.find((s) => s.rowIndex === target.rowIndex);
  }
  const mesh = target.rowMesh ?? 'consensus';
  const pool = mesh === 'consensus' ? consensusBodySlices : perColumnBodySlices;
  return pool.find((s) => s.rowIndex === target.rowIndex);
}

function analysisYToMaskBandIndex(
  yAnalysis: number,
  bodyTopAnalysis: number,
  bodyBottomAnalysis: number,
  bandCount: number,
): number {
  const span = Math.max(1, bodyBottomAnalysis - bodyTopAnalysis);
  const y = Math.max(bodyTopAnalysis, Math.min(bodyBottomAnalysis, yAnalysis));
  const t = (y - bodyTopAnalysis) / span;
  return Math.min(bandCount - 1, Math.max(0, Math.floor(t * bandCount)));
}

/** Map row targets on a column to analysis Y spans (for glare-mask band overlap checks). */
export function glareGroundTruthTargetsToAnalysisSpans(input: {
  targets: GlareGroundTruthRowTarget[];
  planStripColumnIndex: number;
  consensusBodySlices: SharedLabelRowBandSlice[];
  headerSlices: SharedLabelRowBandSlice[];
  bodySlices: SharedLabelRowBandSlice[];
  bodyTopAnalysis: number;
  imageBandTop: number;
  imageBandHeight: number;
  analysisH: number;
}): GlareGroundTruthYSpanAnalysis[] {
  const yToAnalysis = (yImage: number) =>
    Math.round(((yImage - input.imageBandTop) / Math.max(1, input.imageBandHeight)) * input.analysisH);

  const spans: GlareGroundTruthYSpanAnalysis[] = [];
  for (const target of input.targets) {
    const slice = rowBandSliceForGlareGroundTruthTarget(
      target,
      input.consensusBodySlices,
      input.bodySlices,
      input.headerSlices,
    );
    if (!slice) continue;
    let top = slice.top;
    let height = slice.height;
    if (target.highlightTopFraction != null && target.highlightTopFraction > 0 && target.highlightTopFraction < 1) {
      height = Math.max(4, Math.round(height * target.highlightTopFraction));
    }
    const y0 = yToAnalysis(top);
    const y1 = yToAnalysis(top + height);
    spans.push({
      y0: Math.min(y0, y1),
      y1: Math.max(y0, y1),
      minOverlapFraction:
        DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceGlareGroundTruthBandOverlapMinFraction,
    });
  }
  return spans;
}

/**
 * True when each expected span overlaps at least one untrusted glare band by the configured fraction.
 * Used to tune {@link DEFAULT_SHARED_LABEL_GRID_PARAMS.rowSurfaceWarpMaxGlareBandBrightPixelFraction} etc.
 */
export function glareMaskMatchesGroundTruthSpans(
  mask: ColumnBodyGlareMask,
  bodyTopAnalysis: number,
  bodyBottomAnalysis: number,
  expectedSpans: GlareGroundTruthYSpanAnalysis[],
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const bandCount = mask.bandCount;
  const spanY = Math.max(1, bodyBottomAnalysis - bodyTopAnalysis);

  for (const expected of expectedSpans) {
    const b0 = analysisYToMaskBandIndex(expected.y0, bodyTopAnalysis, bodyBottomAnalysis, bandCount);
    const b1 = analysisYToMaskBandIndex(expected.y1, bodyTopAnalysis, bodyBottomAnalysis, bandCount);
    let hit = false;
    for (let b = b0; b <= b1; b += 1) {
      if (mask.untrusted[b]) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      const frac = ((expected.y1 - expected.y0) / spanY).toFixed(3);
      failures.push(
        `no untrusted glare band over analysis y ${expected.y0}–${expected.y1} (span frac ${frac})`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}