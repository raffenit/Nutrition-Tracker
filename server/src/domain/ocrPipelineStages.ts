/** Timed stages for label OCR — all layout classes (single, wide, shared-rail, split). */

export type PipelineStageTiming = {
  id: string;
  label: string;
  durationMs: number;
  detail?: string;
};

export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  preprocess: 'Prepare image',
  geometry: 'Layout geometry',
  ocr_preprocess: 'OCR preprocess',
  ocr_full_page: 'Full-page OCR pass',
  ocr_tesseract: 'Tesseract',
  ocr_easy: 'Neural OCR (Easy)',
  ocr_engines: 'Tesseract ∥ Easy',
  ocr_row_reread: 'Contested-row re-read (Easy)',
  ocr_wide_retry: 'Wide-table retry',
  ocr_split_single: 'Split-label halves',
  ocr_column_strips: 'Column strips',
  ocr_shared_rail: 'Shared label table',
  parse_select: 'Parse & merge rows',
  total: 'Total OCR',
};

export function formatPipelineStageLine(stage: PipelineStageTiming): string {
  const sec = (stage.durationMs / 1000).toFixed(1);
  const tail = stage.detail ? ` — ${stage.detail}` : '';
  return `${stage.label}: ${sec}s${tail}`;
}

export function formatPipelineStageSummary(stages: PipelineStageTiming[]): string {
  return stages.map(formatPipelineStageLine).join(' · ');
}