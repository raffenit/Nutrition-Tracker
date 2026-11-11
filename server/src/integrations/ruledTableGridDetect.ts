import type { BandLuminanceRoles } from '../domain/bandLuminanceRoles.js';
import {
  DEFAULT_RULED_TABLE_GRID_PARAMS,
  type RuledTableGridParams,
} from '../domain/ruledTableGridParams.js';
import {
  classifyBandLuminance,
  scanBandLuminanceY,
  verticalRuledGutterBrightnessLevel,
} from './bandLuminanceCluster.js';

export {
  classifyBandLuminance,
  classifyBandLuminanceInScanBand,
  gutterBrightnessLevel,
  inkProfileGutterThreshold,
} from './bandLuminanceCluster.js';
export type { BandLuminanceRoles } from '../domain/bandLuminanceRoles.js';

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
  return scanBandLuminanceY(height, p);
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

  const roles = classifyBandLuminance(pixels, width, height, scanStartX, width, y0, y1);
  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, width, y0, y1, roles);
  const gutterCenters = findBrightGutterCenters(brightness, p, roles);
  if (gutterCenters.length < 1) return [];

  const rightLocal = ruledValueScanRightLocal(gutterCenters, brightness.length);
  const edges = [0, ...gutterCenters, rightLocal];
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

  return trimOneSpuriousUniformGutterColumn(pixels, width, height, segments, scanW, y0, y1, p);
}

/** Close the scan at one uniform pitch past the last gutter (do not swallow open margin). */
function ruledValueScanRightLocal(gutterCenters: number[], scanLength: number): number {
  if (gutterCenters.length < 2) return scanLength;
  const spacings: number[] = [];
  for (let i = 1; i < gutterCenters.length; i += 1) {
    spacings.push(gutterCenters[i]! - gutterCenters[i - 1]!);
  }
  const pitch = medianOf(new Float64Array(spacings));
  if (pitch <= 0) return scanLength;
  const last = gutterCenters[gutterCenters.length - 1]!;
  return Math.min(scanLength, last + pitch);
}

/** When gutters over-split by exactly one vs uniform nominal width, merge the narrowest segment away. */
function trimOneSpuriousUniformGutterColumn(
  pixels: Uint8Array,
  width: number,
  height: number,
  segments: RuledGridCategorySegment[],
  scanW: number,
  y0: number,
  y1: number,
  params: RuledTableGridParams,
): RuledGridCategorySegment[] {
  const ruled = segments.filter((s) => s.horizontalRuleCount >= params.minHorizontalRulesPerColumn);
  if (ruled.length < 3) return segments;

  const minProductW = Math.max(8, Math.round(scanW * params.minColumnWidthFraction * 1.05));
  const productCols = ruled.filter((s) => s.x1 - s.x0 >= minProductW);
  if (productCols.length < 3) return segments;

  const widths = productCols.map((s) => s.x1 - s.x0);
  const mean = widths.reduce((sum, w) => sum + w, 0) / widths.length;
  if (mean <= 0) return segments;
  const cv =
    Math.sqrt(widths.reduce((sum, w) => sum + (w - mean) ** 2, 0) / widths.length) / mean;
  if (cv > params.trimSpuriousColumnMaxUniformCv) return segments;

  const nominal = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] ?? mean;
  const target = Math.max(2, Math.round(scanW / Math.max(1, nominal)));
  if (segments.length <= target || segments.length - target > 2) return segments;

  const merged = mergeNarrowest(
    segments.map((s) => ({ x0: s.x0, x1: s.x1 })),
    target,
  );
  return merged.map((segment) => ({
    ...segment,
    horizontalRuleCount: countHorizontalRulesInColumn(
      pixels,
      width,
      height,
      segment.x0,
      segment.x1,
      y0,
      y1,
      params,
    ),
  }));
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
  const levelMin = Math.max(
    median * p.horizontalRuleMedianMultiplier,
    peak * p.horizontalRuleThresholdFraction * p.horizontalRulePeakLevelFraction,
  );
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
  roles: BandLuminanceRoles,
): Float64Array {
  const glareCap = roles.glareCap;
  const profile = new Float64Array(x1 - x0);
  for (let x = x0; x < x1; x += 1) {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      const v = pixels[y * width + x]!;
      sum += Math.min(v, glareCap);
      count += 1;
    }
    profile[x - x0] = count > 0 ? sum / count : 0;
  }
  return profile;
}

function columnMeanIsGutter(mean: number, level: number): boolean {
  return mean >= level;
}

/** Bright vertical gutter center x positions in full image coordinates. */
export function brightVerticalGutterCentersAbs(
  pixels: Uint8Array,
  width: number,
  height: number,
  scanStartX: number = 0,
  scanEndX: number = width,
  params: Partial<RuledTableGridParams> = {},
): number[] {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  if (scanEndX - scanStartX < 8) return [];
  const roles = classifyBandLuminance(pixels, width, height, scanStartX, scanEndX, y0, y1);
  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, scanEndX, y0, y1, roles);
  const local = findBrightGutterCenters(brightness, p, roles);
  return local.map((x) => scanStartX + x);
}

/** Bright gutter count + 1 ≈ vertical column count in a ruled value region. */
export function estimateValueColumnCountFromGutters(
  pixels: Uint8Array,
  width: number,
  height: number,
  scanStartX: number,
  scanEndX: number = width,
  params: Partial<RuledTableGridParams> = {},
): number {
  const p = { ...DEFAULT_RULED_TABLE_GRID_PARAMS, ...params };
  const { y0, y1 } = ruledGridScanBandY(height, p);
  const roles = classifyBandLuminance(pixels, width, height, scanStartX, scanEndX, y0, y1);
  const brightness = columnMeanBrightness(pixels, width, height, scanStartX, scanEndX, y0, y1, roles);
  const gutters = findBrightGutterCenters(brightness, p, roles);
  if (gutters.length < 1) return 0;
  const level = verticalRuledGutterBrightnessLevel(roles, p.gutterBrightnessMinFraction);
  // Value scan often begins inside the label|first-column gutter: N gutters delimit N columns.
  const scanStartsInGutter = brightness[0]! >= level;
  return scanStartsInGutter ? gutters.length : gutters.length + 1;
}

function findBrightGutterCenters(
  brightness: Float64Array,
  params: RuledTableGridParams,
  roles: BandLuminanceRoles,
): number[] {
  const level = verticalRuledGutterBrightnessLevel(roles, params.gutterBrightnessMinFraction);
  if (level <= 0) return [];
  const minSpacing = Math.max(2, Math.round(brightness.length * params.gutterMinSpacingFraction));
  const minGutterW = Math.max(1, Math.round(brightness.length * params.gutterMinWidthFraction));

  const centers: number[] = [];
  let runStart = -1;
  for (let x = 0; x < brightness.length; x += 1) {
    const bright = columnMeanIsGutter(brightness[x]!, level);
    if (bright && runStart < 0) runStart = x;
    if ((!bright || x === brightness.length - 1) && runStart >= 0) {
      const runEnd = bright ? x : x - 1;
      const runW = runEnd - runStart + 1;
      if (
        runW >= minGutterW &&
        verticalGutterRunBoundedByInk(brightness, runStart, runEnd, level, minSpacing, params)
      ) {
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

/** Real vertical gutters sit between ink columns — not in open margin on one side. */
function verticalGutterRunBoundedByInk(
  brightness: Float64Array,
  runStart: number,
  runEnd: number,
  level: number,
  minSpacing: number,
  params: RuledTableGridParams,
): boolean {
  const runW = runEnd - runStart + 1;
  const probe = Math.max(
    4,
    Math.min(minSpacing, Math.round(runW * params.verticalGutterInkProbeGutterWidths)),
  );
  const edgeMargin = Math.max(
    2,
    Math.round(minSpacing * params.verticalGutterInkEdgeMarginOfMinSpacing),
  );

  let inkAfter = false;
  for (let x = runEnd + 1; x < Math.min(brightness.length, runEnd + 1 + probe); x += 1) {
    if (brightness[x]! < level) {
      inkAfter = true;
      break;
    }
  }
  if (!inkAfter) return false;

  if (runStart <= edgeMargin) return true;

  let inkBefore = false;
  for (let x = runStart - 1; x >= Math.max(0, runStart - probe); x -= 1) {
    if (brightness[x]! < level) {
      inkBefore = true;
      break;
    }
  }
  return inkBefore;
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
    median * params.horizontalRuleMedianMultiplier,
    peak * params.horizontalRuleThresholdFraction * params.horizontalRulePeakLevelFraction,
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
