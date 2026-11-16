import type { PipelineStageTiming } from '../domain/ocrPipelineStages.js';
import { PIPELINE_STAGE_LABELS, formatPipelineStageLine } from '../domain/ocrPipelineStages.js';
import { appendImportJobDebug, setImportJobPipelineStages } from '../import/importJobProgress.js';

export class OcrPipelineTimer {
  private readonly startedAt = Date.now();
  private lapAt = Date.now();
  private readonly stages: PipelineStageTiming[] = [];

  lap(id: string, detail?: string): void {
    const now = Date.now();
    const durationMs = now - this.lapAt;
    this.lapAt = now;
    const label = PIPELINE_STAGE_LABELS[id] ?? id;
    const stage: PipelineStageTiming = { id, label, durationMs, detail };
    this.stages.push(stage);
    appendImportJobDebug(`ocr stage: ${formatPipelineStageLine(stage)}`);
    setImportJobPipelineStages(this.stages);
  }

  finish(id = 'total', detail?: string): PipelineStageTiming[] {
    const totalMs = Date.now() - this.startedAt;
    this.stages.push({
      id,
      label: PIPELINE_STAGE_LABELS[id] ?? id,
      durationMs: totalMs,
      detail,
    });
    setImportJobPipelineStages(this.stages);
    return [...this.stages];
  }

  snapshot(): PipelineStageTiming[] {
    return [...this.stages];
  }
}