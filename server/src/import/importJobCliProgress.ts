import { getImportJobForUser, type ImportJobSnapshot } from './importJobProgress.js';
import { humanizeImportDebugLine as humanizeLine } from './importJobTelegraph.js';

export { humanizeImportDebugLine } from './importJobTelegraph.js';

export type ImportJobConsoleWatchOptions = {
  pollMs?: number;
  /** When false, hide raw debug lines (default: humanized only). */
  streamDebug?: boolean;
  /** Print raw server debug lines (same as legacy `·` output). */
  verboseDebug?: boolean;
  write?: (line: string) => void;
};

const watches = new Map<
  string,
  {
    timer: ReturnType<typeof setInterval>;
    debugCursor: number;
    lastKey: string;
    lastValueProgress: string | null;
    lastHeaderProgress: string | null;
  }
>();

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}

const STEP_NAMES: Record<string, string> = {
  Receive: 'Receive file',
  Preprocess: 'Prepare image',
  OCR: 'Read label text',
  Parse: 'Parse nutrition rows',
  Draft: 'Build import draft',
  PDF: 'Read PDF',
  Fetch: 'Fetch page',
  Read: 'Read content',
  Request: 'Send request',
};

function humanizeForCli(raw: string): string | null {
  const human = humanizeLine(raw, { audience: 'cli', verbose: false });
  if (!human) return null;
  return human.startsWith('      ') ? human : `      ${human}`;
}

export function formatImportJobSnapshotLines(snapshot: ImportJobSnapshot): string[] {
  const sec = (snapshot.elapsedMs / 1000).toFixed(1);
  const activeIndex = snapshot.steps.findIndex((s) => s.status === 'active');
  const stepHuman = activeIndex >= 0 ? snapshot.steps[activeIndex]!.short : 'Done';
  const stepNum = activeIndex >= 0 ? activeIndex + 1 : snapshot.steps.length;
  const total = snapshot.steps.length;
  const stepTitle = STEP_NAMES[stepHuman] ?? stepHuman;

  const lines: string[] = [
    '',
    `  Step ${stepNum} of ${total}: ${stepTitle} (${sec}s elapsed)`,
    `  ${snapshot.message}`,
  ];
  if (snapshot.detail) lines.push(`  Detail: ${snapshot.detail}`);
  if (snapshot.pipelineStages?.length) {
    lines.push('  Pipeline stages:');
    for (const stage of snapshot.pipelineStages.filter((s) => s.id !== 'total')) {
      const secStage = (stage.durationMs / 1000).toFixed(1);
      const tail = stage.detail ? ` (${stage.detail})` : '';
      lines.push(`    · ${stage.label}: ${secStage}s${tail}`);
    }
    const total = snapshot.pipelineStages.find((s) => s.id === 'total');
    if (total) lines.push(`    · ${total.label}: ${(total.durationMs / 1000).toFixed(1)}s`);
  }
  if (snapshot.error) lines.push(`  Error: ${snapshot.error}`);

  lines.push('  Progress:');
  for (const step of snapshot.steps) {
    let mark = '    - ';
    if (step.status === 'done') mark = '    x ';
    if (step.status === 'active') mark = '  > ';
    lines.push(`${mark}${STEP_NAMES[step.short] ?? step.short}`);
  }

  return lines;
}

/** @deprecated Use {@link formatImportJobSnapshotLines} */
export function formatImportJobSnapshotBlock(snapshot: ImportJobSnapshot): string {
  return formatImportJobSnapshotLines(snapshot).join('\n');
}

function renderWatchTick(jobId: string, userId: string, options: ImportJobConsoleWatchOptions): void {
  const write = options.write ?? defaultWrite;
  const watch = watches.get(jobId);
  if (!watch) return;
  const snapshot = getImportJobForUser(jobId, userId);
  if (!snapshot) return;

  const verbose = options.verboseDebug === true;
  const key = `${snapshot.message}|${snapshot.detail ?? ''}|${snapshot.steps.map((s) => s.status).join(',')}|${snapshot.done}`;
  if (key !== watch.lastKey) {
    watch.lastKey = key;
    for (const line of formatImportJobSnapshotLines(snapshot)) write(line);
  }

  if (options.streamDebug === false) return;

  while (watch.debugCursor < snapshot.debugLog.length) {
    const raw = snapshot.debugLog[watch.debugCursor]!;
    watch.debugCursor += 1;

    if (verbose) {
      write(`      | ${raw}`);
      continue;
    }

    const human = humanizeForCli(raw);
    if (!human) continue;

    if (human.startsWith('__VALUE_PROGRESS__:')) {
      const tag = human.slice('__VALUE_PROGRESS__:'.length);
      if (tag === watch.lastValueProgress) continue;
      watch.lastValueProgress = tag;
      const [n, m] = tag.split('/');
      write(`      Reading product column ${n} of ${m}…`);
      continue;
    }

    if (human.startsWith('__HEADER_PROGRESS__:')) {
      const tag = human.slice('__HEADER_PROGRESS__:'.length);
      if (tag === watch.lastHeaderProgress) continue;
      watch.lastHeaderProgress = tag;
      const [n, m] = tag.split('/');
      write(`      Reading header for product column ${n} of ${m}…`);
      continue;
    }

    write(human);
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
  const watch = {
    timer: undefined as unknown as ReturnType<typeof setInterval>,
    debugCursor: 0,
    lastKey: '',
    lastValueProgress: null as string | null,
    lastHeaderProgress: null as string | null,
  };
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
