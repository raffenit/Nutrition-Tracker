import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export type ImportJobFlow = 'image' | 'pdf' | 'url';

export type ImportJobStepStatus = 'done' | 'active' | 'pending';

const DEBUG_LOG_MAX = 80;

export type ImportJobSnapshot = {
  id: string;
  flow: ImportJobFlow;
  message: string;
  detail?: string;
  steps: Array<{ short: string; status: ImportJobStepStatus }>;
  elapsedMs: number;
  done: boolean;
  error: string | null;
  /** Server-side OCR / pipeline trace (poll via GET /api/import-jobs/:id). */
  debugLog: string[];
};

type ImportJobRecord = {
  userId: string;
  flow: ImportJobFlow;
  stepShorts: string[];
  activeIndex: number;
  message: string;
  detail?: string;
  startedAt: number;
  updatedAt: number;
  done: boolean;
  error: string | null;
  debugLog: string[];
};

const JOB_TTL_MS = 15 * 60 * 1000;
const jobs = new Map<string, ImportJobRecord>();

const jobContext = new AsyncLocalStorage<{ jobId: string; userId: string }>();

const FLOW_STEPS: Record<ImportJobFlow, string[]> = {
  image: ['Receive', 'Preprocess', 'OCR', 'Parse', 'Draft'],
  pdf: ['Receive', 'PDF', 'OCR', 'Parse', 'Draft'],
  url: ['Request', 'Fetch', 'Read', 'Parse', 'Draft'],
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isImportJobId(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseImportJobId(headers: import('node:http').IncomingHttpHeaders, body: unknown): string | null {
  const header = headers['x-import-job-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (isImportJobId(fromHeader)) return fromHeader;
  if (body && typeof body === 'object' && 'importJobId' in body) {
    const id = (body as { importJobId?: unknown }).importJobId;
    if (typeof id === 'string' && isImportJobId(id)) return id;
  }
  return null;
}

export function beginImportJob(jobId: string, userId: string, flow: ImportJobFlow): void {
  if (!isImportJobId(jobId)) return;
  pruneJobs();
  const stepShorts = FLOW_STEPS[flow];
  const now = Date.now();
  jobs.set(jobId, {
    userId,
    flow,
    stepShorts,
    activeIndex: 0,
    message: defaultMessage(flow, stepShorts[0] ?? 'Working'),
    startedAt: now,
    updatedAt: now,
    done: false,
    error: null,
    debugLog: [],
  });
}

/** Append a diagnostic line for active import jobs (OCR engines, column strips, preprocess). */
export function appendImportJobDebug(line: string): void {
  const ctx = jobContext.getStore();
  if (!ctx) {
    if (process.env.IMPORT_JOB_DEBUG === '1') {
      console.error(`[import-debug] ${line}`);
    }
    return;
  }
  const record = jobs.get(ctx.jobId);
  if (!record) return;
  record.debugLog.push(line);
  if (record.debugLog.length > DEBUG_LOG_MAX) {
    record.debugLog.splice(0, record.debugLog.length - DEBUG_LOG_MAX);
  }
  record.updatedAt = Date.now();
}

export function runWithImportJob<T>(jobId: string | null, userId: string, flow: ImportJobFlow, fn: () => Promise<T>): Promise<T> {
  if (!jobId) return fn();
  beginImportJob(jobId, userId, flow);
  return jobContext.run({ jobId, userId }, fn);
}

export function reportImportJobStep(short: string, message: string, detail?: string): void {
  const ctx = jobContext.getStore();
  if (!ctx) return;
  const record = jobs.get(ctx.jobId);
  if (!record || record.done) return;
  const index = record.stepShorts.indexOf(short);
  const activeIndex = index >= 0 ? index : record.activeIndex;
  record.activeIndex = activeIndex;
  record.message = message;
  record.detail = detail;
  record.updatedAt = Date.now();
}

export function finishImportJob(jobId: string | null): void {
  if (!jobId) return;
  const record = jobs.get(jobId);
  if (!record) return;
  record.done = true;
  record.activeIndex = Math.max(0, record.stepShorts.length - 1);
  record.message = 'Import complete';
  record.detail = undefined;
  record.updatedAt = Date.now();
}

export function failImportJob(jobId: string | null, error: string): void {
  if (!jobId) return;
  const record = jobs.get(jobId);
  if (!record) return;
  record.done = true;
  record.error = error;
  record.message = 'Import failed';
  record.updatedAt = Date.now();
}

export function getImportJobForUser(jobId: string, userId: string): ImportJobSnapshot | null {
  pruneJobs();
  const record = jobs.get(jobId);
  if (!record || record.userId !== userId) return null;
  return snapshotFromRecord(jobId, record);
}

function snapshotFromRecord(id: string, record: ImportJobRecord): ImportJobSnapshot {
  const elapsedMs = Date.now() - record.startedAt;
  return {
    id,
    flow: record.flow,
    message: record.message,
    detail: record.detail,
    elapsedMs,
    done: record.done,
    error: record.error,
    debugLog: [...record.debugLog],
    steps: record.stepShorts.map((short, index) => {
      let status: ImportJobStepStatus = 'pending';
      if (index < record.activeIndex) status = 'done';
      else if (index === record.activeIndex) status = record.done ? 'done' : 'active';
      return { short, status };
    }),
  };
}

function defaultMessage(flow: ImportJobFlow, short: string): string {
  if (flow === 'url' && short === 'Request') return 'Sending import request…';
  if (short === 'Receive') return 'File received…';
  return `${short}…`;
}

function pruneJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, record] of jobs) {
    if (record.updatedAt < cutoff) jobs.delete(id);
  }
}

/** Test helper */
export function clearImportJobsForTest(): void {
  jobs.clear();
}

/** Ensures client can generate ids without importing uuid package mismatch */
export function newImportJobId(): string {
  return randomUUID();
}
