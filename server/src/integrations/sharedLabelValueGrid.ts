import sharp from 'sharp';
import {
  DEFAULT_COLUMN_STRIP_DETECT_PARAMS,
  resolveColumnStripParams,
  type ColumnStripDetectOptions,
  type ColumnStripDetectParams,
} from '../domain/columnStripDetectParams.js';
import {
  DEFAULT_SHARED_LABEL_GRID_PARAMS,
  type SharedLabelGridParams,
} from '../domain/sharedLabelGridParams.js';
import {
  buildColumnInkProfileFromBand,
  columnBoundariesFromInkProfile,
  type ColumnStripRegion,
} from './labelColumnStrips.js';
import type { BandLuminanceRoles } from '../domain/bandLuminanceRoles.js';
import {
  classifyBandLuminanceInScanBand,
  inkProfileGutterThreshold,
  type InkProfileGutterSense,
} from './bandLuminanceCluster.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../domain/ruledTableGridParams.js';
import { categoriesFromRuledGrid, valueColumnsFromRuledGrid } from './ruledTableGridDetect.js';
import { columnWidthCv, refineUniformProductColumns } from './uniformColumnGeometry.js';
import { collectColumnGeometryWitnesses, fitUniformValueColumns } from './labelTableLayoutFit.js';
import { fitEqualWidthColumnGrid } from './uniformColumnGeometry.js';

export { detectSharedLabelValueGrid } from './varietyPackGridPipeline.js';

export type SharedLabelValueGridPlan = {
  band: { left: number; top: number; width: number; height: number };
  labelColumn: ColumnStripRegion;
  headerBand: { left: number; top: number; width: number; height: number };
  valueColumns: ColumnStripRegion[];
  /** Analysis-space x where the value grid starts (after shared labels). */
  valueGridAnalysisX: number;
};

export type SharedLabelGridDetectOptions = ColumnStripDetectOptions & {
  sharedGeometry?: Partial<SharedLabelGridParams>;
  requireWideAspect?: boolean;
};

export type SharedLabelGridBuffers = {
  labelColumn: Buffer;
  headerBand: Buffer;
  valueColumns: Buffer[];
};

export async function extractSharedLabelGridBuffers(
  bytes: Buffer,
  plan: SharedLabelValueGridPlan,
): Promise<SharedLabelGridBuffers> {
  const base = sharp(bytes).rotate();
  const meta = await base.metadata();
  const maxW = meta.width ?? 0;
  const maxH = meta.height ?? 0;

  const extract = async (region: { left: number; top: number; width: number; height: number }) => {
    const width = Math.min(region.width, Math.max(1, maxW - region.left));
    const height = Math.min(region.height, Math.max(1, maxH - region.top));
    return base.clone().extract({ left: region.left, top: region.top, width, height }).png().toBuffer();
  };

  const valueColumns: Buffer[] = [];
  for (const col of plan.valueColumns) {
    valueColumns.push(await extract(col));
  }

  return {
    labelColumn: await extract(plan.labelColumn),
    headerBand: await extract(plan.headerBand),
    valueColumns,
  };
}

function findLabelValueBoundary(profile: Float64Array, shared: SharedLabelGridParams): number | null {
  const searchStart = Math.max(1, Math.round(profile.length * shared.labelSearchMinFraction));
  const searchEnd = Math.min(profile.length - 2, Math.round(profile.length * shared.labelSearchMaxFraction));
  const leftPeak = peakInRange(profile, 0, searchEnd);
  if (leftPeak <= 0) return null;
  const cutLevel = leftPeak * shared.labelBoundaryInkDropRatio;
  for (let x = searchStart; x < searchEnd; x += 1) {
    if (profile[x]! < cutLevel) return x;
  }
  return null;
}

function meanInk(profile: Float64Array, from: number, to: number): number {
  if (to <= from) return 0;
  let sum = 0;
  let count = 0;
  for (let x = from; x < to; x += 1) {
    sum += profile[x]!;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function peakInRange(profile: Float64Array, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i <= to && i < profile.length; i += 1) {
    peak = Math.max(peak, profile[i]!);
  }
  return peak;
}

function valueColumnWidthsUniform(
  segments: Array<{ x0: number; x1: number }>,
  maxCv: number,
): boolean {
  if (segments.length < 2) return true;
  const widths = segments.map((segment) => segment.x1 - segment.x0);
  const mean = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  if (mean <= 0) return false;
  const variance =
    widths.reduce((sum, width) => sum + (width - mean) ** 2, 0) / widths.length;
  const cv = Math.sqrt(variance) / mean;
  return cv <= maxCv;
}

/** Test hook: same boundary logic on a 1D ink profile. */
export function sharedLabelBoundaryForTest(profile: Float64Array, shared?: Partial<SharedLabelGridParams>): number | null {
  return findLabelValueBoundary(profile, { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, ...shared });
}

/**
 * Left/right ink asymmetry for layout hypothesis scoring — uses ink-profile label boundary
 * when width is plausible, not the first ruled category edge (misleading on per-column tables).
 */
export function profileInkAsymmetryForLayoutScores(
  profile: Float64Array,
  fallbackLabelEndX: number,
  shared: Partial<SharedLabelGridParams> = {},
): number | undefined {
  const params = { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, ...shared };
  const inkBoundary = findLabelValueBoundary(profile, params);
  const labelFrac = (inkBoundary ?? fallbackLabelEndX) / Math.max(1, profile.length);
  const labelEndX =
    inkBoundary !== null &&
    labelFrac >= params.labelColumnMinWidthFraction &&
    labelFrac <= params.labelColumnMaxWidthFraction
      ? inkBoundary
      : fallbackLabelEndX;
  if (labelEndX <= 0 || labelEndX >= profile.length) return undefined;
  const rightMean = meanInk(profile, labelEndX, profile.length);
  if (rightMean <= 0) return undefined;
  return meanInk(profile, 0, labelEndX) / rightMean;
}

/** Ink-profile shared rail + value column bounds (analysis x). */
export function sharedRailLayoutFromInkProfile(
  pixels: Uint8Array,
  width: number,
  height: number,
  profile: Float64Array,
  stripParams: ColumnStripDetectParams,
  shared: SharedLabelGridParams,
  maxColumns: number,
): {
  labelColumn: { x0: number; x1: number; index: number; horizontalRuleCount: number };
  valueColumns: Array<{ x0: number; x1: number; index: number; horizontalRuleCount: number }>;
  labelBoundaryX: number;
  inkAsymmetry: number;
} | null {
  const boundaryX = findLabelValueBoundary(profile, shared);
  if (boundaryX === null) return null;

  const labelWidthFrac = boundaryX / profile.length;
  if (labelWidthFrac < shared.labelColumnMinWidthFraction || labelWidthFrac > shared.labelColumnMaxWidthFraction) {
    return null;
  }

  const leftMean = meanInk(profile, 0, boundaryX);
  const rightMean = meanInk(profile, boundaryX, profile.length);
  const asymmetry = rightMean > 0 ? leftMean / rightMean : 0;
  if (leftMean < rightMean * shared.labelInkAsymmetryRatio) return null;

  const segments = valueColumnBoundaries(pixels, width, height, boundaryX, stripParams, shared, maxColumns);
  if (segments.length < shared.minValueColumns) return null;
  if (!valueColumnWidthsUniform(segments, shared.maxValueColumnWidthCv)) return null;

  return {
    labelColumn: { x0: 0, x1: boundaryX, index: 0, horizontalRuleCount: 0 },
    valueColumns: segments.map((segment, index) => ({
      x0: segment.x0,
      x1: segment.x1,
      index: index + 1,
      horizontalRuleCount: 0,
    })),
    labelBoundaryX: boundaryX,
    inkAsymmetry: asymmetry,
  };
}

export function valueBoundariesAfterLabelForTest(
  pixels: Uint8Array,
  width: number,
  height: number,
  boundaryX: number,
  params: ColumnStripDetectParams & { maxColumns: number },
  shared: Partial<SharedLabelGridParams> = {},
): Array<{ x0: number; x1: number }> {
  return valueColumnBoundaries(
    pixels,
    width,
    height,
    boundaryX,
    params,
    { ...DEFAULT_SHARED_LABEL_GRID_PARAMS, ...shared },
    params.maxColumns,
  );
}

type Segment = { x0: number; x1: number };

function valueColumnBoundaries(
  pixels: Uint8Array,
  width: number,
  height: number,
  boundaryX: number,
  stripParams: ColumnStripDetectParams,
  shared: SharedLabelGridParams,
  maxColumns: number,
): Segment[] {
  const luminanceRoles = classifyBandLuminanceInScanBand(pixels, width, height, boundaryX, width);
  let ruledCats = categoriesFromRuledGrid(pixels, width, height, boundaryX, undefined, maxColumns, {
    requireHorizontalRules: true,
  });
  if (ruledCats.length < shared.minValueColumns) {
    ruledCats = categoriesFromRuledGrid(pixels, width, height, boundaryX, undefined, maxColumns, {
      requireHorizontalRules: false,
    });
  }
  if (ruledCats.length > 0) {
    const ruledSegs = ruledCats.map((s) => ({ x0: s.x0, x1: s.x1 }));
    const refined = refineUniformProductColumns(
      pixels,
      width,
      height,
      ruledSegs,
      ruledCats.map((c) => ({ horizontalRuleCount: c.horizontalRuleCount })),
      boundaryX,
      width,
      maxColumns,
    );
    const cv = columnWidthCv(refined.map((s) => s.x1 - s.x0));
    if (refined.length >= shared.minValueColumns && cv <= shared.maxValueColumnWidthCv) {
      const valueW = width - boundaryX;
      const widths = refined.map((segment) => segment.x1 - segment.x0);
      const median = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] ?? 0;
      const target = median > 0 ? Math.round(valueW / median) : 0;
      if (
        target >= shared.minValueColumns &&
        refined.length > target &&
        refined.length - target <= 2 &&
        cv <= shared.maxValueColumnWidthCv
      ) {
        return fitEqualWidthColumnGrid(boundaryX, width, target);
      }
      return refined;
    }
  }

  const ruled = valueColumnsFromRuledGrid(pixels, width, height, boundaryX, undefined, maxColumns);
  if (ruled.length >= shared.minValueColumns) return ruled;

  const valueOnlyProfile = profileSliceValueColumns(pixels, width, height, boundaryX, luminanceRoles);
  const dense = columnBoundariesFromInkProfile(
    valueOnlyProfile,
    {
      ...stripParams,
      maxColumns,
      minStripWidthFraction: Math.min(stripParams.minStripWidthFraction, 0.028),
      gutterThresholdRatio: Math.min(stripParams.gutterThresholdRatio, shared.valueGutterThresholdRatio),
    },
    luminanceRoles,
  );
  const denseAbs = dense.map((segment) => ({ x0: segment.x0 + boundaryX, x1: segment.x1 + boundaryX }));
  if (denseAbs.length >= shared.minValueColumns) {
    const denseCv = columnWidthCv(denseAbs.map((s) => s.x1 - s.x0));
    if (denseCv <= shared.maxValueColumnWidthCv) return denseAbs;
  }

  const ruledCv =
    ruledCats.length > 0 ? columnWidthCv(ruledCats.map((s) => s.x1 - s.x0)) : Number.POSITIVE_INFINITY;
  if (ruledCats.length > shared.minValueColumns && ruledCv > shared.maxValueColumnWidthCv) {
    const witnesses = collectColumnGeometryWitnesses(pixels, width, height, stripParams, maxColumns);
    const layoutFit = fitUniformValueColumns(witnesses, boundaryX, width, maxColumns, 4);
    if (layoutFit.length >= shared.minValueColumns) return layoutFit;
  }

  const sparse = sparseValueColumnBoundaries(valueOnlyProfile, shared, maxColumns, luminanceRoles);
  return sparse.map((segment) => ({ x0: segment.x0 + boundaryX, x1: segment.x1 + boundaryX }));
}

function profileSliceValueColumns(
  pixels: Uint8Array,
  width: number,
  height: number,
  boundaryX: number,
  luminanceRoles: BandLuminanceRoles,
): Float64Array {
  const valueW = width - boundaryX;
  const profile = new Float64Array(valueW);
  const glareCap = luminanceRoles.glareCap;
  for (let x = boundaryX; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y < height; y += 1) {
      sum += 255 - Math.min(pixels[y * width + x]!, glareCap);
    }
    profile[x - boundaryX] = sum / height;
  }
  return profile;
}

function sparseValueColumnBoundaries(
  profile: Float64Array,
  shared: SharedLabelGridParams,
  maxColumns: number,
  luminanceRoles: BandLuminanceRoles,
): Segment[] {
  const max = profile.reduce((peak, value) => Math.max(peak, value), 0);
  if (max <= 0) return [];

  const gutter =
    Math.abs(luminanceRoles.ink - luminanceRoles.background) >= 18
      ? inkProfileGutterThreshold(luminanceRoles, DEFAULT_RULED_TABLE_GRID_PARAMS.gutterBrightnessMinFraction)
      : {
          level: max * shared.valueGutterThresholdRatio,
          sense: 'local_minimum' as InkProfileGutterSense,
        };
  const gutterLevel = gutter.level;
  const gutterIsMinimum = gutter.sense === 'local_minimum';
  const rawSpacing = Math.max(1, Math.round(profile.length * shared.valueRawGutterSpacingFraction));
  const minProductSpacing = profile.length * shared.valueColumnMinSpacingFraction;

  const rawGutters: number[] = [];
  for (let x = 2; x < profile.length - 2; x += 1) {
    const value = profile[x]!;
    if (gutterIsMinimum) {
      if (value > gutterLevel) continue;
      if (profile[x - 1]! < value || profile[x + 1]! < value) continue;
    } else {
      if (value < gutterLevel) continue;
      if (profile[x - 1]! > value || profile[x + 1]! > value) continue;
    }
    const last = rawGutters[rawGutters.length - 1];
    if (last !== undefined && x - last < rawSpacing) continue;
    rawGutters.push(x);
  }
  if (rawGutters.length < shared.minValueColumns - 1) return [];

  const gutters: number[] = [];
  for (const candidate of rawGutters) {
    const last = gutters[gutters.length - 1];
    if (last === undefined || candidate - last >= minProductSpacing * 0.85) {
      gutters.push(candidate);
    }
  }
  if (gutters.length < shared.minValueColumns - 1) return [];

  const minWidth = Math.max(1, Math.round(minProductSpacing * 0.45));
  const edges = [0, ...gutters, profile.length];
  const segments: Segment[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const x0 = edges[i]!;
    const x1 = edges[i + 1]!;
    if (x1 - x0 < minWidth) continue;
    segments.push({ x0, x1 });
  }

  if (segments.length > maxColumns) {
    return mergeNarrowestSegments(segments, maxColumns);
  }
  return segments;
}

function mergeNarrowestSegments(segments: Segment[], target: number): Segment[] {
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
    const next = current.filter((_, index) => index !== narrowest && index !== neighbor);
    next.push(merged);
    next.sort((left, right) => left.x0 - right.x0);
    current = next;
  }
  return current;
}
