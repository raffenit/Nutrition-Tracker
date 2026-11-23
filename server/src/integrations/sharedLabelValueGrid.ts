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
import { DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS } from '../domain/varietyPackGridPipelineParams.js';
import {
  buildColumnInkProfileFromBand,
  columnBoundariesFromInkProfile,
  type ColumnStripRegion,
} from './labelColumnStrips.js';
import type { BandLuminanceRoles } from '../domain/bandLuminanceRoles.js';
import type { ColumnBodyGlareMask } from './bandLuminanceCluster.js';
import {
  classifyBandLuminanceInScanBand,
  inkProfileGutterThreshold,
  type InkProfileGutterSense,
} from './bandLuminanceCluster.js';
import { classifyNutritionTableBandLuminance } from '../domain/nutritionTableInkBounds.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../domain/ruledTableGridParams.js';
import {
  categoriesFromRuledGrid,
  nutritionTableRightAnalysisX,
  valueColumnsFromRuledGrid,
} from './ruledTableGridDetect.js';
import {
  columnWidthCv,
  firstColumnWideVsSiblings,
  medianPositiveWidth,
  refineUniformProductColumns,
} from './uniformColumnGeometry.js';
import { collectColumnGeometryWitnesses, fitUniformValueColumns } from './labelTableLayoutFit.js';
import { fitEqualWidthColumnGrid } from './uniformColumnGeometry.js';
import { medianRowBandSliceHeight, type SharedLabelRowBandSlice } from '../domain/sharedLabelGridLayout.js';
import {
  rowBandSliceAxisAlignedBounds,
  type RowSurfaceLayoutMode,
  type ValueColumnWarpProbe,
} from '../domain/sharedLabelRowRegions.js';

export { detectSharedLabelValueGrid } from './varietyPackGridPipeline.js';

export type SharedLabelValueGridPlan = {
  band: { left: number; top: number; width: number; height: number };
  labelColumn: ColumnStripRegion;
  headerBand: { left: number; top: number; width: number; height: number };
  valueColumns: ColumnStripRegion[];
  /** Analysis x0/x1 per {@link valueColumns} strip (row warp, glare, OCR geometry). */
  valueColumnAnalysisSegments: Array<{ x0: number; x1: number }>;
  /** Analysis-space x where the value grid starts (after shared labels). */
  valueGridAnalysisX: number;
  /** Nutrient table body (excludes header band and typical footer). */
  nutrientBodyTop: number;
  nutrientBodyHeight: number;
  /** Straight grids: shared horizontal mesh; skewed: independent column surfaces. */
  rowSurfaceMode: RowSurfaceLayoutMode;
  /** Manifest row-count / consensus reference (same tops when {@link rowSurfaceMode} is `shared`). */
  rowBandSlices: SharedLabelRowBandSlice[];
  labelRowBandSlices: SharedLabelRowBandSlice[];
  valueRowBandSlicesPerColumn: SharedLabelRowBandSlice[][];
  valueColumnGlareMasks: ColumnBodyGlareMask[];
  valueColumnWarpProbes?: ValueColumnWarpProbe[];
  /** Columns whose row-slice count disagreed with consensus and were rebuilt on the consensus mesh. */
  rowBandReconciledColumns?: number;
  headerConsensusRowBandSlices: SharedLabelRowBandSlice[];
  headerLabelRowBandSlices: SharedLabelRowBandSlice[];
  headerRowBandSlicesPerColumn: SharedLabelRowBandSlice[][];
  /** Median nutrient row pitch in full-image px (from consensus rules). */
  rowPitchPx: number;
};

export type SharedLabelGridDetectOptions = ColumnStripDetectOptions & {
  sharedGeometry?: Partial<SharedLabelGridParams>;
  requireWideAspect?: boolean;
};

export type SharedLabelGridBuffers = {
  labelColumn: Buffer;
  /** Full width above nutrient body — legacy single-strip OCR. */
  headerBand: Buffer;
  /** Per-product header stack (names, display calories, serving) — read in full, not discarded. */
  headerColumns: Buffer[];
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
    const left = Math.max(0, Math.round(region.left));
    const top = Math.max(0, Math.round(region.top));
    const width = Math.min(Math.max(1, Math.round(region.width)), Math.max(1, maxW - left));
    const height = Math.min(Math.max(1, Math.round(region.height)), Math.max(1, maxH - top));
    return base.clone().extract({ left, top, width, height }).png().toBuffer();
  };

  const valueColumns: Buffer[] = [];
  for (const col of plan.valueColumns) {
    valueColumns.push(await extract(col));
  }

  const headerColumns: Buffer[] = [];
  const headerTop = plan.headerBand.top;
  const headerHeight = plan.headerBand.height;
  for (const col of plan.valueColumns) {
    headerColumns.push(
      await extract({
        left: col.left,
        top: headerTop,
        width: col.width,
        height: headerHeight,
      }),
    );
  }

  return {
    labelColumn: await extract(plan.labelColumn),
    headerBand: await extract(plan.headerBand),
    headerColumns,
    valueColumns,
  };
}

export type RowBandExtractMinSize = {
  minHeightPx: number;
  minWidthPx: number;
};

export function rowBandMinExtractSize(
  plan: Pick<SharedLabelValueGridPlan, 'rowPitchPx'>,
  columnWidth: number,
  fullImageWidth: number,
  shared: SharedLabelGridParams = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): RowBandExtractMinSize {
  const pitch = plan.rowPitchPx > 0 ? plan.rowPitchPx : 0;
  const minHeightFromPitch =
    pitch > 0 ? Math.round(pitch * shared.rowBandMinOcrExtractHeightPitchFraction) : 0;
  const minHeightPx = Math.max(shared.minRowBandSliceHeightPx, minHeightFromPitch);

  const minWImage =
    fullImageWidth > 0 ? Math.round(fullImageWidth * shared.rowBandMinOcrExtractWidthImageFraction) : 0;
  const minWPitch =
    pitch > 0 ? Math.round(pitch * shared.rowBandMinOcrExtractWidthPitchFraction) : 0;
  const minWidthPx = Math.min(
    Math.max(1, columnWidth),
    Math.max(minWImage, minWPitch),
  );

  return { minHeightPx, minWidthPx };
}

/** OCR one column as one line per horizontal row-band slice (ordered top → bottom). */
export async function extractSharedLabelColumnPngsByRowBands(
  bytes: Buffer,
  column: Pick<ColumnStripRegion, 'left' | 'width'>,
  slices: SharedLabelRowBandSlice[],
  minSize?: RowBandExtractMinSize,
): Promise<Buffer[]> {
  if (slices.length === 0) return [];
  const base = sharp(bytes).rotate();
  const meta = await base.metadata();
  const maxW = meta.width ?? 0;
  const maxH = meta.height ?? 0;
  const buffers: Buffer[] = [];
  for (const slice of slices) {
    let left = Math.max(0, Math.round(column.left));
    let width = Math.min(Math.max(1, Math.round(column.width)), Math.max(1, maxW - left));
    const aligned = rowBandSliceAxisAlignedBounds(slice);
    let top = Math.max(0, Math.round(aligned.top));
    let height = Math.min(Math.round(aligned.height), Math.max(1, maxH - top));

    if (minSize) {
      if (width < minSize.minWidthPx && maxW > 0) {
        const want = Math.min(minSize.minWidthPx, maxW);
        const expand = want - width;
        left = Math.max(0, left - Math.floor(expand / 2));
        width = Math.min(want, maxW - left);
      }
      if (height < minSize.minHeightPx) {
        const want = minSize.minHeightPx;
        const deficit = want - height;
        const expandUp = Math.min(top, Math.floor(deficit / 2));
        top -= expandUp;
        height = Math.min(maxH - top, height + deficit);
      }
    }

    const png = await base.clone().extract({ left, top, width, height }).png().toBuffer();
    const deskewed = await deskewRowBandSlicePng(png, slice, column.width);
    buffers.push(await stripRowBandSliceEdgeRules(deskewed));
  }
  return buffers;
}

/**
 * Rotate a skewed row-band crop so baseline text is horizontal. Curved pack
 * surfaces shear each row quad; the slice carries measured edge skew, and
 * sharp expands the canvas so no glyphs are clipped by the rotation.
 */
async function deskewRowBandSlicePng(
  png: Buffer,
  slice: SharedLabelRowBandSlice,
  columnWidth: number,
): Promise<Buffer> {
  const meanSkewPx = ((slice.topSkewPx ?? 0) + (slice.bottomSkewPx ?? 0)) / 2;
  const angleDeg = (Math.atan(meanSkewPx / Math.max(1, columnWidth)) * 180) / Math.PI;
  const params = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  if (
    Math.abs(angleDeg) < params.rowBandDeskewMinAngleDeg ||
    Math.abs(angleDeg) > params.rowBandDeskewMaxAngleDeg
  ) {
    return png;
  }
  return sharp(png)
    .rotate(-angleDeg, { background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

/**
 * Whiten thin full-height vertical rules caught at a slice's left/right edge.
 * Column boundaries are shared between neighbors, so a printed separator can
 * land just inside a crop; OCR then emits a leading/trailing "|" in every row.
 * Only runs narrower than {@link SharedLabelGridParams.rowBandEdgeRuleMaxWidthFraction}
 * with near-constant dark coverage qualify — text strokes never span a slice.
 */
export async function stripRowBandSliceEdgeRules(png: Buffer): Promise<Buffer> {
  const params = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width ?? 0;
  const height = info.height ?? 0;
  if (width < 8 || height < 8) return png;
  const scan = Math.max(1, Math.round(width * params.rowBandEdgeRuleScanEdgeFraction));
  const maxRun = Math.max(1, Math.round(width * params.rowBandEdgeRuleMaxWidthFraction));
  const minDarkFrac = params.rowBandEdgeRuleMinDarkRowFraction;
  const darkLevel = params.rowBandEdgeRuleDarkLuminance;
  const pixels = Buffer.from(data);
  let changed = false;

  const darkFracAt = (x: number): number => {
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      if (data[y * width + x]! < darkLevel) dark += 1;
    }
    return dark / height;
  };
  // A printed separator reaches both slice edges (glare may break it midway); a tall digit
  // near the edge ("1g") leaves margin above and below.
  const reachesEnds = (x: number): boolean => {
    const edgeRows = Math.max(1, Math.round(height * 0.1));
    const darkInRows = (y0: number, y1: number) => {
      for (let y = y0; y < y1; y += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx >= 0 && xx < width && data[y * width + xx]! < darkLevel) return true;
        }
      }
      return false;
    };
    return darkInRows(0, edgeRows) && darkInRows(height - edgeRows, height);
  };

  for (const [zoneStart, zoneEnd, step] of [
    [0, Math.min(scan, width), 1],
    [width - 1, Math.max(width - scan, -1), -1],
  ] as const) {
    let runStart = -1;
    let runLength = 0;
    const flush = () => {
      if (runStart >= 0 && runLength <= maxRun) {
        for (let i = 0; i < runLength; i += 1) {
          const x = runStart + i * step;
          for (let y = 0; y < height; y += 1) pixels[y * width + x] = 255;
        }
        changed = true;
      }
      runStart = -1;
      runLength = 0;
    };
    for (let x = zoneStart; step === 1 ? x < zoneEnd : x > zoneEnd; x += step) {
      if (darkFracAt(x) >= minDarkFrac && reachesEnds(x)) {
        if (runStart < 0) runStart = x;
        runLength += 1;
      } else {
        flush();
      }
    }
    flush();
  }
  if (!changed) return png;
  return sharp(pixels, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

export function useRowBandSliceOcrForPlan(plan: SharedLabelValueGridPlan): boolean {
  const params = DEFAULT_SHARED_LABEL_GRID_PARAMS;
  const labelSlices = plan.labelRowBandSlices ?? plan.rowBandSlices;
  if (labelSlices.length < params.minRowBandSlicesForRowOcr) return false;
  const medianH = medianRowBandSliceHeight(labelSlices);
  if (medianH < params.rowBandOcrMinMedianSliceHeightPx) return false;
  const pitch = plan.rowPitchPx > 0 ? plan.rowPitchPx : medianH;
  if (pitch > 0 && medianH > pitch * params.rowBandMaxMedianSlicePitchRatio) return false;
  return true;
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
 * Ink profile often splits the shared label rail early; widen to the ruled wide-left column when present.
 */
export function alignSharedLabelBoundaryToRuledRail(
  pixels: Uint8Array,
  width: number,
  height: number,
  inkBoundaryX: number,
  sharedRailWidthRatioMin: number,
  minHorizontalRulesPerColumn: number = DEFAULT_RULED_TABLE_GRID_PARAMS.minHorizontalRulesPerColumn,
): number {
  const cats = categoriesFromRuledGrid(pixels, width, height, 0, undefined, 14, {
    requireHorizontalRules: false,
  });
  const first = cats[0];
  if (!first || first.x0 !== 0) return inkBoundaryX;
  const productCols = cats
    .slice(1)
    .filter((c) => c.horizontalRuleCount >= minHorizontalRulesPerColumn);
  const siblingWidths = productCols.map((c) => c.x1 - c.x0);
  const firstWidth = first.x1 - first.x0;
  if (firstColumnWideVsSiblings(firstWidth, siblingWidths, sharedRailWidthRatioMin)) {
    return Math.max(inkBoundaryX, first.x1);
  }
  const med = medianPositiveWidth(siblingWidths);
  if (med > 0 && firstWidth > inkBoundaryX && firstWidth >= med * 0.9) {
    return Math.max(inkBoundaryX, first.x1);
  }
  return inkBoundaryX;
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
export type SharedRailInkProfileOptions = {
  labelBoundaryX?: number;
  inkGridCropped?: boolean;
  inkGridCroppedMeta?: { labelBoundaryX: number; analysisW: number; tableRightAnalysisX?: number };
  sharedRailWidthRatioMin?: number;
};

export function sharedRailLayoutFromInkProfile(
  pixels: Uint8Array,
  width: number,
  height: number,
  profile: Float64Array,
  stripParams: ColumnStripDetectParams,
  shared: SharedLabelGridParams,
  maxColumns: number,
  options?: SharedRailInkProfileOptions,
): {
  labelColumn: { x0: number; x1: number; index: number; horizontalRuleCount: number };
  valueColumns: Array<{ x0: number; x1: number; index: number; horizontalRuleCount: number }>;
  labelBoundaryX: number;
  inkAsymmetry: number;
} | null {
  const inkBoundary = options?.labelBoundaryX ?? findLabelValueBoundary(profile, shared);
  if (inkBoundary === null) return null;
  const boundaryHint = options?.inkGridCroppedMeta?.labelBoundaryX ?? inkBoundary;
  const railRatio =
    options?.sharedRailWidthRatioMin ?? DEFAULT_VARIETY_PACK_GRID_PIPELINE_PARAMS.sharedRailWidthRatioMin;
  const boundaryX = alignSharedLabelBoundaryToRuledRail(
    pixels,
    width,
    height,
    Math.max(inkBoundary, boundaryHint),
    railRatio,
  );

  const labelWidthFrac = boundaryX / profile.length;
  if (labelWidthFrac < shared.labelColumnMinWidthFraction || labelWidthFrac > shared.labelColumnMaxWidthFraction) {
    return null;
  }

  const leftMean = meanInk(profile, 0, boundaryX);
  const rightMean = meanInk(profile, boundaryX, profile.length);
  const asymmetry = rightMean > 0 ? leftMean / rightMean : 0;
  const skipAsymmetry = options?.inkGridCropped === true || options?.inkGridCroppedMeta !== undefined;
  if (!skipAsymmetry && leftMean < rightMean * shared.labelInkAsymmetryRatio) return null;

  const segments = valueColumnBoundaries(
    pixels,
    width,
    height,
    boundaryX,
    stripParams,
    shared,
    maxColumns,
    options?.inkGridCroppedMeta
      ? {
          labelBoundaryX: options.inkGridCroppedMeta.labelBoundaryX,
          analysisW: options.inkGridCroppedMeta.analysisW,
          tableRightAnalysisX: options.inkGridCroppedMeta.tableRightAnalysisX,
        }
      : undefined,
  );
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
  inkGridCropped?: { labelBoundaryX: number; analysisW: number; tableRightAnalysisX?: number },
): Segment[] {
  const valueRight =
    inkGridCropped?.tableRightAnalysisX !== undefined
      ? inkGridCropped.tableRightAnalysisX
      : inkGridCropped
        ? nutritionTableRightAnalysisX(pixels, width, height, boundaryX)
        : nutritionTableRightAnalysisX(pixels, width, height, boundaryX);
  const luminanceRoles = classifyNutritionTableBandLuminance(
    pixels,
    width,
    height,
    boundaryX,
    {},
    inkGridCropped
      ? {
          inkGridCropped: {
            labelBoundaryX: inkGridCropped.labelBoundaryX,
            tableRightAnalysisX: inkGridCropped.tableRightAnalysisX ?? valueRight,
          },
          analysisW: inkGridCropped.analysisW,
        }
      : undefined,
  );
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
      valueRight,
      maxColumns,
    );
    const cv = columnWidthCv(refined.map((s) => s.x1 - s.x0));
    if (refined.length >= shared.minValueColumns && cv <= shared.maxValueColumnWidthCv) {
      const valueW = valueRight - boundaryX;
      const widths = refined.map((segment) => segment.x1 - segment.x0);
      const median = [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] ?? 0;
      const target = median > 0 ? Math.round(valueW / median) : 0;
      if (
        target >= shared.minValueColumns &&
        refined.length > target &&
        refined.length - target <= 2 &&
        cv <= shared.maxValueColumnWidthCv
      ) {
        return fitEqualWidthColumnGrid(boundaryX, valueRight, target);
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
