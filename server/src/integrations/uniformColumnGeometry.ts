import {
  DEFAULT_UNIFORM_COLUMN_GEOMETRY_PARAMS,
  type UniformColumnGeometryParams,
} from '../domain/uniformColumnGeometryParams.js';
import {
  categoriesFromRuledGrid,
  estimateValueColumnCountFromGutters,
  type RuledGridSegment,
} from './ruledTableGridDetect.js';

export function medianPositiveWidth(widths: number[]): number {
  const sorted = widths.filter((w) => w > 0).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** First column is a shared label rail when it is substantially wider than sibling product stacks. */
export function firstColumnWideVsSiblings(
  firstWidth: number,
  siblingWidths: number[],
  minWidthRatio: number,
): boolean {
  const median = medianPositiveWidth(siblingWidths);
  return median > 0 && firstWidth >= median * minWidthRatio;
}

export function columnWidthCv(widths: number[]): number {
  if (widths.length < 2) return 0;
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  if (mean <= 0) return Number.POSITIVE_INFINITY;
  const variance = widths.reduce((sum, w) => sum + (w - mean) ** 2, 0) / widths.length;
  return Math.sqrt(variance) / mean;
}

export function nominalUniformColumnWidth(
  segments: Array<{ x0: number; x1: number; horizontalRuleCount?: number }>,
  minRules: number,
): number | null {
  const widths = segments
    .filter((s) => (s.horizontalRuleCount ?? 0) >= minRules)
    .map((s) => s.x1 - s.x0)
    .filter((w) => w > 0)
    .sort((a, b) => a - b);
  if (widths.length === 0) {
    const all = segments
      .map((s) => s.x1 - s.x0)
      .filter((w) => w > 0)
      .sort((a, b) => a - b);
    if (all.length === 0) return null;
    return all[Math.floor(all.length / 2)] ?? null;
  }
  return widths[Math.floor(widths.length / 2)] ?? null;
}

function subdivideSegmentWithRuledGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  segment: RuledGridSegment,
  maxColumns: number,
  maxCv: number,
): RuledGridSegment[] {
  const inner = categoriesFromRuledGrid(pixels, width, height, segment.x0, undefined, maxColumns, {
    requireHorizontalRules: true,
  });
  if (inner.length < 2) return [segment];
  const innerCv = columnWidthCv(inner.map((s) => s.x1 - s.x0));
  if (innerCv > maxCv * 1.5) return [segment];
  return inner.map((s) => ({ x0: s.x0, x1: s.x1 }));
}

/** Equal-width column grid in analysis space (layout hypothesis fit). */
export function fitEqualWidthColumnGrid(
  valueStartX: number,
  valueEndX: number,
  columnCount: number,
): RuledGridSegment[] {
  const valueW = valueEndX - valueStartX;
  if (columnCount < 1 || valueW < 2) return [];
  const colW = valueW / columnCount;
  const segments: RuledGridSegment[] = [];
  for (let i = 0; i < columnCount; i += 1) {
    const x0 = valueStartX + Math.round(i * colW);
    const x1 = i === columnCount - 1 ? valueEndX : valueStartX + Math.round((i + 1) * colW);
    if (x1 - x0 >= 2) segments.push({ x0, x1 });
  }
  return segments;
}

function snapEqualWidthGrid(valueStartX: number, valueEndX: number, nominalWidth: number): RuledGridSegment[] {
  const valueW = valueEndX - valueStartX;
  if (valueW < nominalWidth * 1.5) return [];
  const n = Math.max(1, Math.round(valueW / nominalWidth));
  return fitEqualWidthColumnGrid(valueStartX, valueEndX, n);
}

export function refineUniformProductColumns(
  pixels: Uint8Array,
  width: number,
  height: number,
  segments: RuledGridSegment[],
  ruledMeta: Array<{ horizontalRuleCount: number }>,
  valueStartX: number,
  valueEndX: number,
  maxColumns: number,
  params: Partial<UniformColumnGeometryParams> = {},
): RuledGridSegment[] {
  const p = { ...DEFAULT_UNIFORM_COLUMN_GEOMETRY_PARAMS, ...params };
  if (segments.length === 0) return segments;

  const withRules = segments.map((s, i) => ({
    ...s,
    horizontalRuleCount: ruledMeta[i]?.horizontalRuleCount ?? 0,
  }));
  const nominal = nominalUniformColumnWidth(withRules, p.minHorizontalRulesPerColumn);
  if (nominal === null || nominal <= 0) return segments;

  let current: RuledGridSegment[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    const sw = segment.x1 - segment.x0;
    if (sw > nominal * p.maxWideToNominalRatio) {
      const inner = subdivideSegmentWithRuledGrid(pixels, width, height, segment, maxColumns, p.maxWidthCv);
      if (inner.length > 1 && columnWidthCv(inner.map((s) => s.x1 - s.x0)) <= p.maxWidthCv * 1.2) {
        current.push(...inner);
      } else {
        const n = Math.max(2, Math.round(sw / nominal));
        const localW = sw / n;
        for (let j = 0; j < n; j += 1) {
          current.push({
            x0: segment.x0 + Math.round(j * localW),
            x1: j === n - 1 ? segment.x1 : segment.x0 + Math.round((j + 1) * localW),
          });
        }
      }
    } else {
      current.push(segment);
    }
  }

  let cv = columnWidthCv(current.map((s) => s.x1 - s.x0));
  const valueW = valueEndX - valueStartX;
  const fromGutters = estimateValueColumnCountFromGutters(
    pixels,
    width,
    height,
    valueStartX,
    valueEndX,
  );
  const fromNominal = Math.round(valueW / nominal);
  const targetCount = Math.min(
    maxColumns,
    Math.max(current.length, Math.min(fromGutters, fromNominal)),
  );

  if (targetCount > current.length && targetCount <= maxColumns && cv > p.maxWidthCv * 0.5) {
    const colW = valueW / targetCount;
    const snapped = snapEqualWidthGrid(valueStartX, valueEndX, colW);
    const snapCv = columnWidthCv(snapped.map((s) => s.x1 - s.x0));
    if (snapped.length >= 2 && snapCv <= p.maxWidthCv) current = snapped;
  }

  cv = columnWidthCv(current.map((s) => s.x1 - s.x0));
  if (cv > p.maxWidthCv && fromGutters >= 2 && fromGutters <= maxColumns) {
    const colW = valueW / fromGutters;
    const snapped = snapEqualWidthGrid(valueStartX, valueEndX, colW);
    const snapCv = columnWidthCv(snapped.map((s) => s.x1 - s.x0));
    if (snapped.length === fromGutters && snapCv <= p.maxWidthCv) {
      current = snapped;
    }
  }

  if (current.length > maxColumns) current = current.slice(0, maxColumns);
  return current;
}

export type EqualWidthPair = {
  left: RuledGridSegment;
  right: RuledGridSegment;
  widthRatio: number;
};

export function detectEqualWidthColumnPair(
  segments: RuledGridSegment[],
  bandWidth: number,
  widthRatioMin: number = 0.48,
): EqualWidthPair | null {
  const wide = segments.filter((s) => s.x1 - s.x0 >= bandWidth * 0.15);
  let best: EqualWidthPair | null = null;
  for (let i = 0; i < wide.length; i += 1) {
    for (let j = i + 1; j < wide.length; j += 1) {
      const a = wide[i]!;
      const b = wide[j]!;
      const wa = a.x1 - a.x0;
      const wb = b.x1 - b.x0;
      if (wa <= 0 || wb <= 0) continue;
      const ratio = wa < wb ? wa / wb : wb / wa;
      if (ratio < widthRatioMin) continue;
      if (wa < bandWidth * 0.3 || wb < bandWidth * 0.3) continue;
      const span = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0);
      if (span < bandWidth * 0.72) continue;
      const left = a.x0 <= b.x0 ? a : b;
      const right = a.x0 <= b.x0 ? b : a;
      const pair = { left, right, widthRatio: ratio };
      if (!best || pair.widthRatio > best.widthRatio) best = pair;
    }
  }
  return best;
}
