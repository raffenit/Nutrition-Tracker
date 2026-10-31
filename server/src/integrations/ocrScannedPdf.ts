import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { extractImageText } from './extractText.js';

const execFileAsync = promisify(execFile);

/** Minimum non-whitespace chars from pdf-parse before we treat the PDF as text-based. */
const MIN_TEXT_LAYER_CHARS = 80;

export async function extractPdfTextWithOcrFallback(
  bytes: Buffer,
  tessdataDir: string,
  easyocrModelDir?: string,
): Promise<{ text: string; usedOcr: boolean }> {
  const { extractPdfText } = await import('./extractText.js');
  const embedded = (await extractPdfText(bytes)).replace(/\s+/g, ' ').trim();
  if (embedded.length >= MIN_TEXT_LAYER_CHARS) {
    return { text: embedded, usedOcr: false };
  }
  const ocrText = await ocrPdfPages(bytes, tessdataDir, easyocrModelDir);
  if (ocrText.trim()) return { text: ocrText, usedOcr: true };
  return { text: embedded, usedOcr: false };
}

async function ocrPdfPages(bytes: Buffer, tessdataDir: string, easyocrModelDir?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nt-pdf-ocr-'));
  const inputPath = path.join(dir, 'input.pdf');
  const prefix = path.join(dir, 'page');
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(inputPath, bytes);
    await execFileAsync('pdftoppm', ['-png', '-r', '200', inputPath, prefix], { timeout: 120_000 });
    const files = (await readdir(dir))
      .filter((name) => name.startsWith('page') && name.endsWith('.png'))
      .sort();
    const chunks: string[] = [];
    for (const name of files) {
      const image = await readFile(path.join(dir, name));
      const pageText = await extractImageText(image, tessdataDir, easyocrModelDir ? { easyocrModelDir } : undefined);
      if (pageText.trim()) chunks.push(pageText.trim());
    }
    return chunks.join('\n\n');
  } catch {
    return '';
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
