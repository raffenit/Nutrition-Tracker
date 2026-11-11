import { api } from '../api/client';
import { apiFormUpload } from '../api/uploadWithProgress';
import type { ImportProgressState } from '../components/ImportProgress';
import type { ImportJobSnapshot } from '../types/importJob';
import type { ImportProcessStep } from './importProcessingSteps';
import { formatUploadBytes } from './importProcessingSteps';
import { pollImportJob } from './importJobPoll';

function newImportJobId(): string {
  return crypto.randomUUID();
}

function snapshotToProgress(snapshot: ImportJobSnapshot): ImportProgressState {
  return {
    phase: 'process',
    percent: null,
    message: snapshot.error ? snapshot.message : snapshot.message,
    detail: snapshot.detail,
    elapsedSec: Math.floor(snapshot.elapsedMs / 1000),
    steps: snapshot.steps.map((step) => ({
      label: step.short,
      status: step.status,
    })),
  };
}

function buildFallbackProgress(
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

export type ImportProgressRunner = {
  runFileImport: <T>(
    file: File,
    processSteps: ImportProcessStep[],
    labels: { pdf: string; image: string },
  ) => Promise<T>;
  runUrlImport: <T>(url: string, processSteps: ImportProcessStep[]) => Promise<T>;
};

export function createImportProgressRunner(
  setImportProgress: (value: ImportProgressState | null) => void,
): ImportProgressRunner {
  let stopPoll: (() => void) | null = null;
  let stopFallback: (() => void) | null = null;
  let serverDriven = false;

  function clearTracking(): void {
    stopPoll?.();
    stopFallback?.();
    stopPoll = null;
    stopFallback = null;
    serverDriven = false;
  }

  function startFallback(steps: ImportProcessStep[]): void {
    stopFallback?.();
    let step = 0;
    const startedAt = Date.now();
    const publish = () => {
      if (serverDriven) return;
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      setImportProgress(buildFallbackProgress(steps, step, elapsedSec));
    };
    publish();
    const stepTimer = window.setInterval(() => {
      if (serverDriven) return;
      step = Math.min(step + 1, steps.length - 1);
      publish();
    }, 3_200);
    const elapsedTimer = window.setInterval(publish, 1_000);
    stopFallback = () => {
      window.clearInterval(stepTimer);
      window.clearInterval(elapsedTimer);
      stopFallback = null;
    };
  }

  function startServerPoll(jobId: string): void {
    stopPoll?.();
    stopPoll = pollImportJob(jobId, (snapshot) => {
      serverDriven = true;
      setImportProgress(snapshotToProgress(snapshot));
    });
  }

  async function runFileImport<T>(
    file: File,
    processSteps: ImportProcessStep[],
    labels: { pdf: string; image: string },
  ): Promise<T> {
    const jobId = newImportJobId();
    clearTracking();
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const fileDetail = `${file.name} · ${formatUploadBytes(file.size)}`;
    setImportProgress({
      phase: 'upload',
      percent: 0,
      message: isPdf ? labels.pdf : labels.image,
      detail: fileDetail,
    });
    startServerPoll(jobId);
    startFallback(processSteps);
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
            if (!serverDriven) {
              setImportProgress(buildFallbackProgress(processSteps, 0, 0));
            }
          }
          return;
        }
        setImportProgress({
          phase: 'upload',
          percent: pct,
          message: `Uploading… ${pct}%`,
          detail: fileDetail,
        });
      }, jobId);
      if (!processingStarted && !serverDriven) {
        setImportProgress(buildFallbackProgress(processSteps, 0, 0));
      }
      return result;
    } finally {
      clearTracking();
      setImportProgress(null);
    }
  }

  async function runUrlImport<T>(url: string, processSteps: ImportProcessStep[]): Promise<T> {
    const jobId = newImportJobId();
    clearTracking();
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep full url */
    }
    setImportProgress({
      phase: 'upload',
      percent: null,
      message: 'Sending request…',
      detail: host,
    });
    startServerPoll(jobId);
    startFallback(processSteps);
    try {
      return await api<T>('/api/import-url', {
        method: 'POST',
        headers: { 'X-Import-Job-Id': jobId },
        body: JSON.stringify({ url, importJobId: jobId }),
      });
    } finally {
      clearTracking();
      setImportProgress(null);
    }
  }

  return { runFileImport, runUrlImport };
}

/** @deprecated Use createImportProgressRunner */
export const createImportProgressController = createImportProgressRunner;
