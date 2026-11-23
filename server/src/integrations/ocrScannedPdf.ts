import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PSM } from 'tesseract.js';
import { splitEmbeddedPdfPages } from '../domain/labelTextBlocks.js';
import { appendImportJobDebug, reportImportJobStep } from '../import/importJobProgress.js';
import { extractImageText } from './extractText.js';
import { openTesseractWorker, recognizeImagesOnWorker } from './tesseractOcr.js';

const execFileAsync = promisify(execFile);

/** Minimum non-whitespace chars from pdf-parse before we treat the PDF as text-based. */
const MIN_TEXT_LAYER_CHARS = 80;

/**
 * Two-tier scanned-PDF OCR. Recipe cards and booklets only need plain text —
 * running the full label pipeline (geometry, column strips, EasyOCR) per page
 * is minutes of wasted work. We first read pages with plain Tesseract, classify
 * the document, and only fall back to the full per-page label pipeline when the
 * pages look like nutrition labels rather than recipes/articles.
 */
const PDF_DOC_PSMS = [PSM.AUTO, PSM.SPARSE_TEXT] as const;
/** Pages with less text than this get the full pipeline even in text mode. */
const MIN_PLAINTEXT_PAGE_CHARS = 40;
/** Pages sampled for document classification (front matter is enough). */
const CLASSIFY_PAGE_COUNT = 3;

const RECIPE_HINT = /\b(ingredients?|instructions?|directions?|preheat|serves?\b|servings?\b|prep\b|cook\b|recipe)\b/i;
const LABEL_ONLY_HINT = /nutrition facts|% daily value/i;

type PdfPageMode = 'text' | 'label';

function classifyPdfPages(pageTexts: string[]): PdfPageMode {
  let recipePages = 0;
  let labelOnlyPages = 0;
  for (const text of pageTexts) {
    if (!text.trim()) continue;
    if (RECIPE_HINT.test(text)) recipePages += 1;
    else if (LABEL_ONLY_HINT.test(text)) labelOnlyPages += 1;
  }
  return recipePages > labelOnlyPages ? 'text' : 'label';
}

/** Plain Tesseract pass over page images; returns the longer PSM result per page. */
async function fastOcrPdfPages(images: Buffer[], tessdataDir: string, jobLabel: string): Promise<string[]> {
  const worker = await openTesseractWorker(tessdataDir, jobLabel);
  try {
    const { texts } = await recognizeImagesOnWorker(worker, images, [...PDF_DOC_PSMS], jobLabel);
    const perPage: string[] = [];
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      let best = '';
      for (let psmIndex = 0; psmIndex < PDF_DOC_PSMS.length; psmIndex += 1) {
        const candidate = texts[imageIndex * PDF_DOC_PSMS.length + psmIndex] ?? '';
        if (candidate.trim().length > best.trim().length) best = candidate;
      }
      perPage.push(best);
    }
    return perPage;
  } finally {
    await worker.terminate();
  }
}

export async function extractPdfTextWithOcrFallback(
  bytes: Buffer,
  tessdataDir: string,
  easyocrModelDir?: string,
): Promise<{ text: string; usedOcr: boolean; pageTexts: string[] }> {
  const { extractPdfText } = await import('./extractText.js');
  const embeddedRaw = stripPdfPageMarkers(await extractPdfText(bytes));
  const embeddedPages = splitEmbeddedPdfPages(embeddedRaw);
  const embedded = embeddedRaw.replace(/\s+/g, ' ').trim();
  reportImportJobStep('PDF', 'Reading PDF on server…', 'Extracting embedded text when available.');
  if (embedded.length >= MIN_TEXT_LAYER_CHARS) {
    return { text: embedded, usedOcr: false, pageTexts: embeddedPages };
  }
  reportImportJobStep('OCR', 'Scanning PDF pages…', 'Rasterizing and running OCR — large files can take a minute.');
  const pageTexts = await ocrPdfPageTexts(bytes, tessdataDir, easyocrModelDir);
  const ocrText = pageTexts.join('\n\n');
  if (ocrText.trim()) return { text: ocrText, usedOcr: true, pageTexts };
  return { text: embedded, usedOcr: false, pageTexts: embeddedPages };
}

/**
 * pdf-parse emits "-- N of M --" page markers even for image-only scans;
 * they are not a text layer and must not count toward embedded-text detection.
 */
function stripPdfPageMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*-{1,3}\s*\d+\s+(?:of|\/)\s*\d+\s*-{1,3}\s*$/.test(line))
    .join('\n');
}

async function ocrPdfPageTexts(bytes: Buffer, tessdataDir: string, easyocrModelDir?: string): Promise<string[]> {
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
    const pageCount = files.length;
    const images = await Promise.all(files.map((name) => readFile(path.join(dir, name))));

    // Cheap plain-text pass on the first pages decides the document mode.
    const classifyCount = Math.min(CLASSIFY_PAGE_COUNT, pageCount);
    reportImportJobStep('OCR', `Reading PDF text… ${Math.min(classifyCount, pageCount)}/${pageCount} pages`, 'Fast text pass to detect document type.');
    const probeTexts = await fastOcrPdfPages(images.slice(0, classifyCount), tessdataDir, 'pdf-doc-probe');
    const mode = classifyPdfPages(probeTexts);
    appendImportJobDebug(`pdf ocr: mode=${mode} (recipe-ish=${probeTexts.filter((t) => RECIPE_HINT.test(t)).length}, label-ish=${probeTexts.filter((t) => !RECIPE_HINT.test(t) && LABEL_ONLY_HINT.test(t)).length} of ${classifyCount} probed)`);

    const chunks: string[] = [];
    if (mode === 'text') {
      // Fast pass over the remaining pages, then assemble per-page text.
      reportImportJobStep('OCR', `Reading PDF text… ${pageCount}/${pageCount} pages`, 'Recipe-style document — plain text OCR.');
      const restTexts = pageCount > classifyCount
        ? await fastOcrPdfPages(images.slice(classifyCount), tessdataDir, 'pdf-doc-text')
        : [];
      const pageTexts = [...probeTexts, ...restTexts];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const name = files[pageIndex]!;
        appendImportJobDebug(`pdf ocr: page ${pageIndex + 1}/${pageCount} (text mode)`);
        let pageText = pageTexts[pageIndex] ?? '';
        // Thin pages may be covers, rotated scans, or dense labels — give them
        // the full pipeline rather than returning garbage.
        if (pageText.trim().length < MIN_PLAINTEXT_PAGE_CHARS) {
          reportImportJobStep('OCR', `OCR page ${pageIndex + 1}/${pageCount}…`, path.basename(name));
          pageText = await extractImageText(images[pageIndex]!, tessdataDir, easyocrModelDir ? { easyocrModelDir } : undefined);
        }
        if (pageText.trim()) chunks.push(pageText.trim());
      }
      return chunks;
    }

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const name = files[pageIndex]!;
      appendImportJobDebug(`pdf ocr: page ${pageIndex + 1}/${pageCount}`);
      reportImportJobStep('OCR', `OCR page ${pageIndex + 1}/${pageCount}…`, path.basename(name));
      const pageText = await extractImageText(images[pageIndex]!, tessdataDir, easyocrModelDir ? { easyocrModelDir } : undefined);
      if (pageText.trim()) chunks.push(pageText.trim());
    }
    return chunks;
  } catch {
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
