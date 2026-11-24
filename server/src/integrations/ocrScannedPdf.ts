import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PSM } from 'tesseract.js';
import { splitEmbeddedPdfPages } from '../domain/labelTextBlocks.js';
import { reconstructRecipePageLayout, type RecipePageLayout } from '../domain/recipeCardLayout.js';
import { appendImportJobDebug, reportImportJobProgress, reportImportJobStep } from '../import/importJobProgress.js';
import { extractImageText } from './extractText.js';
import type { Worker } from 'tesseract.js';
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
/** Pages with less text than this get a sparse-text retry, then the full pipeline. */
const MIN_PLAINTEXT_PAGE_CHARS = 40;
/** Pages sampled for document classification (front matter is enough). */
const CLASSIFY_PAGE_COUNT = 3;
/** Each Tesseract worker holds its own WASM engine (~150MB); pages are independent. */
const MAX_PDF_OCR_WORKERS = 3;

/** Recipe-card cues. Not bare "servings" — labels print "servings per container" / "serving size". */
const RECIPE_HINT = /\b(?:instructions?|directions|preheat|recipe|prep|cook time|\d+\s+servings\b(?!\s+per)|serves\s+\d+|what you'?ll need|ingredients)\b/gi;
const LABEL_HINT = /nutrition facts|% ?daily value|servings? per container/i;

function recipeHintCount(text: string): number {
  return new Set([...text.matchAll(RECIPE_HINT)].map((match) => match[0].toLowerCase().replace(/\d+\s+/, ''))).size;
}

/** Label pages may mention "Ingredients" or "Directions" once; recipe pages carry several recipe cues. */
function pageKind(text: string): PdfPageMode | null {
  if (!text.trim()) return null;
  const recipeHits = recipeHintCount(text);
  if (LABEL_HINT.test(text) && recipeHits < 2) return 'label';
  return recipeHits > 0 ? 'text' : null;
}

export type PdfPageMode = 'text' | 'label';

export type PdfOcrResult = {
  text: string;
  usedOcr: boolean;
  pageTexts: string[];
  /** Recipe-card geometry per entry of `pageTexts` (text-mode OCR only). */
  pageLayouts: Array<RecipePageLayout | null> | null;
};

export function classifyPdfPages(pageTexts: string[]): PdfPageMode {
  let recipePages = 0;
  let labelPages = 0;
  for (const text of pageTexts) {
    const kind = pageKind(text);
    if (kind === 'text') recipePages += 1;
    else if (kind === 'label') labelPages += 1;
  }
  return recipePages > labelPages ? 'text' : 'label';
}

export function pdfOcrWorkerCount(pageCount: number): number {
  return Math.max(1, Math.min(MAX_PDF_OCR_WORKERS, availableParallelism(), pageCount));
}

type FastPage = { text: string; layout: RecipePageLayout | null };

function isRecipeFront(page: FastPage | undefined): boolean {
  return Boolean(page?.layout && page.layout.ingredients.length >= 2);
}

/**
 * Pages per recipe card from the probe pages (front, back, front → 2), or null
 * when the probe does not show a repeating card pattern.
 */
export function pagesPerRecipeCard(probe: Array<{ layout: RecipePageLayout | null }>): number | null {
  const fronts = probe.flatMap((page, index) => (isRecipeFront(page as FastPage) ? [index] : []));
  if (fronts.length >= 2 && fronts[0] === 0) return fronts[1]! - fronts[0]!;
  return null;
}

/** "Importing recipe 3/9" (or "Importing recipe 3" without an estimate) as OCR finishes pages. */
export function recipeImportProgressMessage(pagesDone: number, pageCount: number, perCard: number | null): string {
  if (!perCard) return `Reading PDF pages… ${pagesDone}/${pageCount}`;
  const total = Math.max(1, Math.ceil(pageCount / perCard));
  const current = Math.min(total, Math.floor(Math.max(0, pagesDone - 1) / perCard) + 1);
  return `Importing recipe ${current}/${total}`;
}

type TesseractPool = { workers: Worker[]; terminate: () => Promise<void> };

async function openTesseractPool(tessdataDir: string, size: number, jobLabel: string): Promise<TesseractPool> {
  const workers = await Promise.all(
    Array.from({ length: size }, (_unused, index) => openTesseractWorker(tessdataDir, `${jobLabel}-${index + 1}`)),
  );
  return { workers, terminate: async () => { await Promise.all(workers.map((worker) => worker.terminate())); } };
}

/**
 * Plain Tesseract (PSM.AUTO keeps columns as separate blocks) over page images,
 * pages pulled from a shared queue by each pool worker; returns text plus
 * recipe-card layout per page.
 */
async function fastOcrPdfPages(
  pool: TesseractPool,
  images: Buffer[],
  jobLabel: string,
  onPageDone: (done: number) => void,
): Promise<FastPage[]> {
  const results: FastPage[] = new Array(images.length);
  let next = 0;
  let done = 0;
  await Promise.all(pool.workers.map(async (worker) => {
    while (next < images.length) {
      const pageIndex = next;
      next += 1;
      const image = images[pageIndex]!;
      const auto = await recognizeImagesOnWorker(worker, [image], [PSM.AUTO], jobLabel, { withWords: true });
      let text = auto.texts[0] ?? '';
      const layout = reconstructRecipePageLayout(auto.words?.[0] ?? []);
      if (text.trim().length < MIN_PLAINTEXT_PAGE_CHARS) {
        const sparse = await recognizeImagesOnWorker(worker, [image], [PSM.SPARSE_TEXT], jobLabel);
        if ((sparse.texts[0] ?? '').trim().length > text.trim().length) text = sparse.texts[0] ?? '';
      }
      results[pageIndex] = { text, layout };
      done += 1;
      onPageDone(done);
    }
  }));
  return results;
}

export async function extractPdfTextWithOcrFallback(
  data: Buffer | string,
  tessdataDir: string,
  easyocrModelDir?: string,
): Promise<PdfOcrResult> {
  const { extractPdfText } = await import('./extractText.js');
  const embeddedRaw = stripPdfPageMarkers(await extractPdfText(data));
  const embeddedPages = splitEmbeddedPdfPages(embeddedRaw);
  const embedded = embeddedRaw.replace(/\s+/g, ' ').trim();
  reportImportJobStep('Load', 'Loading PDF…', 'Reading embedded text when available.');
  if (embedded.length >= MIN_TEXT_LAYER_CHARS) {
    return { text: embedded, usedOcr: false, pageTexts: embeddedPages, pageLayouts: null };
  }
  reportImportJobStep('Scan', 'Scanning PDF pages…', 'Rasterizing pages for OCR — large files can take a minute.');
  const { pageTexts, pageLayouts } = await ocrPdfPageTexts(data, tessdataDir, easyocrModelDir);
  const ocrText = pageTexts.join('\n\n');
  if (ocrText.trim()) return { text: ocrText, usedOcr: true, pageTexts, pageLayouts };
  return { text: embedded, usedOcr: false, pageTexts: embeddedPages, pageLayouts: null };
}

/**
 * pdf-parse emits "-- N of M --" page markers even for image-only scans;
 * they are not a text layer and must not count toward embedded-text detection.
 */
export function stripPdfPageMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*-{1,3}\s*\d+\s+(?:of|\/)\s*\d+\s*-{1,3}\s*$/.test(line))
    .join('\n');
}

async function ocrPdfPageTexts(
  data: Buffer | string,
  tessdataDir: string,
  easyocrModelDir?: string,
): Promise<{ pageTexts: string[]; pageLayouts: Array<RecipePageLayout | null> | null }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nt-pdf-ocr-'));
  // A string is a path to an already-stored upload — rasterize it in place
  // rather than buffering a copy. Buffers still get written for callers
  // that only have bytes (tests, URL imports).
  const inputPath = typeof data === 'string' ? data : path.join(dir, 'input.pdf');
  const prefix = path.join(dir, 'page');
  const fullPipelineOptions = easyocrModelDir ? { easyocrModelDir } : undefined;
  try {
    if (typeof data !== 'string') await writeFile(inputPath, data);
    await execFileAsync('pdftoppm', ['-png', '-r', '200', inputPath, prefix], { timeout: 600_000 });
    const files = (await readdir(dir))
      .filter((name) => name.startsWith('page') && name.endsWith('.png'))
      .sort();
    const pageCount = files.length;
    reportImportJobStep('Scan', `Scanned ${pageCount} pages`, 'Running OCR on each page.');
    const images = await Promise.all(files.map((name) => readFile(path.join(dir, name))));

    // Cheap plain-text pass on the first pages decides the document mode.
    const classifyCount = Math.min(CLASSIFY_PAGE_COUNT, pageCount);
    reportImportJobProgress('OCR', `Reading PDF pages… 0/${pageCount}`, 'Checking what kind of document this is', 0, pageCount);
    let perCard: number | null = null;
    const reportFast = (offset: number) => (done: number) => {
      const pagesDone = offset + done;
      reportImportJobProgress(
        'OCR',
        `OCR page ${pagesDone}/${pageCount}`,
        perCard ? recipeImportProgressMessage(pagesDone, pageCount, perCard) : `Page ${pagesDone} of ${pageCount}`,
        pagesDone,
        pageCount,
      );
    };
    const pool = await openTesseractPool(tessdataDir, pdfOcrWorkerCount(pageCount), 'pdf-doc-text');
    let probe: FastPage[];
    let rest: FastPage[] = [];
    let mode: PdfPageMode;
    try {
      probe = await fastOcrPdfPages(pool, images.slice(0, classifyCount), 'pdf-doc-probe', reportFast(0));
      mode = classifyPdfPages(probe.map((page) => page.text));
      perCard = mode === 'text' ? pagesPerRecipeCard(probe) : null;
      if (mode === 'text' && pageCount > classifyCount) {
        rest = await fastOcrPdfPages(pool, images.slice(classifyCount), 'pdf-doc-text', reportFast(classifyCount));
      }
    } finally {
      await pool.terminate();
    }
    const probeKinds = probe.map((page) => pageKind(page.text));
    appendImportJobDebug(`pdf ocr: mode=${mode} (recipe-ish=${probeKinds.filter((kind) => kind === 'text').length}, label-ish=${probeKinds.filter((kind) => kind === 'label').length} of ${classifyCount} probed)`);

    const pageTexts: string[] = [];
    if (mode === 'text') {
      const pages = [...probe, ...rest];
      const pageLayouts: Array<RecipePageLayout | null> = [];
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const page = pages[pageIndex]!;
        let pageText = page.text;
        // Still-thin pages may be rotated scans or dense labels — give them the full pipeline.
        if (pageText.trim().length < MIN_PLAINTEXT_PAGE_CHARS) {
          reportImportJobProgress('OCR', `OCR page ${pageIndex + 1}/${pageCount}`, path.basename(files[pageIndex]!), pageIndex + 1, pageCount);
          pageText = await extractImageText(images[pageIndex]!, tessdataDir, fullPipelineOptions);
        }
        if (!pageText.trim()) continue;
        pageTexts.push(pageText.trim());
        pageLayouts.push(page.layout);
      }
      return { pageTexts, pageLayouts };
    }

    // Label mode stays sequential: the full pipeline may start heavy EasyOCR workers per page.
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      appendImportJobDebug(`pdf ocr: page ${pageIndex + 1}/${pageCount}`);
      reportImportJobProgress('OCR', `OCR page ${pageIndex + 1}/${pageCount}`, path.basename(files[pageIndex]!), pageIndex + 1, pageCount);
      const pageText = await extractImageText(images[pageIndex]!, tessdataDir, fullPipelineOptions);
      if (pageText.trim()) pageTexts.push(pageText.trim());
    }
    return { pageTexts, pageLayouts: null };
  } catch (error) {
    appendImportJobDebug(`pdf ocr failed: ${error instanceof Error ? error.message : String(error)}`);
    return { pageTexts: [], pageLayouts: null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
