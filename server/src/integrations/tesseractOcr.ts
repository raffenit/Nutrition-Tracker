import Tesseract, { type PSM, type Worker } from 'tesseract.js';
import { appendImportJobDebug } from '../import/importJobProgress.js';

export type TesseractLineBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
};

export type TesseractBatchResult = {
  texts: string[];
  logLines: string[];
  /** Per run (image × PSM, same order as `texts`) when `withLines` is requested. */
  lines?: TesseractLineBox[][];
};

export type TesseractRecognizeOptions = {
  /** Also return line text + bbox (for contested-row re-read). */
  withLines?: boolean;
};

const STDERR_PATTERNS =
  /too small to scale|cannot be recognized|empty page|Error during processing/i;

/** Monotonic id per `recognize()` in the current import job (reset in {@link resetTesseractRunCounter}). */
let tesseractRunSeq = 0;

export function resetTesseractRunCounter(): void {
  tesseractRunSeq = 0;
}

function pushDebug(lines: string[]): void {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    appendImportJobDebug(`tesseract: ${trimmed}`);
  }
}

function workerLogger(label: string, logLines: string[]) {
  return (message: { status: string; progress?: number }) => {
    if (message.status === 'recognizing text') return;
    const line = `tesseract.js [${label}] ${message.status}${message.progress ? ` ${Math.round(message.progress * 100)}%` : ''}`;
    logLines.push(line);
  };
}

/** One English worker — reuse across many crops in the same import job (avoids reloading eng). */
export async function openTesseractWorker(cachePath: string, label: string): Promise<Worker> {
  const logLines: string[] = [];
  return Tesseract.createWorker('eng', 1, {
    cachePath,
    logger: workerLogger(label, logLines),
    errorHandler: (error: unknown) => {
      const line = `tesseract.js [${label}] error: ${String(error)}`;
      logLines.push(line);
      appendImportJobDebug(line);
    },
  });
}

/** Recognize many images with an already-loaded worker (caller owns terminate). */
export async function recognizeImagesOnWorker(
  worker: Worker,
  images: Buffer[],
  psmModes: PSM[],
  label: string,
  options?: TesseractRecognizeOptions,
): Promise<TesseractBatchResult> {
  const logLines: string[] = [];
  const texts: string[] = [];
  const lines: TesseractLineBox[][] = [];
  const withLines = options?.withLines === true;
  const totalRuns = images.length * psmModes.length;
  let runInBatch = 0;

  for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
    for (const psm of psmModes) {
      runInBatch += 1;
      const run = ++tesseractRunSeq;
      appendImportJobDebug(
        `Tesseract run ${run}: start — ${label}, crop ${imageIndex + 1}/${images.length} (${runInBatch}/${totalRuns} in batch)`,
      );

      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { result, stderr } = await withStderrCapture(async () => {
        const recognition = withLines
          ? await worker.recognize(images[imageIndex]!, {}, { text: true, blocks: true })
          : await worker.recognize(images[imageIndex]!);
        if (withLines) {
          lines.push(
            (recognition.data.blocks ?? []).flatMap((block) =>
              block.paragraphs.flatMap((paragraph) =>
                paragraph.lines.map((line) => ({ text: line.text, bbox: { ...line.bbox } })),
              ),
            ),
          );
        }
        return recognition.data.text ?? '';
      });
      texts.push(result);

      const chars = result.trim().length;
      appendImportJobDebug(`Tesseract run ${run}: done — ${chars} characters`);

      const notableStderr = stderr.filter((line) => STDERR_PATTERNS.test(line));
      if (notableStderr.length > 0) {
        for (const line of notableStderr) {
          const tagged = `tesseract native [${label} img ${imageIndex + 1} psm ${psm}]: ${line}`;
          logLines.push(tagged);
          appendImportJobDebug(tagged);
        }
      }
    }
  }

  pushDebug(logLines);
  return withLines ? { texts, logLines, lines } : { texts, logLines };
}

/** Run Tesseract on one or more PNG buffers; capture logger, errorHandler, and process stderr. */
export async function recognizeTesseractBatch(
  images: Buffer[],
  cachePath: string,
  psmModes: PSM[],
  label: string,
  options?: TesseractRecognizeOptions,
): Promise<TesseractBatchResult> {
  const worker = await openTesseractWorker(cachePath, label);
  try {
    return await recognizeImagesOnWorker(worker, images, psmModes, label, options);
  } finally {
    await worker.terminate();
  }
}

async function withStderrCapture<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string[] }> {
  const stderr: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  const patched = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) stderr.push(trimmed);
    }
    return original(chunk as never, ...(args as never[]));
  }) as typeof process.stderr.write;
  process.stderr.write = patched;
  try {
    const result = await fn();
    return { result, stderr };
  } finally {
    process.stderr.write = original;
  }
}
