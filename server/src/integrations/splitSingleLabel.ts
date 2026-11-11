import type { LabelLayoutHint } from '../domain/labelLayout.js';
import { DEFAULT_SPLIT_SINGLE_LABEL_PARAMS } from '../domain/splitSingleLabelParams.js';
import {
  detectColumnStrips,
  extractColumnStripBuffers,
  type ColumnStripPlan,
} from './labelColumnStrips.js';
import { detectSharedLabelValueGrid } from './sharedLabelValueGrid.js';

/** Two equal vertical halves of one Nutrition Facts panel (not two products). */
export async function detectSplitSingleLabel(
  bytes: Buffer,
  hint: Pick<LabelLayoutHint, 'singleSubjectInFocus' | 'sharpPeakCount'>,
): Promise<ColumnStripPlan | null> {
  if (!hint.singleSubjectInFocus) return null;
  if (hint.sharpPeakCount >= 18) return null;
  if (await detectSharedLabelValueGrid(bytes, { maxColumns: 4, requireWideAspect: false })) {
    return null;
  }

  const plan = await detectColumnStrips(bytes, {
    minColumns: 2,
    maxColumns: 2,
    requireWideAspect: false,
  });
  if (!plan || plan.strips.length !== 2) return null;

  const [left, right] = plan.strips;
  const ratio = left!.width / Math.max(1, right!.width);
  const { widthRatioMin, widthRatioMax } = DEFAULT_SPLIT_SINGLE_LABEL_PARAMS;
  if (ratio < widthRatioMin || ratio > widthRatioMax) return null;
  return plan;
}

export async function extractSplitSingleLabelBuffers(
  bytes: Buffer,
  plan: ColumnStripPlan,
): Promise<[Buffer, Buffer]> {
  const [left, right] = await extractColumnStripBuffers(bytes, plan);
  return [left!, right!];
}
