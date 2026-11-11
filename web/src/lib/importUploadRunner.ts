import { apiFormUpload } from '../api/uploadWithProgress';
import type { ImportProgressState } from '../components/ImportProgress';
import type { ImportProcessStep } from './importProcessingSteps';
import { formatUploadBytes } from './importProcessingSteps';

export function buildProcessProgress(
  steps: ImportProcessStep[],
  activeIndex: number,
  elapsedSec: number,
): ImportProgressState {
  const clamped = Math.min(Math.max(activeIndex, 0), steps.length - 1);
  const current = steps[clamped];
  return {
    phase: 'process',
    percent: null,
    message: current?.message ?? 'Processing…',
    detail: current?.detail,
    elapsedSec,
    steps: steps.map((row, index) => ({
      label: row.short,
      status: index < clamped ? 'done' : index === clamped ? 'active' : 'pending',
    })),
  };
}

export type ImportProgressController = {
  startProcessMessages: (steps: ImportProcessStep[]) => void;
  endImportProgress: () => void;
  uploadImportFile: <T>(file: File, processSteps: ImportProcessStep[], labels: { pdf: string; image: string }) => Promise<T>;
};

export function createImportProgressController(
  setImportProgress: (value: ImportProgressState | null) => void,
): ImportProgressController {
  let processMessageStop: (() => void) | null = null;

  function startProcessMessages(steps: ImportProcessStep[]): void {
    processMessageStop?.();
    let step = 0;
    const startedAt = Date.now();
    const publish = () => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      setImportProgress(buildProcessProgress(steps, step, elapsedSec));
    };
    publish();
    const stepTimer = window.setInterval(() => {
      step = Math.min(step + 1, steps.length - 1);
      publish();
    }, 3_200);
    const elapsedTimer = window.setInterval(publish, 1_000);
    processMessageStop = () => {
      window.clearInterval(stepTimer);
      window.clearInterval(elapsedTimer);
      processMessageStop = null;
    };
  }

  function endImportProgress(): void {
    processMessageStop?.();
    setImportProgress(null);
  }

  async function uploadImportFile<T>(
    file: File,
    processSteps: ImportProcessStep[],
    labels: { pdf: string; image: string },
  ): Promise<T> {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const fileDetail = `${file.name} · ${formatUploadBytes(file.size)}`;
    setImportProgress({
      phase: 'upload',
      percent: 0,
      message: isPdf ? labels.pdf : labels.image,
      detail: fileDetail,
    });
    let processingStarted = false;
    try {
      const body = new FormData();
      body.set('file', file);
      const result = await apiFormUpload<T>('/api/uploads', body, (loaded, total) => {
        if (total <= 0) return;
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        if (loaded >= total) {
          if (!processingStarted) {
            processingStarted = true;
            startProcessMessages(processSteps);
          }
          return;
        }
        setImportProgress({
          phase: 'upload',
          percent: pct,
          message: `Uploading… ${pct}%`,
          detail: fileDetail,
        });
      });
      if (!processingStarted) startProcessMessages(processSteps);
      return result;
    } finally {
      endImportProgress();
    }
  }

  return { startProcessMessages, endImportProgress, uploadImportFile };
}
