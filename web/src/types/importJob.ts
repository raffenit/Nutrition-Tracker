export type ImportJobStepStatus = 'done' | 'active' | 'pending';

export type ImportPipelineStage = {
  id: string;
  label: string;
  durationMs: number;
  detail?: string;
};

export type ImportJobSnapshot = {
  id: string;
  flow: 'image' | 'pdf' | 'url';
  message: string;
  detail?: string;
  steps: Array<{ short: string; status: ImportJobStepStatus }>;
  elapsedMs: number;
  done: boolean;
  error: string | null;
  debugLog?: string[];
  activityLog?: string[];
  pipelineStages?: ImportPipelineStage[];
};
