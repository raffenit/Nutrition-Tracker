export type ImportJobStepStatus = 'done' | 'active' | 'pending';

export type ImportJobSnapshot = {
  id: string;
  flow: 'image' | 'pdf' | 'url';
  message: string;
  detail?: string;
  steps: Array<{ short: string; status: ImportJobStepStatus }>;
  elapsedMs: number;
  done: boolean;
  error: string | null;
};
