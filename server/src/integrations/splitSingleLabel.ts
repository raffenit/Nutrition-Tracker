import type { LabelLayoutHint } from '../domain/labelLayout.js';
import { resolveColumnStripParams } from '../domain/columnStripDetectParams.js';
import { DEFAULT_SPLIT_SINGLE_LABEL_PARAMS } from '../domain/splitSingleLabelParams.js';
import {
  collectColumnGeometryWitnesses,
  fitSplitSingleColumns,
  pickLeadingLayoutHypothesis,
  pickVarietyPackSubtype,
  scoreLayoutHypotheses,
} from './labelTableLayoutFit.js';
import {
  buildColumnStripPlanFromAnalysisSegments,
  extractColumnStripBuffers,
  prepareWideBandAnalysis,
  type ColumnStripPlan,
} from './labelColumnStrips.js';
import { resolveLabelProcessingImage } from './imageLayoutHint.js';

/** Strip coordinates are in {@link sourceBytes} space (the processed label image, not the upload). */
export type SplitSingleLabelPlan = ColumnStripPlan & { sourceBytes: Buffer };

/** Two equal vertical halves of one Nutrition Facts panel (not two products). */
export async function detectSplitSingleLabel(
  bytes: Buffer,
  hint: Pick<LabelLayoutHint, 'singleSubjectInFocus' | 'sharpPeakCount'>,
): Promise<SplitSingleLabelPlan | null> {
  if (!hint.singleSubjectInFocus) return null;
  if (hint.sharpPeakCount >= 18) return null;

  const { bytes: labelBytes } = await resolveLabelProcessingImage(bytes);
  const params = resolveColumnStripParams();
  const band = await prepareWideBandAnalysis(labelBytes, params, 'detection');
  if (!band) return null;

  const witnesses = collectColumnGeometryWitnesses(
    band.pixels,
    band.analysisW,
    band.analysisH,
    params,
    2,
  );
  const scores = scoreLayoutHypotheses(witnesses, hint);
  if (pickLeadingLayoutHypothesis(scores) !== 'split_single') return null;
  const subtype = pickVarietyPackSubtype(scores);
  if (subtype === 'shared_rail' && (scores.find((s) => s.layout === 'shared_rail')?.score ?? 0) >= 0.52) {
    return null;
  }

  const segments = fitSplitSingleColumns(witnesses);
  if (!segments) return null;

  const { widthRatioMin, widthRatioMax } = DEFAULT_SPLIT_SINGLE_LABEL_PARAMS;
  const wl = segments[0]!.x1 - segments[0]!.x0;
  const wr = segments[1]!.x1 - segments[1]!.x0;
  const ratio = wl < wr ? wl / wr : wr / wl;
  if (ratio < widthRatioMin || ratio > widthRatioMax) return null;

  const plan = await buildColumnStripPlanFromAnalysisSegments(bytes, segments, {
    minColumns: 2,
    maxColumns: 2,
    requireWideAspect: false,
  });
  return plan ? { ...plan, sourceBytes: labelBytes } : null;
}

export async function extractSplitSingleLabelBuffers(plan: SplitSingleLabelPlan): Promise<[Buffer, Buffer]> {
  const [left, right] = await extractColumnStripBuffers(plan.sourceBytes, plan);
  return [left!, right!];
}
