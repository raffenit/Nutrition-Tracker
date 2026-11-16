import {
  DEFAULT_SHARED_LABEL_GRID_PARAMS,
  type SharedLabelGridParams,
} from './sharedLabelGridParams.js';

/** Map analysis-space y to full-image y using the band that produced {@link prepareWideBandAnalysis} pixels. */
export function mapAnalysisYToImageBand(
  analysisY: number,
  analysisH: number,
  imageBandTop: number,
  imageBandHeight: number,
): number {
  return imageBandTop + Math.round((analysisY / Math.max(1, analysisH)) * imageBandHeight);
}

/** Map analysis-space x to full-image x on the same detection band. */
export function mapAnalysisXToImageBand(
  analysisX: number,
  analysisW: number,
  imageBandLeft: number,
  imageBandWidth: number,
): number {
  return imageBandLeft + Math.round((analysisX / Math.max(1, analysisW)) * imageBandWidth);
}

/** Inverse of {@link mapAnalysisXToImageBand} for reconciling image strips with analysis segments. */
export function mapImageXToAnalysisBand(
  imageX: number,
  analysisW: number,
  imageBandLeft: number,
  imageBandWidth: number,
): number {
  return Math.round(((imageX - imageBandLeft) / Math.max(1, imageBandWidth)) * analysisW);
}

/** @deprecated Use {@link mapAnalysisYToImageBand} — geometry must match the detection band, not the OCR inset band. */
export const mapAnalysisYToOcrBand = mapAnalysisYToImageBand;

export type SharedLabelRowBandSlice = {
  rowIndex: number;
  top: number;
  height: number;
  /** Column warp: right edge of the top border is {@link top} + topSkewPx (image y). */
  topSkewPx?: number;
  /** Column warp: right edge of the bottom border is top + height + bottomSkewPx. */
  bottomSkewPx?: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function medianConsecutiveSpacing(ys: number[]): number {
  if (ys.length < 2) return 0;
  const spacings: number[] = [];
  for (let i = 1; i < ys.length; i += 1) {
    const d = ys[i]! - ys[i - 1]!;
    if (d > 0) spacings.push(d);
  }
  return median(spacings);
}

/** Minimum gap between distinct row rules (fraction of row pitch; merges double hairlines). */
export function rowBandRuleMinSpacingPx(
  pitch: number,
  grid: Pick<SharedLabelGridParams, 'rowBandRuleMinSpacingPitchFraction'> = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): number {
  if (pitch <= 0) return 4;
  return Math.max(4, Math.round(pitch * grid.rowBandRuleMinSpacingPitchFraction));
}

/** Drop rules that sit closer than one nutrient row pitch (double horizontal lines, jitter duplicates). */
export function consolidateRowBandRuleYs(ruleYs: number[], minSpacing: number): number[] {
  if (ruleYs.length <= 1 || minSpacing <= 0) return [...ruleYs].sort((a, b) => a - b);
  const sorted = [...ruleYs].sort((a, b) => a - b);
  const out: number[] = [];
  for (const y of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || y - last >= minSpacing) out.push(y);
  }
  return out;
}

/** Horizontal slices between consensus rule lines (nutrient row bodies, not footer). */
export function rowBandSlicesBetweenRules(
  bodyTop: number,
  bodyBottom: number,
  ruleYsImage: number[],
  minSliceHeight = 8,
  ruleBoundaryBiasPx = 0,
): SharedLabelRowBandSlice[] {
  const rules = [...ruleYsImage].sort((a, b) => a - b).filter((y) => y > bodyTop + 2 && y < bodyBottom - 2);
  const shifted =
    ruleBoundaryBiasPx > 0 ? rules.map((y) => y + ruleBoundaryBiasPx) : rules;
  const edges = [bodyTop, ...shifted, bodyBottom].map((y) => Math.round(y));
  const slices: SharedLabelRowBandSlice[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const top = edges[i]!;
    const height = edges[i + 1]! - top;
    if (height >= minSliceHeight) slices.push({ rowIndex: i, top, height });
  }
  return slices;
}

/** Widen short row bands so glyphs in the center of the cell are not clipped on small tables. */
export function expandRowBandSlicesToMinReadableHeight(
  slices: SharedLabelRowBandSlice[],
  pitchPx: number,
  grid: Pick<
    SharedLabelGridParams,
    | 'rowBandSliceMinReadableHeightPitchFraction'
    | 'rowBandSliceMinReadableHeightFloorPx'
    | 'rowBandSliceExpandOverlapPx'
    | 'minRowBandSliceHeightPx'
  >,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || pitchPx <= 0) return slices;
  const target = Math.max(
    grid.minRowBandSliceHeightPx,
    grid.rowBandSliceMinReadableHeightFloorPx,
    Math.round(pitchPx * grid.rowBandSliceMinReadableHeightPitchFraction),
  );
  const overlap = Math.max(0, grid.rowBandSliceExpandOverlapPx);
  const out = slices.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i++) {
    const slice = out[i]!;
    if (slice.height >= target) continue;
    const deficit = target - slice.height;
    const prevBottom = i > 0 ? out[i - 1]!.top + out[i - 1]!.height : slice.top;
    const nextTop = i < out.length - 1 ? out[i + 1]!.top : slice.top + slice.height;
    const roomAbove = Math.max(0, slice.top - prevBottom + overlap);
    const roomBelow = Math.max(0, nextTop - (slice.top + slice.height) + overlap);
    const growUp = Math.min(Math.ceil(deficit / 2), roomAbove);
    const growDown = Math.min(deficit - growUp, roomBelow);
    const grown = growUp + growDown;
    if (grown <= 0) continue;
    out[i] = { rowIndex: slice.rowIndex, top: slice.top - growUp, height: slice.height + grown };
  }
  return out;
}

/** After height expansion, prevent bands from overlapping (e.g. calories band eating % Daily Value). */
export function disjointRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  _overlapPx = 0,
): SharedLabelRowBandSlice[] {
  if (slices.length <= 1) return slices;
  const out = slices.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i += 1) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    const prevBottom = prev.top + prev.height;
    if (cur.top < prevBottom) {
      prev.height = Math.max(4, cur.top - prev.top);
    }
  }
  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Merge only hairline slivers (shorter than minHeight) into an adjacent row band. */
export function mergeSmallRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  minHeight: number,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || minHeight <= 0) return slices;

  const merged: SharedLabelRowBandSlice[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    let slice = { ...slices[i]! };
    if (slice.height >= minHeight) {
      merged.push(slice);
      continue;
    }
    if (merged.length > 0) {
      const last = merged[merged.length - 1]!;
      merged[merged.length - 1] = {
        rowIndex: last.rowIndex,
        top: last.top,
        height: last.height + slice.height,
      };
      continue;
    }
    if (i + 1 < slices.length) {
      const next = slices[i + 1]!;
      slice = {
        rowIndex: slice.rowIndex,
        top: slice.top,
        height: slice.height + next.height,
      };
      i += 1;
    }
    merged.push(slice);
  }

  return merged.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Split bands taller than ~one pitch when a horizontal ink rule falls inside the span (curved packs). */
export function subdivideOversizedRowBandsAtRules(
  slices: SharedLabelRowBandSlice[],
  ruleYs: number[],
  pooledPitch: number,
  maxHeightPitchFraction = 1.12,
  /** Do not split the closing nutrient band when it spans many pitches to the footer rule. */
  skipFooterSpanPitchMultiple = 0,
): SharedLabelRowBandSlice[] {
  const maxH = Math.max(12, Math.round(pooledPitch * maxHeightPitchFraction));
  const splitTol = Math.max(2, Math.round(pooledPitch * 0.08));
  const sortedRules = [...ruleYs].sort((a, b) => a - b);
  const out: SharedLabelRowBandSlice[] = [];
  for (let i = 0; i < slices.length; i += 1) {
    const slice = slices[i]!;
    const bottom = slice.top + slice.height;
    const interior = sortedRules.filter((y) => y > slice.top + splitTol && y < bottom - splitTol);
    const isLast = i === slices.length - 1;
    if (
      isLast &&
      skipFooterSpanPitchMultiple > 0 &&
      slice.height > pooledPitch * skipFooterSpanPitchMultiple
    ) {
      out.push({ ...slice });
      continue;
    }
    if (slice.height <= maxH || interior.length === 0) {
      out.push({ ...slice });
      continue;
    }
    let top = slice.top;
    const cuts = [...interior, bottom];
    for (const cut of cuts) {
      const h = cut - top;
      if (h >= 4) {
        out.push({
          rowIndex: out.length,
          top,
          height: h,
          topSkewPx: slice.topSkewPx ?? 0,
          bottomSkewPx: slice.bottomSkewPx ?? 0,
        });
      }
      top = cut;
    }
  }
  return disjointRowBandSlices(out).map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Drop footer/tail slivers that sit inside the previous band (skew + extendLastBodySliceToFooterY). */
export function collapseContainedRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  pooledPitch: number,
): SharedLabelRowBandSlice[] {
  const minH = Math.max(8, Math.round(pooledPitch * 0.32));
  if (slices.length < 2) return slices;
  const out: SharedLabelRowBandSlice[] = [];
  for (const slice of slices) {
    const last = out[out.length - 1];
    if (last) {
      const lastBottom = last.top + last.height;
      if (slice.top >= last.top - 1 && slice.top + slice.height <= lastBottom + 2 && slice.height < minH) {
        continue;
      }
      if (slice.top < lastBottom && slice.height < minH) {
        out[out.length - 1] = {
          ...last,
          height: Math.max(minH, slice.top + slice.height - last.top),
        };
        continue;
      }
    }
    out.push({ ...slice });
  }
  return disjointRowBandSlices(out).map((s, rowIndex) => ({ ...s, rowIndex }));
}

/**
 * Skewed outer columns can leave interior ink rules as 10–15px slivers between real rows.
 * Snap unreadable bands back to consensus tops/heights while keeping column skew on the quad.
 */
export function repairHairlineNutrientBands(
  slices: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  pooledPitch: number,
  grid: Pick<SharedLabelGridParams, 'rowBandMergeHairlinePitchFraction'> = DEFAULT_SHARED_LABEL_GRID_PARAMS,
  preserveInkWarp = false,
): SharedLabelRowBandSlice[] {
  const minHeight = Math.max(8, Math.round(pooledPitch * grid.rowBandMergeHairlinePitchFraction));
  if (slices.length === 0 || reference.length === 0) return slices;
  if (slices.length !== reference.length) {
    return slices.map((slice, rowIndex) => ({ ...slice, rowIndex }));
  }
  return slices.map((slice, i) => {
    const ref = reference[i]!;
    if (slice.height >= minHeight) {
      return { ...slice, rowIndex: i };
    }
    if (preserveInkWarp) {
      return {
        rowIndex: i,
        top: slice.top,
        height: Math.max(minHeight, slice.height, ref.height),
        topSkewPx: slice.topSkewPx ?? 0,
        bottomSkewPx: slice.bottomSkewPx ?? 0,
      };
    }
    return {
      rowIndex: i,
      top: ref.top,
      height: ref.height,
      topSkewPx: 0,
      bottomSkewPx: 0,
    };
  });
}

/** Image Y for the bottom ruled line closing the nutrient table (not just last interior row). */
export function nutrientTableClosingFooterY(
  bodyTop: number,
  bodyBottom: number,
  imageBandBottom: number,
  pooledPitch: number,
  meshRuleYsImage: number[],
  referenceNutrients: SharedLabelRowBandSlice[],
): number {
  const refFooter =
    referenceNutrients[referenceNutrients.length - 1]!.top +
    referenceNutrients[referenceNutrients.length - 1]!.height;
  const pitch = Math.max(8, pooledPitch);
  const bandCap = imageBandBottom - Math.max(6, Math.round(pitch * 0.12));
  const rules = [...meshRuleYsImage, bodyBottom]
    .filter((y) => y > bodyTop + 4 && y <= imageBandBottom + 2)
    .sort((a, b) => a - b);
  const trailingRule = rules.length > 0 ? rules[rules.length - 1]! : bodyBottom;
  const ruleFooter = trailingRule + Math.round(pitch * 0.92);
  return Math.min(bandCap, Math.max(refFooter, ruleFooter));
}

/** Extend the last body band (vitamins/footer row) through the closing table rule. */
export function extendLastBodySliceToFooterY(
  slices: SharedLabelRowBandSlice[],
  footerY: number,
  nutrientStartY: number,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0) return slices;
  const out = slices.map((s) => ({ ...s }));
  let lastIdx = -1;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i]!.top >= nutrientStartY - 2) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx < 0) return out;
  const last = out[lastIdx]!;
  const minH = 8;
  out[lastIdx] = {
    ...last,
    height: Math.max(minH, footerY - last.top),
  };
  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/**
 * Curved outer columns: vitamin/supplement tail rows drift from skewed ink — snap back to
 * consensus tops/heights while keeping skew quads (macro rows above stay warp-driven).
 */
export function alignWarpedNutrientTailToConsensus(
  nutrients: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  pooledPitch: number,
  grid: Pick<
    SharedLabelGridParams,
    'rowBandMergeHairlinePitchFraction' | 'warpNutrientTailAlignRowCount' | 'warpNutrientTailMaxTopDriftPitchFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): SharedLabelRowBandSlice[] {
  const minH = Math.max(8, Math.round(pooledPitch * grid.rowBandMergeHairlinePitchFraction));
  if (nutrients.length === 0 || reference.length === 0 || nutrients.length !== reference.length) {
    return nutrients;
  }
  const tailStart =
    nutrients.length >= grid.warpNutrientTailAlignRowCount
      ? Math.max(0, nutrients.length - grid.warpNutrientTailAlignRowCount)
      : nutrients.length;
  return nutrients.map((slice, i) => {
    const ref = reference[i]!;
    if (i < tailStart) return { ...slice, rowIndex: i };
    const isLast = i === nutrients.length - 1;
    return {
      rowIndex: i,
      top: ref.top,
      height: isLast ? Math.max(minH, slice.height) : ref.height,
      topSkewPx: 0,
      bottomSkewPx: 0,
    };
  });
}

/** Max trapezoid skew (px) for row warps — keeps quads on the label, not off the band. */
export function maxRowSurfaceSkewPx(
  pooledPitch: number,
  grid: Pick<SharedLabelGridParams, 'rowSurfaceSkewMinPx' | 'rowSurfaceSkewMaxPitchFraction'> =
    DEFAULT_SHARED_LABEL_GRID_PARAMS,
): number {
  return Math.max(
    grid.rowSurfaceSkewMinPx,
    Math.round(pooledPitch * grid.rowSurfaceSkewMaxPitchFraction),
  );
}

export function outerColumnRowSurfaceSkewCapPx(
  pooledPitch: number,
  grid: Pick<
    SharedLabelGridParams,
    'rowSurfaceSkewMinPx' | 'rowSurfaceSkewOuterColumnMaxPitchFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
): number {
  return Math.max(
    grid.rowSurfaceSkewMinPx,
    Math.round(pooledPitch * grid.rowSurfaceSkewOuterColumnMaxPitchFraction),
  );
}

export function clampRowBandSliceSkew(
  slices: SharedLabelRowBandSlice[],
  pooledPitch: number,
  skewCapPx?: number,
): SharedLabelRowBandSlice[] {
  const cap = skewCapPx ?? maxRowSurfaceSkewPx(pooledPitch);
  return slices.map((slice, rowIndex) => ({
    ...slice,
    rowIndex,
    topSkewPx: Math.max(0, Math.min(cap, slice.topSkewPx ?? 0)),
    bottomSkewPx: Math.max(0, Math.min(cap, slice.bottomSkewPx ?? 0)),
  }));
}

/**
 * Perspective outer columns: keep consensus shared-rail tops/heights but ramp trapezoid skew from
 * zero at the preamble to {@link footerSpreadPx} at the closing footer rule (package fan).
 */
export function fanWarpedNutrientSkewFromFooterRule(
  nutrients: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  preambleEndY: number,
  footerY: number,
  footerSpreadPx: number,
  tailStartRow: number,
  skewMinPx: number,
): SharedLabelRowBandSlice[] {
  if (nutrients.length === 0 || reference.length === 0 || nutrients.length !== reference.length) {
    return nutrients;
  }
  const fanSpread = Math.max(skewMinPx, Math.abs(footerSpreadPx));
  const fanFloorY = reference[0]?.top ?? preambleEndY;
  const span = Math.max(8, footerY - fanFloorY);
  return nutrients.map((slice, i) => {
    const ref = reference[i]!;
    if (i >= tailStartRow) {
      const isClosingFooter = i === nutrients.length - 1;
      const height = isClosingFooter ? Math.max(ref.height, slice.height) : ref.height;
      if (isClosingFooter) {
        const topT = Math.max(0, Math.min(1, (ref.top - fanFloorY) / span));
        return {
          rowIndex: i,
          top: ref.top,
          height,
          topSkewPx: Math.round(fanSpread * topT),
          bottomSkewPx: fanSpread,
        };
      }
      return {
        rowIndex: i,
        top: ref.top,
        height,
        topSkewPx: 0,
        bottomSkewPx: 0,
      };
    }
    const isLast = i === nutrients.length - 1;
    const height = isLast ? Math.max(ref.height, slice.height) : ref.height;
    const topT = Math.max(0, Math.min(1, (ref.top - fanFloorY) / span));
    const bottomT = Math.max(0, Math.min(1, (ref.top + height - fanFloorY) / span));
    return {
      rowIndex: i,
      top: ref.top,
      height,
      topSkewPx: Math.round(fanSpread * topT),
      bottomSkewPx: Math.round(fanSpread * bottomT),
    };
  });
}

/** Snap macro rows whose tops drifted from consensus while skewed ink still produced ~ref height. */
export function alignWarpedNutrientTopsWhereDrifted(
  nutrients: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  pooledPitch: number,
  tailStartRow: number,
  maxTopDriftPitchFraction = 0.12,
): SharedLabelRowBandSlice[] {
  const maxTopDrift = Math.max(4, Math.round(pooledPitch * maxTopDriftPitchFraction));
  if (nutrients.length !== reference.length) return nutrients;
  return nutrients.map((slice, i) => {
    if (i >= tailStartRow) return { ...slice, rowIndex: i };
    const ref = reference[i]!;
    if (Math.abs(slice.top - ref.top) <= maxTopDrift) return { ...slice, rowIndex: i };
    return {
      rowIndex: i,
      top: ref.top,
      height: ref.height,
      topSkewPx: 0,
      bottomSkewPx: 0,
    };
  });
}

/** Pin warped nutrient spans to consensus first-row top and closing footer (shared rail). */
export function alignNutrientSpanBordersToConsensus(
  nutrients: SharedLabelRowBandSlice[],
  reference: SharedLabelRowBandSlice[],
  pooledPitch: number,
  footerBottomY?: number,
  pinFirstNutrientTop = true,
): SharedLabelRowBandSlice[] {
  const minH = Math.max(
    8,
    Math.round(pooledPitch * DEFAULT_SHARED_LABEL_GRID_PARAMS.rowBandMergeHairlinePitchFraction),
  );
  if (nutrients.length === 0 || reference.length === 0 || nutrients.length !== reference.length) {
    return nutrients;
  }
  const refFirst = reference[0]!;
  const refLast = reference[reference.length - 1]!;
  const footerY = footerBottomY ?? refLast.top + refLast.height;
  const out = nutrients.map((s) => ({ ...s }));

  if (pinFirstNutrientTop) {
    const first = out[0]!;
    const firstBottom = first.top + first.height;
    out[0] = {
      ...first,
      top: refFirst.top,
      height: Math.max(minH, firstBottom - refFirst.top),
    };
  }

  const last = out[out.length - 1]!;
  out[out.length - 1] = {
    ...last,
    height: Math.max(minH, footerY - last.top),
  };

  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

/** Equal ~pitch chunks when a band spans multiple nutrient rows but has no interior rule Y. */
function subdivideOversizedSliceByPitch(
  slice: SharedLabelRowBandSlice,
  pitch: number,
  maxSlicePitchRatio: number,
): SharedLabelRowBandSlice[] {
  const maxH = pitch * maxSlicePitchRatio;
  if (slice.height <= maxH + 0.5) return [slice];
  const targetRows = Math.max(2, Math.ceil(slice.height / Math.max(8, pitch)));
  const parts: SharedLabelRowBandSlice[] = [];
  let top = slice.top;
  let remaining = slice.height;
  for (let i = 0; i < targetRows && remaining > 0; i += 1) {
    const rowsLeft = targetRows - i;
    const h =
      rowsLeft === 1
        ? remaining
        : Math.min(remaining, Math.max(Math.round(pitch), Math.round(remaining / rowsLeft)));
    parts.push({ rowIndex: 0, top, height: h });
    top += h;
    remaining -= h;
  }
  return parts;
}

/**
 * Subdivide bands taller than one nutrient row using interior consensus rules
 * (e.g. preamble + first row merged into one slice).
 */
export function splitOversizedRowBandSlices(
  slices: SharedLabelRowBandSlice[],
  ruleYs: number[],
  pitch: number,
  maxSlicePitchRatio: number,
  minGapBetweenSubSlices: number,
  pitchSubdivideMinMultiplier = 2.35,
): SharedLabelRowBandSlice[] {
  if (slices.length === 0 || pitch <= 0 || maxSlicePitchRatio <= 0) return slices;
  const maxHeight = pitch * maxSlicePitchRatio;
  const sortedRules = [...ruleYs].sort((a, b) => a - b);
  const minSub = Math.max(4, minGapBetweenSubSlices);

  const out: SharedLabelRowBandSlice[] = [];
  for (const slice of slices) {
    if (slice.height <= maxHeight + 0.5) {
      out.push(slice);
      continue;
    }
    const bottom = slice.top + slice.height;
    const innerRules = sortedRules.filter(
      (y) => y > slice.top + minSub && y < bottom - minSub,
    );
    if (innerRules.length === 0) {
      const heightPitch = slice.height / pitch;
      if (heightPitch >= 1.85 && heightPitch <= 2.4) {
        const mid = slice.top + Math.round(pitch);
        const h1 = mid - slice.top;
        const h2 = bottom - mid;
        if (h1 >= minSub && h2 >= minSub) {
          out.push({ rowIndex: 0, top: slice.top, height: h1 });
          out.push({ rowIndex: 0, top: mid, height: h2 });
          continue;
        }
      }
      out.push(slice);
      continue;
    }
    const subs = rowBandSlicesBetweenRules(slice.top, bottom, innerRules, Math.max(4, Math.round(minSub * 0.5)));
    if (subs.length <= 1) {
      out.push(slice);
      continue;
    }
    out.push(...subs);
  }
  return out.map((slice, rowIndex) => ({ ...slice, rowIndex }));
}

export function medianRowBandSliceHeight(slices: SharedLabelRowBandSlice[]): number {
  if (slices.length === 0) return 0;
  return median(slices.map((s) => s.height));
}

export function prepareRowBandSlicesForOcr(
  bodyTop: number,
  bodyBottom: number,
  ruleYsImage: number[],
  grid: Pick<
    SharedLabelGridParams,
    | 'rowBandRuleMinSpacingPitchFraction'
    | 'minRowBandSliceHeightPx'
    | 'minRowBandSliceHeightPitchFraction'
    | 'rowBandMergeHairlinePitchFraction'
    | 'rowBandSplitOversizedPitchRatio'
    | 'rowBandPitchSubdivideMinMultiplier'
    | 'rowBandSliceMinReadableHeightPitchFraction'
    | 'rowBandSliceMinReadableHeightFloorPx'
    | 'rowBandSliceExpandOverlapPx'
  >,
): { slices: SharedLabelRowBandSlice[]; rowPitchPx: number } {
  const sortedRules = [...ruleYsImage].sort((a, b) => a - b);
  const coarsePitch = medianConsecutiveSpacing(sortedRules);
  const ruleMinGap =
    coarsePitch > 0
      ? Math.max(2, Math.round(coarsePitch * grid.rowBandRuleMinSpacingPitchFraction))
      : grid.minRowBandSliceHeightPx;
  const consolidated = consolidateRowBandRuleYs(sortedRules, ruleMinGap);
  const rulesInBody = consolidated.filter((y) => y > bodyTop + 2 && y < bodyBottom - 2);
  const pitch = medianConsecutiveSpacing(rulesInBody.length >= 2 ? rulesInBody : consolidated);
  const minBetweenRules = Math.max(
    4,
    pitch > 0 ? Math.round(pitch * grid.minRowBandSliceHeightPitchFraction * 0.35) : 4,
  );
  const slices = rowBandSlicesBetweenRules(bodyTop, bodyBottom, consolidated, minBetweenRules);
  const mergeHairlineBelow =
    pitch > 0
      ? Math.max(grid.minRowBandSliceHeightPx, Math.round(pitch * grid.rowBandMergeHairlinePitchFraction))
      : grid.minRowBandSliceHeightPx;
  const merged = mergeSmallRowBandSlices(slices, mergeHairlineBelow);
  const splitRules = rulesInBody.length > 0 ? consolidated : sortedRules;
  const split = splitOversizedRowBandSlices(
    merged,
    splitRules,
    pitch,
    grid.rowBandSplitOversizedPitchRatio,
    mergeHairlineBelow,
    grid.rowBandPitchSubdivideMinMultiplier,
  );
  const finalSlices = mergeSmallRowBandSlices(split, mergeHairlineBelow);
  const expanded = expandRowBandSlicesToMinReadableHeight(finalSlices, pitch, grid);
  const disjoint = disjointRowBandSlices(expanded, grid.rowBandSliceExpandOverlapPx);
  return { slices: disjoint, rowPitchPx: pitch };
}

export function nutrientBodyExtents(
  analysisH: number,
  bodyTopAnalysisY: number,
  rowBandYsAnalysis: number[],
  imageBandTop: number,
  imageBandHeight: number,
  grid: Pick<
    SharedLabelGridParams,
    | 'bodyFooterMarginFraction'
    | 'nutrientBodyTrailingRowMinGapPitchFraction'
    | 'nutrientBodyTrailingRowMaxGapPitchFraction'
    | 'rowBandRuleMinSpacingPitchFraction'
    | 'minRowBandSliceHeightPx'
    | 'minRowBandSliceHeightPitchFraction'
    | 'rowBandMergeHairlinePitchFraction'
    | 'rowBandSplitOversizedPitchRatio'
    | 'rowBandPitchSubdivideMinMultiplier'
    | 'rowBandSliceMinReadableHeightPitchFraction'
    | 'rowBandSliceMinReadableHeightFloorPx'
    | 'rowBandSliceExpandOverlapPx'
  >,
  options?: { extendThroughRuleYImage?: number },
): {
  top: number;
  height: number;
  rowBandSlices: SharedLabelRowBandSlice[];
  rowPitchPx: number;
  rowBandYsAnalysis: number[];
} {
  const mapY = (y: number) => mapAnalysisYToImageBand(y, analysisH, imageBandTop, imageBandHeight);
  const mapToAnalysis = (yImage: number) => analysisYFromImageBand(yImage, analysisH, imageBandTop, imageBandHeight);
  const bodyTop = mapY(bodyTopAnalysisY);
  let ruleYsAnalysis = [...rowBandYsAnalysis];
  let ruleYsImage = ruleYsAnalysis.map(mapY);
  const bandBottom = imageBandTop + imageBandHeight;
  const footerPad = Math.round(imageBandHeight * grid.bodyFooterMarginFraction);
  const tableBottom = bandBottom - footerPad;

  let bodyBottom = tableBottom;
  if (ruleYsImage.length >= 2) {
    const pitch = medianConsecutiveSpacing(ruleYsImage);
    if (pitch > 0) {
      const lastRule = ruleYsImage[ruleYsImage.length - 1]!;
      const oneRowBottom = lastRule + pitch;
      const slackPitch = (bandBottom - oneRowBottom) / pitch;
      if (
        slackPitch >= grid.nutrientBodyTrailingRowMinGapPitchFraction &&
        slackPitch < grid.nutrientBodyTrailingRowMaxGapPitchFraction
      ) {
        const splitY = lastRule + pitch;
        if (!ruleYsImage.some((y) => Math.abs(y - splitY) <= Math.max(2, Math.round(pitch * 0.12)))) {
          ruleYsImage = [...ruleYsImage, splitY];
          ruleYsAnalysis = [...ruleYsAnalysis, mapToAnalysis(splitY)];
        }
        bodyBottom = Math.min(bandBottom, lastRule + pitch * 2);
      } else {
        bodyBottom = Math.min(bandBottom, Math.max(tableBottom, oneRowBottom));
      }
    }
  }

  if (ruleYsImage.length >= 1) {
    const pitch =
      medianConsecutiveSpacing(ruleYsImage) ||
      (options?.extendThroughRuleYImage && options.extendThroughRuleYImage > bodyTop
        ? options.extendThroughRuleYImage - bodyTop
        : 0);
    const deepRule = options?.extendThroughRuleYImage;
    if (pitch > 0 && deepRule !== undefined && deepRule > bodyTop + 4) {
      const throughBottom = Math.min(bandBottom, deepRule + pitch * 1.65);
      bodyBottom = Math.max(bodyBottom, throughBottom);
      const tailRule = deepRule;
      if (
        tailRule > bodyTop + 4 &&
        !ruleYsImage.some((y) => Math.abs(y - tailRule) <= Math.max(3, Math.round(pitch * 0.15)))
      ) {
        ruleYsImage = [...ruleYsImage, tailRule].sort((a, b) => a - b);
        ruleYsAnalysis = ruleYsImage.map((y) => mapToAnalysis(y));
      }
    }
  }

  let height = Math.max(8, bodyBottom - bodyTop);
  let bodyBottomY = bodyTop + height;
  const rulesBeforeSlice = [...ruleYsImage]
    .sort((a, b) => a - b)
    .filter((y) => y > bodyTop + 2 && y < bodyBottomY - 2);
  const closingPitch = medianConsecutiveSpacing(rulesBeforeSlice);
  if (rulesBeforeSlice.length >= 1 && closingPitch > 0) {
    const lastRuleY = rulesBeforeSlice[rulesBeforeSlice.length - 1]!;
    const tailGap = bodyBottomY - lastRuleY;
    if (tailGap > closingPitch * 1.28) {
      const penultimateRuleY = lastRuleY + Math.round(closingPitch);
      const nearTol = Math.max(3, Math.round(closingPitch * 0.14));
      if (
        penultimateRuleY < bodyBottomY - 4 &&
        !ruleYsImage.some((y) => Math.abs(y - penultimateRuleY) <= nearTol)
      ) {
        ruleYsImage = [...ruleYsImage, penultimateRuleY].sort((a, b) => a - b);
        ruleYsAnalysis = ruleYsImage.map((y) => mapToAnalysis(y));
      }
      bodyBottomY = Math.min(bodyBottomY, penultimateRuleY + Math.round(closingPitch * 1.08));
      height = Math.max(8, bodyBottomY - bodyTop);
    }
  }

  const rowBands = prepareRowBandSlicesForOcr(bodyTop, bodyBottomY, ruleYsImage, grid);
  return {
    top: bodyTop,
    height,
    rowBandSlices: rowBands.slices,
    rowPitchPx: rowBands.rowPitchPx > 0 ? rowBands.rowPitchPx : medianRowBandSliceHeight(rowBands.slices),
    rowBandYsAnalysis: ruleYsAnalysis,
  };
}

function analysisYFromImageBand(
  yImage: number,
  analysisH: number,
  imageBandTop: number,
  imageBandHeight: number,
): number {
  return Math.round(((yImage - imageBandTop) / Math.max(1, imageBandHeight)) * analysisH);
}
