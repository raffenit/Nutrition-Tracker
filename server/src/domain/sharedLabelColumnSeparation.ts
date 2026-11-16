import type { BandLuminanceRoles } from './bandLuminanceRoles.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from './ruledTableGridParams.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS, type SharedLabelGridParams } from './sharedLabelGridParams.js';
import { inkProfileGutterThreshold } from '../integrations/bandLuminanceCluster.js';
import { medianPositiveWidth } from '../integrations/uniformColumnGeometry.js';
import { mapImageXToAnalysisBand } from './sharedLabelGridLayout.js';
import { extractRowLabels, extractValueLines } from './stitchSharedLabelGridTexts.js';

export type AnalysisValueColumnSegment = { x0: number; x1: number };

export type SharedLabelImageStripRegion = {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Index into `step3.valueColumns` / `productSegments` before label-disjoint filtering. */
  sourceStep3Index?: number;
};

/** Analysis-band segments strictly on the product side of {@link labelBoundaryX}. */
export function productValueSegmentsRightOfLabel(
  segments: Array<{ x0: number; x1: number }>,
  labelBoundaryX: number,
  minWidthAnalysisPx = 2,
): Array<{ x0: number; x1: number }> {
  return segments
    .map((seg) => ({
      x0: Math.max(seg.x0, labelBoundaryX),
      x1: seg.x1,
    }))
    .filter((seg) => seg.x1 - seg.x0 >= minWidthAnalysisPx);
}

/** Clamp image-space value crops so none overlap the label rail strip. */
export function enforceValueColumnsDisjointFromLabel(
  labelColumn: SharedLabelImageStripRegion,
  valueColumns: SharedLabelImageStripRegion[],
): SharedLabelImageStripRegion[] {
  const labelRight = labelColumn.left + labelColumn.width;
  const kept: SharedLabelImageStripRegion[] = [];
  for (let i = 0; i < valueColumns.length; i += 1) {
    const col = valueColumns[i]!;
    if (col.left + col.width <= labelRight) continue;
    const left = Math.max(col.left, labelRight);
    const width = col.left + col.width - left;
    if (width < 1) continue;
    kept.push({
      ...col,
      index: kept.length,
      sourceStep3Index: i,
      left,
      width,
    });
  }
  return kept;
}

/**
 * One analysis segment per disjoint image strip — same order as {@link enforceValueColumnsDisjointFromLabel}.
 * Row warp probes, glare masks, and viz must use this; not raw step-3 value columns (label-bleed offsets).
 */
function analysisSegmentForDisjointImageStrip(
  strip: SharedLabelImageStripRegion,
  productSegments: AnalysisValueColumnSegment[],
  imageBand: { left: number; width: number },
  analysisW: number,
  labelBoundaryAnalysisX: number,
  labelRightImage: number,
): AnalysisValueColumnSegment {
  const x0Img = Math.max(labelRightImage, strip.left);
  const x1Img = strip.left + strip.width;
  const x0Mapped = mapImageXToAnalysisBand(x0Img, analysisW, imageBand.left, imageBand.width);
  const x1Mapped = mapImageXToAnalysisBand(x1Img, analysisW, imageBand.left, imageBand.width);
  const center = (x0Mapped + x1Mapped) / 2;

  let best: AnalysisValueColumnSegment | undefined;
  let bestOverlap = -1;
  for (const seg of productSegments) {
    const overlap = Math.min(seg.x1, x1Mapped) - Math.max(seg.x0, x0Mapped);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = seg;
    }
  }
  const byCenter = productSegments.find((seg) => center >= seg.x0 && center < seg.x1);
  if (byCenter) return { ...byCenter };
  if (best && bestOverlap > 0) return { ...best };

  const x0 = Math.max(labelBoundaryAnalysisX, x0Mapped);
  const x1 = Math.max(x0 + 1, x1Mapped);
  return { x0, x1 };
}

export function valueColumnAnalysisSegmentsAligned(
  productSegments: AnalysisValueColumnSegment[],
  valueColumnsBeforeDisjoint: SharedLabelImageStripRegion[],
  valueColumnsDisjoint: SharedLabelImageStripRegion[],
  labelColumn: SharedLabelImageStripRegion,
  imageBand: { left: number; width: number },
  analysisW: number,
  labelBoundaryAnalysisX: number,
): AnalysisValueColumnSegment[] {
  const labelRightImage = labelColumn.left + labelColumn.width;
  return valueColumnsDisjoint.map((strip) => {
    const source = strip.sourceStep3Index;
    if (source !== undefined && productSegments[source]) {
      return { ...productSegments[source]! };
    }
    return analysisSegmentForDisjointImageStrip(
      strip,
      productSegments,
      imageBand,
      analysisW,
      labelBoundaryAnalysisX,
      labelRightImage,
    );
  });
}

function pixelCountsAsColumnInk(value: number, roles: BandLuminanceRoles, inkLevel: number): boolean {
  const capped = Math.min(value, roles.glareCap);
  if (roles.polarity === 'dark_on_light') return capped < inkLevel;
  return capped > inkLevel;
}

function valueColumnBodyInkExtentsInSpan(
  pixels: Uint8Array,
  width: number,
  bodyTopY: number,
  bodyBottomY: number,
  segment: AnalysisValueColumnSegment,
  roles: BandLuminanceRoles,
  occupancyFraction: number,
): { x0: number; x1: number } | null {
  const y0 = Math.max(0, Math.round(bodyTopY));
  const y1 = Math.min(width > 0 ? pixels.length / width : 0, Math.round(bodyBottomY));
  if (y1 <= y0 + 4 || segment.x1 <= segment.x0 + 2) return null;
  const { level } = inkProfileGutterThreshold(roles, DEFAULT_RULED_TABLE_GRID_PARAMS.gutterBrightnessMinFraction);
  const scores: number[] = [];
  for (let x = segment.x0; x < segment.x1; x += 1) {
    let ink = 0;
    let n = 0;
    for (let y = y0; y < y1; y += 1) {
      if (pixelCountsAsColumnInk(pixels[y * width + x]!, roles, level)) ink += 1;
      n += 1;
    }
    scores.push(n > 0 ? ink / n : 0);
  }
  const thresh = Math.max(0.02, occupancyFraction);
  let l = segment.x1 - 1;
  let r = segment.x0;
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i]! > thresh) {
      l = Math.min(l, segment.x0 + i);
      r = Math.max(r, segment.x0 + i);
    }
  }
  if (r <= l) return null;
  return { x0: l, x1: r };
}

/** Dense nutrient text occupancy within a ruled stack on the body band (analysis x). */
export function valueColumnBodyInkExtentsAnalysisX(
  pixels: Uint8Array,
  width: number,
  bodyTopY: number,
  bodyBottomY: number,
  segment: AnalysisValueColumnSegment,
  roles: BandLuminanceRoles,
  occupancyFraction: number = DEFAULT_SHARED_LABEL_GRID_PARAMS.valueColumnAnalysisBoundsInkOccupancyFraction,
): { x0: number; x1: number } | null {
  const full = valueColumnBodyInkExtentsInSpan(
    pixels,
    width,
    bodyTopY,
    bodyBottomY,
    segment,
    roles,
    occupancyFraction,
  );
  if (!full) return null;
  const colW = segment.x1 - segment.x0;
  const probeW = Math.max(3, Math.min(Math.round(colW * 0.34), Math.floor((colW - 2) / 2)));
  if (colW <= probeW + 4) return full;
  const leftProbe = { x0: segment.x0, x1: segment.x0 + probeW };
  const rightProbe = { x0: segment.x1 - probeW, x1: segment.x1 };
  const leftInk = valueColumnBodyInkExtentsInSpan(
    pixels,
    width,
    bodyTopY,
    bodyBottomY,
    leftProbe,
    roles,
    occupancyFraction,
  );
  const rightInk = valueColumnBodyInkExtentsInSpan(
    pixels,
    width,
    bodyTopY,
    bodyBottomY,
    rightProbe,
    roles,
    occupancyFraction,
  );
  let { x0, x1 } = full;
  const fanShiftMinPx = Math.max(3, Math.round(colW * 0.04));
  if (leftInk && leftInk.x0 > x0 + fanShiftMinPx) x0 = leftInk.x0;
  if (rightInk && rightInk.x1 > x1) x1 = rightInk.x1;
  if (x1 <= x0) return full;
  return { x0, x1 };
}

function clampAnalysisShift(delta: number, maxShift: number): number {
  if (maxShift <= 0) return 0;
  return Math.max(-maxShift, Math.min(maxShift, Math.round(delta)));
}

/**
 * Slide ruled/expanded stacks toward body-band ink (foreshortened outer columns sit right of vertical rules).
 * Applied after {@link expandValueColumnAnalysisBounds}; neighbor midpoints still apply.
 */
export function trimValueColumnAnalysisBoundsExcessWidthVsMedian(
  segments: AnalysisValueColumnSegment[],
  maxToMedianFraction: number,
): AnalysisValueColumnSegment[] {
  if (segments.length === 0 || maxToMedianFraction <= 0) return segments.map((s) => ({ ...s }));
  const widths = segments.map((s) => s.x1 - s.x0);
  const median = medianPositiveWidth(widths);
  if (median <= 0) return segments.map((s) => ({ ...s }));
  const maxW = Math.max(8, Math.round(median * maxToMedianFraction));
  return segments.map((seg) => {
    const w = seg.x1 - seg.x0;
    if (w <= maxW) return { ...seg };
    return { x0: seg.x0, x1: seg.x0 + maxW };
  });
}

export function snapValueColumnAnalysisBoundsToBodyInk(
  pixels: Uint8Array,
  width: number,
  height: number,
  segments: AnalysisValueColumnSegment[],
  bodyTopY: number,
  bodyBottomY: number,
  roles: BandLuminanceRoles,
  labelBoundaryAnalysisX: number,
  shared: Pick<
    SharedLabelGridParams,
    | 'valueColumnAnalysisBoundsInkSnapFraction'
    | 'valueColumnAnalysisBoundsInkOccupancyFraction'
    | 'valueColumnAnalysisBoundsInkSnapBodyFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
  ruledStackGutters: AnalysisValueColumnSegment[] = segments,
  analysisRight: number = width,
): AnalysisValueColumnSegment[] {
  void height;
  if (segments.length === 0) return [];
  const snapFrac = shared.valueColumnAnalysisBoundsInkSnapFraction;
  if (snapFrac <= 0) return segments.map((s) => ({ ...s }));

  const bodyH = Math.max(1, bodyBottomY - bodyTopY);
  const frac = shared.valueColumnAnalysisBoundsInkSnapBodyFraction;
  const inkTopY = bodyTopY + Math.round(bodyH * frac.y0);
  const inkBottomY = bodyTopY + Math.round(bodyH * frac.y1);

  const snapped = segments.map((seg, i) => {
    const ink = valueColumnBodyInkExtentsAnalysisX(
      pixels,
      width,
      inkTopY,
      inkBottomY,
      seg,
      roles,
      shared.valueColumnAnalysisBoundsInkOccupancyFraction,
    );
    if (!ink) return { ...seg };
    const colW = Math.max(1, seg.x1 - seg.x0);
    const minW = Math.max(12, Math.round(colW * 0.72));
    const maxShift = Math.max(2, Math.round(colW * snapFrac));
    const x0 = seg.x0 + clampAnalysisShift(ink.x0 - seg.x0, maxShift);
    const ruled = ruledStackGutters[i] ?? seg;
    const isLast = i === segments.length - 1;
    let x1 = seg.x1;
    if (isLast) {
      const widenR = Math.max(0, clampAnalysisShift(ink.x1 - seg.x1, maxShift));
      x1 = Math.min(analysisRight, Math.max(seg.x1, seg.x1 + widenR));
    } else {
      x1 = Math.min(seg.x1, ruled.x1);
      if (ink.x1 < x1) {
        const shrink = Math.min(0, clampAnalysisShift(ink.x1 - x1, maxShift));
        x1 = Math.max(x0 + Math.min(minW, 8), Math.min(ruled.x1, x1 + shrink));
      }
    }
    if (x1 - x0 < minW) return { ...seg };
    if (x1 <= x0) return { ...seg };
    return { x0, x1 };
  });

  const out: AnalysisValueColumnSegment[] = [];
  for (let i = 0; i < snapped.length; i += 1) {
    let { x0, x1 } = snapped[i]!;
    x0 = Math.max(labelBoundaryAnalysisX, x0);
    x1 = Math.min(analysisRight, x1);
    const ruled = ruledStackGutters[i] ?? segments[i]!;
    if (i > 0) {
      const inner = (ruledStackGutters[i - 1]!.x1 + ruled.x0) / 2;
      x0 = Math.max(x0, Math.round(inner));
    }
    if (i < snapped.length - 1) {
      const inner = (ruled.x1 + ruledStackGutters[i + 1]!.x0) / 2;
      x1 = Math.min(x1, Math.round(inner), ruled.x1);
    } else {
      x1 = Math.min(x1, analysisRight);
    }
    if (x1 <= x0) {
      out.push({ ...segments[i]! });
      continue;
    }
    out.push({ x0, x1 });
  }
  return out;
}

/**
 * Contiguous analysis-space column anchors between detected vertical rules: `col[i].x1 === col[i+1].x0`.
 * Rules may lean or bow in the photo — this does not force straight image-space edges; row-band warp/skew
 * follows per-column ink and rules when building crops.
 */
export function valueColumnAnalysisBoundsFromSharedVerticalRules(
  verticalRuleStacks: AnalysisValueColumnSegment[],
  labelBoundaryAnalysisX: number,
  analysisRight: number,
): AnalysisValueColumnSegment[] {
  if (verticalRuleStacks.length === 0) return [];
  const boundaries: number[] = [
    Math.max(labelBoundaryAnalysisX, verticalRuleStacks[0]!.x0),
  ];
  for (let i = 1; i < verticalRuleStacks.length; i += 1) {
    const prev = verticalRuleStacks[i - 1]!;
    const next = verticalRuleStacks[i]!;
    boundaries.push(
      next.x0 > prev.x1 ? prev.x1 : Math.round((prev.x1 + next.x0) / 2),
    );
  }
  boundaries.push(Math.min(analysisRight, verticalRuleStacks[verticalRuleStacks.length - 1]!.x1));
  return verticalRuleStacks.map((_, i) => {
    const x0 = boundaries[i]!;
    const x1 = boundaries[i + 1]!;
    return { x0, x1: Math.max(x0 + 1, x1) };
  });
}

function valueColumnSeedGutterLeft(
  seeds: AnalysisValueColumnSegment[],
  i: number,
  labelBoundaryAnalysisX: number,
): number {
  if (i <= 0) return labelBoundaryAnalysisX;
  return Math.max(labelBoundaryAnalysisX, Math.round((seeds[i - 1]!.x1 + seeds[i]!.x0) / 2));
}

function valueColumnSeedGutterRight(
  seeds: AnalysisValueColumnSegment[],
  i: number,
  analysisRight: number,
): number {
  if (i >= seeds.length - 1) return analysisRight;
  return Math.min(analysisRight, Math.round((seeds[i]!.x1 + seeds[i + 1]!.x0) / 2));
}

/** Clamp segments to ruled-stack gutters so neighbors never overlap. */
export function clampValueColumnAnalysisBoundsToSeedGutters(
  segments: AnalysisValueColumnSegment[],
  seeds: AnalysisValueColumnSegment[],
  labelBoundaryAnalysisX: number,
  analysisRight: number,
): AnalysisValueColumnSegment[] {
  if (segments.length === 0) return [];
  const out = segments.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i += 1) {
    const gL = valueColumnSeedGutterLeft(seeds, i, labelBoundaryAnalysisX);
    let gR = valueColumnSeedGutterRight(seeds, i, analysisRight);
    if (i > 0) out[i - 1]!.x1 = Math.min(out[i - 1]!.x1, gL);
    const prevR = i > 0 ? out[i - 1]!.x1 : labelBoundaryAnalysisX;
    let x0 = Math.max(out[i]!.x0, gL, prevR);
    let x1 = Math.min(out[i]!.x1, gR);
    if (i < out.length - 1) {
      x1 = Math.min(x1, seeds[i]!.x1);
    }
    if (x1 <= x0) {
      const fallback = seeds[i] ?? out[i]!;
      x0 = Math.max(gL, Math.min(fallback.x0, gR - 1));
      x1 = Math.min(gR, Math.max(fallback.x1, x0 + 1));
    }
    out[i] = { x0, x1 };
  }
  return out;
}

/** Extend trailing fan column to analysis right without breaking shared vertical rules. */
export function enforceValueColumnAnalysisBoundsMinWidthVsMedian(
  segments: AnalysisValueColumnSegment[],
  minToMedianFraction: number,
  labelBoundaryAnalysisX: number,
  analysisRight: number,
  ruledStackGutters: AnalysisValueColumnSegment[] = segments,
): AnalysisValueColumnSegment[] {
  void labelBoundaryAnalysisX;
  void ruledStackGutters;
  if (segments.length === 0 || minToMedianFraction <= 0) return segments.map((s) => ({ ...s }));
  const out = segments.map((s) => ({ ...s }));
  const widths = out.map((s) => s.x1 - s.x0);
  const median = medianPositiveWidth(widths);
  if (median <= 0) return out;
  const minW = Math.max(8, Math.round(median * minToMedianFraction));
  const i = out.length - 1;
  const x0 = out[i]!.x0;
  let x1 = Math.max(out[i]!.x1, analysisRight);
  if (x1 - x0 < minW) x1 = Math.max(x1, x0 + minW);
  out[i] = { x0, x1: Math.min(analysisRight, x1) };
  return out;
}

/** Body-band ink may shift x0 inside a column; shared rule x1 boundaries stay fixed (last column may widen right). */
export function snapValueColumnAnalysisBoundsX0ToBodyInk(
  pixels: Uint8Array,
  width: number,
  height: number,
  segments: AnalysisValueColumnSegment[],
  bodyTopY: number,
  bodyBottomY: number,
  roles: BandLuminanceRoles,
  labelBoundaryAnalysisX: number,
  shared: Pick<
    SharedLabelGridParams,
    | 'valueColumnAnalysisBoundsInkSnapFraction'
    | 'valueColumnAnalysisBoundsInkOccupancyFraction'
    | 'valueColumnAnalysisBoundsInkSnapBodyFraction'
  > = DEFAULT_SHARED_LABEL_GRID_PARAMS,
  analysisRight: number = width,
): AnalysisValueColumnSegment[] {
  void height;
  if (segments.length === 0) return [];
  const snapFrac = shared.valueColumnAnalysisBoundsInkSnapFraction;
  if (snapFrac <= 0) return segments.map((s) => ({ ...s }));
  const bodyH = Math.max(1, bodyBottomY - bodyTopY);
  const frac = shared.valueColumnAnalysisBoundsInkSnapBodyFraction;
  const inkTopY = bodyTopY + Math.round(bodyH * frac.y0);
  const inkBottomY = bodyTopY + Math.round(bodyH * frac.y1);

  return segments.map((seg, i) => {
    const ink = valueColumnBodyInkExtentsAnalysisX(
      pixels,
      width,
      inkTopY,
      inkBottomY,
      seg,
      roles,
      shared.valueColumnAnalysisBoundsInkOccupancyFraction,
    );
    if (!ink) return { ...seg };
    const colW = Math.max(1, seg.x1 - seg.x0);
    const maxShift = Math.max(2, Math.round(colW * snapFrac));
    let x0 = seg.x0 + clampAnalysisShift(ink.x0 - seg.x0, maxShift);
    x0 = Math.max(labelBoundaryAnalysisX, Math.min(x0, seg.x1 - Math.max(4, Math.round(colW * 0.35))));
    let x1 = seg.x1;
    if (i === segments.length - 1) {
      const widenR = Math.max(0, clampAnalysisShift(ink.x1 - seg.x1, maxShift));
      x1 = Math.min(analysisRight, Math.max(seg.x1, seg.x1 + widenR));
    }
    if (x1 <= x0) return { ...seg };
    return { x0, x1 };
  });
}

/** Per-column width vs median — for viz/diagnostics when ink snap or fan edge under-shoots. */
export function valueColumnAnalysisBoundsWidthDiagnostics(
  segments: AnalysisValueColumnSegment[],
  minToMedianFraction: number,
): Array<{
  index: number;
  width: number;
  medianWidth: number;
  widthToMedian: number;
  belowConfiguredMin: boolean;
}> {
  if (segments.length === 0) return [];
  const widths = segments.map((s) => s.x1 - s.x0);
  const medianWidth = medianPositiveWidth(widths);
  if (medianWidth <= 0) return [];
  const threshold = Math.max(0, minToMedianFraction);
  return segments.map((s, index) => {
    const width = s.x1 - s.x0;
    const widthToMedian = width / medianWidth;
    return {
      index,
      width,
      medianWidth,
      widthToMedian,
      belowConfiguredMin: widthToMedian < threshold,
    };
  });
}

/** Expand ruled stacks outward (× width) without crossing neighbors — fan labels often need a few % on each side. */
export function expandValueColumnAnalysisBounds(
  segments: AnalysisValueColumnSegment[],
  expandWidthFraction: number,
  labelBoundaryAnalysisX: number,
  analysisRight: number,
  ruledStackGutters: AnalysisValueColumnSegment[] = segments,
): AnalysisValueColumnSegment[] {
  if (expandWidthFraction <= 0 || segments.length === 0) return segments.map((s) => ({ ...s }));
  return segments.map((seg, i) => {
    const ruled = ruledStackGutters[i] ?? seg;
    const width = Math.max(1, seg.x1 - seg.x0);
    const pad = Math.round(width * expandWidthFraction);
    const isLast = i === segments.length - 1;
    let x0 = seg.x0 - pad;
    let x1 = isLast ? seg.x1 + pad : seg.x1;
    x0 = Math.max(labelBoundaryAnalysisX, x0, ruled.x0);
    x1 = Math.min(analysisRight, x1);
    if (i > 0) {
      const inner = (ruledStackGutters[i - 1]!.x1 + ruled.x0) / 2;
      x0 = Math.max(x0, Math.round(inner));
    }
    if (!isLast) {
      const inner = (ruled.x1 + ruledStackGutters[i + 1]!.x0) / 2;
      x1 = Math.min(x1, Math.round(inner), ruled.x1);
    }
    if (x1 <= x0) return { ...seg };
    return { x0, x1 };
  });
}

/** Image strips for viz / row regions: exact ruled analysis x bounds — no min OCR width inflation. */
export function imageValueColumnStripsFromAnalysisSegments(
  segments: AnalysisValueColumnSegment[],
  mapAnalysisXToImage: (analysisX: number) => number,
  top: number,
  height: number,
): SharedLabelImageStripRegion[] {
  return segments.map((seg, index) => {
    const left = mapAnalysisXToImage(seg.x0);
    const right = mapAnalysisXToImage(seg.x1);
    return {
      index,
      left,
      top,
      width: Math.max(1, right - left),
      height,
    };
  });
}

function normalizeLineKey(line: string): string {
  return line.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sharedNutrientLineKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const label of extractRowLabels(text)) {
    keys.add(normalizeLineKey(label));
  }
  for (const raw of text.replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(amount per serving|serving size|% daily value)/i.test(line)) {
      keys.add(normalizeLineKey(line));
    }
  }
  return keys;
}

/**
 * True when OCR from a value strip is almost certainly the shared label rail
 * (nutrient names / serving boilerplate, no extractable value lines).
 */
function valueTextHasProductValueSignals(text: string): boolean {
  if (/%\s*daily\s*value/i.test(text)) return true;
  if (/\bvaries\b/i.test(text)) return true;
  if (/®|™/.test(text)) return true;
  if (/\d+\s*(?:g|mg|kcal|%)/i.test(text)) return true;
  return false;
}

function valueTextLooksLikeLabelBoilerplateOnly(text: string): boolean {
  if (valueTextHasProductValueSignals(text)) return false;
  let signals = 0;
  if (/nutrition\s*facts/i.test(text)) signals += 1;
  if (/\bserving\b/i.test(text)) signals += 1;
  if (/amount\s+per/i.test(text)) signals += 1;
  if (/\b(calories|total fat|saturated fat|sodium|protein)\b/i.test(text)) signals += 1;
  return signals >= 2;
}

export function valueColumnTextLooksLikeLabelRail(labelColumnText: string, valueColumnText: string): boolean {
  const valueLines = extractValueLines(valueColumnText);
  if (valueLines.length > 0) return false;
  if (valueTextHasProductValueSignals(valueColumnText)) return false;

  const labelRowLabelCount = extractRowLabels(labelColumnText).length;
  if (labelRowLabelCount < 2) return false;

  const labelKeys = sharedNutrientLineKeys(labelColumnText);
  const valueRowLabels = extractRowLabels(valueColumnText);
  if (labelKeys.size > 0 && valueRowLabels.length >= 2) {
    const matched = valueRowLabels.filter((r) => labelKeys.has(normalizeLineKey(r))).length;
    if (matched >= 2) return true;
  }

  if (valueTextLooksLikeLabelBoilerplateOnly(valueColumnText)) return true;

  const noisyLabelSignals =
    (valueColumnText.match(/\b(?:facts?|serv\w*|amount|calor\w*|sodium|fat|protein)/gi) ?? []).length;
  const digitCount = (valueColumnText.match(/\d/g) ?? []).length;
  if (noisyLabelSignals >= 2 && digitCount <= 1) return true;

  let boilerplateHits = 0;
  for (const raw of valueColumnText.replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const key = normalizeLineKey(line);
    if (labelKeys.has(key)) boilerplateHits += 1;
    if (/^nutrition\s+facts/i.test(line)) boilerplateHits += 1;
    if (/^(amount per serving|serving size)/i.test(line)) boilerplateHits += 1;
  }
  return labelKeys.size > 0 && boilerplateHits >= 2;
}

/** Leading strip with no values while other columns have a table — usually label rail bleed. */
export function looksLikeLeadingLabelBleedColumn(
  columnIndex: number,
  valueColumnTexts: string[],
  labelColumnText: string,
): boolean {
  if (columnIndex !== 0) return false;
  const first = valueColumnTexts[0];
  if (!first) return false;
  if (extractValueLines(first).length > 0) return false;
  if (valueTextHasProductValueSignals(first)) return false;
  const siblingsHaveTable = valueColumnTexts
    .slice(1)
    .some((text) => extractValueLines(text).length >= 2 || valueTextHasProductValueSignals(text));
  if (!siblingsHaveTable) return false;
  return extractRowLabels(labelColumnText).length >= 2;
}

export function separateSharedLabelValueTexts(
  labelColumnText: string,
  valueColumnTexts: string[],
): { valueColumnTexts: string[]; droppedIndexes: number[] } {
  const kept: string[] = [];
  const dropped: number[] = [];
  for (let i = 0; i < valueColumnTexts.length; i += 1) {
    const text = valueColumnTexts[i]!;
    if (
      valueColumnTextLooksLikeLabelRail(labelColumnText, text) ||
      looksLikeLeadingLabelBleedColumn(i, valueColumnTexts, labelColumnText)
    ) {
      dropped.push(i);
      continue;
    }
    kept.push(text);
  }
  return { valueColumnTexts: kept, droppedIndexes: dropped };
}
