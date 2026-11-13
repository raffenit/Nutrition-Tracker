import { getImportJobForUser, type ImportJobSnapshot } from './importJobProgress.js';

export type ImportJobConsoleWatchOptions = {
  pollMs?: number;
  /** Print new `debugLog` lines as they arrive (app shows message/steps; debug is server-only). */
  streamDebug?: boolean;
  write?: (line: string) => void;
};

const watches = new Map<string, { timer: ReturnType<typeof setInterval>; debugCursor: number; lastKey: string }>();

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}

export function formatImportJobSnapshotBlock(snapshot: ImportJobSnapshot): string {
  const sec = (snapshot.elapsedMs / 1000).toFixed(1);
  const stepGlyphs = snapshot.steps
    .map((step) => {
      const glyph = step.status === 'done' ? '✓' : step.status === 'active' ? '→' : '·';
      return `${glyph} ${step.short}`;
    })
    .join('  ');
  const detail = snapshot.detail ? `\n    ${snapshot.detail}` : '';
  const err = snapshot.error ? `\n    error: ${snapshot.error}` : '';
  return `[${sec}s] ${snapshot.message}${detail}${err}\n    ${stepGlyphs}`;
}

function renderWatchTick(
  jobId: string,
  userId: string,
  options: ImportJobConsoleWatchOptions,
): void {
  const write = options.write ?? defaultWrite;
  const watch = watches.get(jobId);
  if (!watch) return;
  const snapshot = getImportJobForUser(jobId, userId);
  if (!snapshot) return;

  const key = `${snapshot.message}|${snapshot.detail ?? ''}|${snapshot.steps.map((s) => s.status).join(',')}|${snapshot.done}`;
  if (key !== watch.lastKey) {
    watch.lastKey = key;
    write(formatImportJobSnapshotBlock(snapshot));
  }

  if (options.streamDebug !== false) {
    while (watch.debugCursor < snapshot.debugLog.length) {
      const line = snapshot.debugLog[watch.debugCursor]!;
      watch.debugCursor += 1;
      write(`    · ${line}`);
    }
  }
}

/** Mirrors in-app import progress (poll-driven) for CLI OCR scripts. */
export function startImportJobConsoleWatch(
  jobId: string,
  userId: string,
  options: ImportJobConsoleWatchOptions = {},
): () => void {
  stopImportJobConsoleWatch(jobId);
  const pollMs = options.pollMs ?? 400;
  const watch = { timer: undefined as unknown as ReturnType<typeof setInterval>, debugCursor: 0, lastKey: '' };
  watch.timer = setInterval(() => renderWatchTick(jobId, userId, options), pollMs);
  watches.set(jobId, watch);
  renderWatchTick(jobId, userId, options);
  return () => stopImportJobConsoleWatch(jobId);
}

export function stopImportJobConsoleWatch(jobId: string): void {
  const watch = watches.get(jobId);
  if (!watch) return;
  clearInterval(watch.timer);
  watches.delete(jobId);
}
