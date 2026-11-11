/** Human-style variety table reconstruction: geometry before OCR. */
export type VarietyPackGridStep = 1 | 2 | 3 | 4;

export type VarietyPackGridStepCode =
  | 'ok'
  | 'band_unavailable'
  | 'not_wide_enough'
  | 'insufficient_categories'
  | 'insufficient_ruled_columns'
  | 'column_widths_nonuniform'
  | 'header_band_missing'
  | 'header_band_implausible'
  | 'label_layout_unknown'
  | 'shared_rail_rejected'
  | 'insufficient_row_bands'
  | 'ocr_plan_incomplete';

export type VarietyPackGridStepValidation = {
  ok: boolean;
  step: VarietyPackGridStep;
  code: VarietyPackGridStepCode;
  message: string;
  metrics?: Record<string, number | string | boolean>;
};

export type GatedStepResult<T> = {
  validation: VarietyPackGridStepValidation;
  data: T | null;
};

export type VarietyPackGridCategory = {
  x0: number;
  x1: number;
  index: number;
  horizontalRuleCount: number;
};

export type VarietyPackGridStep1 = {
  categories: VarietyPackGridCategory[];
  productColumns: VarietyPackGridCategory[];
  detectionMethod: 'ruled' | 'ink_fallback';
};

export type VarietyPackGridStep2 = {
  /** Analysis-space y where ruled nutrient rows begin (below product-name header). */
  bodyTopY: number;
  headerHeightFraction: number;
};

export type VarietyPackLabelLayout = 'shared_rail' | 'per_column_labels' | 'unknown';

export type VarietyPackGridStep3 = {
  layout: VarietyPackLabelLayout;
  labelColumn: VarietyPackGridCategory | null;
  valueColumns: VarietyPackGridCategory[];
  labelBoundaryX: number;
  inkAsymmetry: number;
};

export type VarietyPackGridStep4 = {
  rowBandYs: number[];
  planReady: boolean;
};

export type VarietyPackGridPipelineResult = {
  steps: {
    1: GatedStepResult<VarietyPackGridStep1>;
    2: GatedStepResult<VarietyPackGridStep2>;
    3: GatedStepResult<VarietyPackGridStep3>;
    4: GatedStepResult<VarietyPackGridStep4>;
  };
  /** Highest step that passed validation. */
  lastOkStep: 0 | VarietyPackGridStep;
};

export function stepValidation(
  step: VarietyPackGridStep,
  ok: boolean,
  code: VarietyPackGridStepCode,
  message: string,
  metrics?: VarietyPackGridStepValidation['metrics'],
): VarietyPackGridStepValidation {
  return { ok, step, code, message, metrics };
}

export function gated<T>(validation: VarietyPackGridStepValidation, data: T | null): GatedStepResult<T> {
  return { validation, data: validation.ok && data !== null ? data : null };
}

export function gatedFail<T>(validation: VarietyPackGridStepValidation): GatedStepResult<T> {
  return { validation, data: null };
}
