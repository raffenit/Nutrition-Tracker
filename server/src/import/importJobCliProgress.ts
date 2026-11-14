import { getImportJobForUser, type ImportJobSnapshot } from './importJobProgress.js';

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

/** Turn a pipeline debug string into a short, readable log line (or null to hide). */
export function humanizeImportDebugLine(raw: string, verbose: boolean): string | null {
  if (verbose) return raw;

  if (/^ocr (columnStrip|rowBand|wideTable|per_strip):/i.test(raw)) return null;
  if (/^ocr .+: \d+ variant/i.test(raw)) return null;

  const geoPreflight = raw.match(/^geometry preflight: (.+)$/);
  if (geoPreflight) {
    const summary = geoPreflight[1]!;
    const step = summary.match(/^step (\d) (ok|fail): (.+?)(?:\s*\(|$)/);
    if (step) {
      const labels = ['', 'Detect columns', 'Find header', 'Classify layout', 'Align rows'];
      const title = labels[Number(step[1])] ?? `Step ${step[1]}`;
      const status = step[2] === 'ok' ? 'OK' : 'FAILED';
      return `      ${title}: ${status} — ${step[3]}`;
    }
    return `      Layout: ${summary}`;
  }

  if (raw.startsWith('geometry: shared-rail plan')) {
    return '      Route: shared label table (skipping full-page OCR)';
  }
  if (raw.startsWith('geometry: skip wideTableRetry')) return null;

  const labelBody = raw.match(/^label body: (\d+) chars$/);
  if (labelBody) return `      Label column: ${labelBody[1]} characters of text`;
  const headerBody = raw.match(/^header: (\d+) chars$/);
  if (headerBody) return `      Product names row: ${headerBody[1]} characters of text`;
  if (/^shared-label grid: label OCR/i.test(raw)) return null;
  if (/^shared-label grid: header OCR/i.test(raw)) return null;

  const valueIdx = raw.match(/^shared-label grid value (\d+)\/(\d+)$/);
  if (valueIdx) return `__VALUE_PROGRESS__:${valueIdx[1]}/${valueIdx[2]}`;

  const bodyPlan = raw.match(
    /^shared-label grid: body (\d+)px @ y=\d+, row slices=(\d+), rowPitch=(\d+)px, rowOcr=(\w+)$/,
  );
  if (bodyPlan) {
    const mode = bodyPlan[4] === 'true' ? 'one OCR pass per row band' : 'one OCR pass per product column';
    return `      Nutrient table: ${bodyPlan[2]} horizontal bands, ${mode}`;
  }
  if (raw.startsWith('shared-label grid: label ') || raw.startsWith('shared-label grid value widths')) {
    return null;
  }

  const dropped = raw.match(/dropped value column OCR at index \[([^\]]+)\]/);
  if (dropped) return `      Removed label-rail bleed from product columns at index ${dropped[1]}`;

  if (raw.startsWith('shared-label grid: stitch failed')) {
    return `      Stitch: failed (${raw.split('—').pop()?.trim() ?? 'see log'})`;
  }
  const stitchOk = raw.match(/^shared-label grid: stitch OK — (\d+) products \((\d+) with macros\)/);
  if (stitchOk) {
    return `      Stitch: ${stitchOk[1]} products, ${stitchOk[2]} with readable macros`;
  }
  if (raw.startsWith('shared-label grid: stitch structurally')) return '      Stitch: table shape OK (parsing may still be partial)';
  if (raw.startsWith('shared-label grid: body-column fallback')) {
    const macros = raw.match(/macroColumns=(\d+)/);
    return `      Retried with full-column OCR (macros in ${macros?.[1] ?? '?'} columns)`;
  }

  if (/^variety grid /i.test(raw) || /^variety pack:/i.test(raw)) {
    return `      ${raw.replace(/^variety (?:grid|pack):?\s*/i, '')}`;
  }

  if (/^split-single-label:/i.test(raw) || /^column-strip/i.test(raw)) return `      ${raw}`;

  const tessStart = raw.match(/^Tesseract run (\d+): start — (.+)$/);
  if (tessStart) {
    return `      Tesseract run ${tessStart[1]}: ${tessStart[2]}`;
  }
  const tessDone = raw.match(/^Tesseract run (\d+): done — (\d+) characters$/);
  if (tessDone) {
    return `      Tesseract run ${tessDone[1]}: finished (${tessDone[2]} characters)`;
  }
  if (/^tesseract\.js .* error:/i.test(raw)) return `      ${raw}`;
  if (/^tesseract native /i.test(raw)) return `      ${raw}`;
  if (/^Tesseract /i.test(raw) || /^tesseract/i.test(raw)) return null;

  const easyPhase = raw.match(/^EasyOCR run (\d+): phase (\d+) — (.+)$/);
  if (easyPhase) {
    return `      EasyOCR run ${easyPhase[1]}, phase ${easyPhase[2]}: ${easyPhase[3]}`;
  }
  const easyStart = raw.match(/^EasyOCR run (\d+): start — (.+)$/);
  if (easyStart) return `      EasyOCR run ${easyStart[1]}: ${easyStart[2]}`;
  const easyDone = raw.match(/^EasyOCR run (\d+): done — (\d+) characters$/);
  if (easyDone) {
    return `      EasyOCR run ${easyDone[1]}: finished (${easyDone[2]} characters)`;
  }
  if (/^EasyOCR /i.test(raw)) return null;

  return null;
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

    const human = humanizeImportDebugLine(raw, false);
    if (!human) continue;

    if (human.startsWith('__VALUE_PROGRESS__:')) {
      const tag = human.slice('__VALUE_PROGRESS__:'.length);
      if (tag === watch.lastValueProgress) continue;
      watch.lastValueProgress = tag;
      const [n, m] = tag.split('/');
      write(`      Reading product column ${n} of ${m}…`);
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
