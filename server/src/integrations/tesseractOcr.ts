import Tesseract, { type PSM } from 'tesseract.js';
import { appendImportJobDebug } from '../import/importJobProgress.js';

export type TesseractBatchResult = {
  texts: string[];
  logLines: string[];
};

const STDERR_PATTERNS =
  /too small to scale|cannot be recognized|empty page|Error during processing/i;

function pushDebug(lines: string[]): void {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    appendImportJobDebug(`tesseract: ${trimmed}`);
  }
}

/** Run Tesseract on one or more PNG buffers; capture logger, errorHandler, and process stderr. */
export async function recognizeTesseractBatch(
  images: Buffer[],
  cachePath: string,
  psmModes: PSM[],
  label: string,
): Promise<TesseractBatchResult> {
  const logLines: string[] = [];
  const texts: string[] = [];
  const worker = await Tesseract.createWorker('eng', 1, {
    cachePath,
    logger: (message) => {
      if (message.status === 'recognizing text') return;
      const line = `tesseract.js [${label}] ${message.status}${message.progress ? ` ${Math.round(message.progress * 100)}%` : ''}`;
      logLines.push(line);
    },
    errorHandler: (error: unknown) => {
      const line = `tesseract.js [${label}] error: ${String(error)}`;
      logLines.push(line);
      appendImportJobDebug(line);
    },
  });

  try {
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      for (const psm of psmModes) {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const { result, stderr } = await withStderrCapture(async () => {
          const recognition = await worker.recognize(images[imageIndex]!);
          return recognition.data.text ?? '';
        });
        texts.push(result);

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
  } finally {
    await worker.terminate();
  }

  pushDebug(logLines);
  return { texts, logLines };
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
