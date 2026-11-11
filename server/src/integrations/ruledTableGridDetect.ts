import {
  DEFAULT_RULED_TABLE_GRID_PARAMS,
  type RuledTableGridParams,
} from '../domain/ruledTableGridParams.js';

export type RuledGridSegment = { x0: number; x1: number };

/**
 * Column bounds in analysis x (full band width) from bright vertical gutters + horizontal rules.
 */
export type RuledGridCategorySegment = RuledGridSegment & { horizontalRuleCount: number };

export function ruledGridScanBandY(
  height: number,
  params: Partial<RuledTableGridParams> = {},
): { y0: number; y1: number } {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const y0 = Math.round(height * p.valueRowScanTopSkipFraction);
  const y1 = Math.max(y0 + 1, height - Math.round(height * p.valueRowScanBottomSkipFraction));
  return { y0, y1 };
}

export function categoriesFromRuledGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  scanStartX: number,
  params: Partial<RuledTableGridParams> = {},
  maxColumns: number = 14,
  options?: { requireHorizontalRules?: boolean },
): RuledGridCategorySegment[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const requireRules = options?.requireHorizontalRules ?? false;
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const scanW = width - scanStartX;
  if (scanW < 8) return [];

  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, width, y0, y1);
  const gutterCenters = findBrightGutterCenters(brightness, p);
  if (gutterCenters.length < 1) return [];

  const edges = [0, ...gutterCenters, brightness.length];
  const minColW = Math.max(2, Math.round(scanW * p.minColumnWidthFraction));
  const segments: RuledGridCategorySegment[] = [];

  for (let i = 0; i < edges.length - 1; i += 1) {
    const localX0 = edges[i]!;
    const localX1 = edges[i + 1]!;
    if (localX1 - localX0 < minColW) continue;
    const absX0 = scanStartX + localX0;
    const absX1 = scanStartX + localX1;
    const ruleCount = countHorizontalRulesInColumn(pixels, width, height, absX0, absX1, y0, y1, p);
    if (requireRules && ruleCount < p.minHorizontalRulesPerColumn) continue;
    segments.push({ x0: absX0, x1: absX1, horizontalRuleCount: ruleCount });
  }

  if (segments.length > maxColumns) {
    const merged = mergeNarrowest(
      segments.map((s) => ({ x0: s.x0, x1: s.x1 })),
      maxColumns,
    );
    return merged.map((segment) => ({
      ...segment,
      horizontalRuleCount: countHorizontalRulesInColumn(pixels, width, height, segment.x0, segment.x1, y0, y1, p),
    }));
  }
  return segments;
}

export function valueColumnsFromRuledGrid(
  pixels: Uint8Array,
  width: number,
  height: number,
  valueStartX: number,
  params: Partial<RuledTableGridParams> = {},
  maxColumns: number = 14,
): RuledGridSegment[] {
  return categoriesFromRuledGrid(pixels, width, height, valueStartX, params, maxColumns, {
    requireHorizontalRules: true,
  }).map(({ x0, x1 }) => ({ x0, x1 }));
}

/** Analysis-space y indices for horizontal rule row peaks inside a column. */
export function horizontalRuleRowYsInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const profile = horizontalEdgeProfileInColumn(pixels, width, height, x0, x1, y0, y1);
  const peak = profile.reduce((best, row) => Math.max(best, row.strength), 0);
  if (peak <= 0) return [];
  const median = medianOf(new Float64Array(profile.map((row) => row.strength)));
  const levelMin = Math.max(median * 2.5, peak * p.horizontalRuleThresholdFraction * 0.28);
  const rows: number[] = [];
  let inRun = false;
  for (const row of profile) {
    const high = row.strength >= levelMin;
    if (high && !inRun) {
      rows.push(row.y);
      inRun = true;
    }
    if (!high) inRun = false;
  }
  return rows;
}

export function consensusBodyTopY(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  params: Partial<RuledTableGridParams> = {},
  minAgreeingColumns: number = 2,
): number | null {
  const firstRules: number[] = [];
  for (const col of columns) {
    const ys = horizontalRuleRowYsInColumn(pixels, width, height, col.x0, col.x1, params);
    if (ys.length > 0) firstRules.push(ys[0]!);
  }
  if (firstRules.length < minAgreeingColumns) return null;
  firstRules.sort((a, b) => a - b);
  return firstRules[Math.floor(firstRules.length / 2)]!;
}

export function consensusRowBandYs(
  pixels: Uint8Array,
  width: number,
  height: number,
  columns: RuledGridSegment[],
  maxJitterPx: number,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  if (columns.length === 0) return [];
  const perColumn = columns.map((col) =>
    horizontalRuleRowYsInColumn(pixels, width, height, col.x0, col.x1, params),
  );
  const counts = new Map<number, number>();
  for (const ys of perColumn) {
    for (const y of ys) {
      let bucket = y;
      for (const key of counts.keys()) {
        if (Math.abs(key - y) <= maxJitterPx) {
          bucket = key;
          break;
        }
      }
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  }
  const minVotes = Math.max(1, Math.ceil(columns.length * 0.45));
  return [...counts.entries()]
    .filter(([, votes]) => votes >= minVotes)
    .map(([y]) => y)
    .sort((a, b) => a - b);
}

function columnMeanBrightness(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Float64Array {
  const profile = new Float64Array(x1 - x0);
  for (let x = x0; x < x1; x += 1) {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      sum += pixels[y * width + x]!;
      count += 1;
    }
    profile[x - x0] = count > 0 ? sum / count : 0;
  }
  return profile;
}

function findBrightGutterCenters(brightness: Float64Array, params: RuledTableGridParams): number[] {
  const max = brightness.reduce((peak, v) => Math.max(peak, v), 0);
  if (max <= 0) return [];
  const level = max * params.gutterBrightnessMinFraction;
  const minSpacing = Math.max(2, Math.round(brightness.length * params.gutterMinSpacingFraction));
  const minGutterW = Math.max(1, Math.round(brightness.length * params.gutterMinWidthFraction));

  const centers: number[] = [];
  let runStart = -1;
  for (let x = 0; x < brightness.length; x += 1) {
    const bright = brightness[x]! >= level;
    if (bright && runStart < 0) runStart = x;
    if ((!bright || x === brightness.length - 1) && runStart >= 0) {
      const runEnd = bright ? x : x - 1;
      const runW = runEnd - runStart + 1;
      if (runW >= minGutterW) {
        const center = Math.round((runStart + runEnd) / 2);
        const last = centers[centers.length - 1];
        if (last === undefined || center - last >= minSpacing) {
          centers.push(center);
        }
      }
      runStart = -1;
    }
  }
  return centers;
}

function horizontalEdgeProfileInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Array<{ y: number; strength: number }> {
  const colW = Math.max(1, x1 - x0);
  const rows: Array<{ y: number; strength: number }> = [];
  for (let y = y0 + 1; y < y1; y += 1) {
    let edge = 0;
    for (let x = x0 + 1; x < x1 - 1; x += 1) {
      const idx = y * width + x;
      edge += Math.abs(pixels[idx]! - pixels[idx - width]!);
    }
    rows.push({ y, strength: edge / colW });
  }
  return rows;
}

function countHorizontalRulesInColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  params: RuledTableGridParams,
): number {
  const profile = horizontalEdgeProfileInColumn(pixels, width, height, x0, x1, y0, y1);
  const peak = profile.reduce((p, row) => Math.max(p, row.strength), 0);
  if (peak <= 0) return 0;
  const median = medianOf(new Float64Array(profile.map((row) => row.strength)));
  const levelMin = Math.max(
    median * 2.5,
    peak * params.horizontalRuleThresholdFraction * 0.28,
  );
  let rules = 0;
  let inRun = false;
  for (const row of profile) {
    const high = row.strength >= levelMin;
    if (high && !inRun) {
      rules += 1;
      inRun = true;
    }
    if (!high) inRun = false;
  }
  return rules;
}

function medianOf(values: Float64Array): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] ?? 0;
}

function mergeNarrowest(segments: RuledGridSegment[], target: number): RuledGridSegment[] {
  let current = [...segments];
  while (current.length > target) {
    let narrowest = 0;
    for (let i = 1; i < current.length; i += 1) {
      if (current[i]!.x1 - current[i]!.x0 < current[narrowest]!.x1 - current[narrowest]!.x0) {
        narrowest = i;
      }
    }
    const neighbor = narrowest === 0 ? 1 : narrowest - 1;
    const a = current[narrowest]!;
    const b = current[neighbor]!;
    const merged = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1) };
    current = current.filter((_, i) => i !== narrowest && i !== neighbor);
    current.push(merged);
    current.sort((l, r) => l.x0 - r.x0);
  }
  return current;
}
