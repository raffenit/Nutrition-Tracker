import sharp from 'sharp';
import {
  DEFAULT_NUTRITION_FACTS_LABEL_SHAPE_PARAMS,
  resolveNutritionFactsLabelShapeParams,
  type NutritionFactsLabelShapeParams,
} from '../domain/nutritionFactsLabelShapeParams.js';
import { bandToAnalysisSize } from './imageAnalysisResample.js';
import { horizontalRuleRowYsInColumn } from './ruledTableGridDetect.js';
import { DEFAULT_RULED_TABLE_GRID_PARAMS } from '../domain/ruledTableGridParams.js';

export type NutritionFactsLabelShapeAssessment = {
  looksLikePanel: boolean;
  horizontalRuleCount: number;
  firstRuleYFraction: number | null;
  headerBandEdgeFractionOfPeak: number;
  reasons: string[];
};

type RowEdge = { y: number; strength: number };

function horizontalRowEdges(pixels: Uint8Array, width: number, height: number, y0: number, y1: number): RowEdge[] {
  const out: RowEdge[] = [];
  for (let y = Math.max(1, y0); y < Math.min(height - 1, y1); y += 1) {
    let sum = 0;
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      sum += Math.abs(pixels[i + width]! - pixels[i - width]!);
    }
    out.push({ y, strength: sum / width });
  }
  return out;
}

function ruledHorizontalRulesInBand(
  pixels: Uint8Array,
  width: number,
  height: number,
): { count: number; firstY: number | null } {
  const ruleYs = horizontalRuleRowYsInColumn(pixels, width, height, 0, width, DEFAULT_RULED_TABLE_GRID_PARAMS);
  return { count: ruleYs.length, firstY: ruleYs[0] ?? null };
}

/** Geometry-only: ruled rows + heading band — no OCR. */
export function assessNutritionFactsLabelShapeFromGrey(
  pixels: Uint8Array,
  width: number,
  height: number,
  paramsPartial?: Partial<NutritionFactsLabelShapeParams>,
): NutritionFactsLabelShapeAssessment {
  const params = resolveNutritionFactsLabelShapeParams(paramsPartial);
  const reasons: string[] = [];
  const yBottom = Math.max(1, Math.round(height * (1 - params.scanBottomSkipFraction)));
  const rows = horizontalRowEdges(pixels, width, height, 0, yBottom);
  const peak = rows.reduce((best, row) => Math.max(best, row.strength), 0);
  const headerCutoff = Math.max(1, Math.round(height * params.headerBandTopFraction));
  const headerRows = rows.filter((row) => row.y < headerCutoff);
  const headerBandEdgeFractionOfPeak =
    peak > 0 && headerRows.length > 0
      ? headerRows.reduce((best, row) => Math.max(best, row.strength), 0) / peak
      : 0;

  const { count: horizontalRuleCount, firstY } = ruledHorizontalRulesInBand(pixels, width, height);
  const firstRuleYFraction = firstY != null ? firstY / height : null;

  if (horizontalRuleCount < params.minHorizontalRules) {
    reasons.push(`horizontal_rules=${horizontalRuleCount}<${params.minHorizontalRules}`);
  }
  if (headerBandEdgeFractionOfPeak < params.headerBandMinEdgeFractionOfPeak) {
    reasons.push(
      `header_band=${headerBandEdgeFractionOfPeak.toFixed(2)}<${params.headerBandMinEdgeFractionOfPeak}`,
    );
  }
  if (firstRuleYFraction == null) {
    reasons.push('no_first_rule');
  } else {
    if (firstRuleYFraction < params.firstRuleMinYFraction) {
      reasons.push(`first_rule_high=${firstRuleYFraction.toFixed(2)}`);
    }
    if (firstRuleYFraction > params.firstRuleMaxYFraction) {
      reasons.push(`first_rule_low=${firstRuleYFraction.toFixed(2)}`);
    }
  }

  const looksLikePanel = reasons.length === 0;
  return {
    looksLikePanel,
    horizontalRuleCount,
    firstRuleYFraction,
    headerBandEdgeFractionOfPeak,
    reasons,
  };
}

export async function assessNutritionFactsLabelShape(
  imageBytes: Buffer,
  paramsPartial?: Partial<NutritionFactsLabelShapeParams>,
): Promise<NutritionFactsLabelShapeAssessment> {
  const params = resolveNutritionFactsLabelShapeParams(paramsPartial);
  const meta = await sharp(imageBytes).metadata();
  const fullW = meta.width ?? 0;
  const fullH = meta.height ?? 0;
  if (fullW < 32 || fullH < 32) {
    return {
      looksLikePanel: false,
      horizontalRuleCount: 0,
      firstRuleYFraction: null,
      headerBandEdgeFractionOfPeak: 0,
      reasons: ['image_too_small'],
    };
  }

  const { analysisW, analysisH } = bandToAnalysisSize(
    fullW,
    fullH,
    params.analysisWidth,
    0.35,
    0.35,
  );
  const { data } = await sharp(imageBytes)
    .greyscale()
    .resize({ width: analysisW, height: analysisH, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return assessNutritionFactsLabelShapeFromGrey(new Uint8Array(data), analysisW, analysisH, params);
}