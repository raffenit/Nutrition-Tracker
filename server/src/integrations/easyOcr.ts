import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { appendImportJobDebug } from '../import/importJobProgress.js';

const execFileAsync = promisify(execFile);

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Label panel charset — recognition only; detection unchanged. */
const DEFAULT_ALLOWLIST =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .%<>()-_/\\:;gmkcal';

export function isEasyOcrEnabled(): boolean {
  return process.env.EASYOCR_ENABLED !== '0' && process.env.EASYOCR_ENABLED !== 'false';
}

export function easyOcrScriptPath(): string {
  const fromDist = path.resolve(MODULE_DIR, '../../python/easyocr_label.py');
  if (existsSync(fromDist)) return fromDist;
  return path.resolve(MODULE_DIR, '../../../python/easyocr_label.py');
}

type EasyOcrPassEnv = NodeJS.ProcessEnv;

/** Shared Reader/recognition env (decoder, quantize, allowlist, geometry). */
function easyOcrBaseEnv(): EasyOcrPassEnv {
  const env: EasyOcrPassEnv = { ...process.env };
  if (!env.EASYOCR_ALLOWLIST?.trim()) env.EASYOCR_ALLOWLIST = DEFAULT_ALLOWLIST;
  if (!env.EASYOCR_DECODER?.trim()) env.EASYOCR_DECODER = 'wordbeamsearch';
  if (!env.EASYOCR_QUANTIZE?.trim()) env.EASYOCR_QUANTIZE = '1';
  if (!env.EASYOCR_MAG_RATIO?.trim()) env.EASYOCR_MAG_RATIO = '1.6';
  if (!env.EASYOCR_CANVAS_SIZE?.trim()) env.EASYOCR_CANVAS_SIZE = '2560';
  return env;
}

/**
 * Default: one pass (faster). Optional A/B pass with EASYOCR_AB=1 (contrast + looser detection).
 */
export function easyOcrPassEnvironments(): EasyOcrPassEnv[] {
  const base = easyOcrBaseEnv();
  const passes: EasyOcrPassEnv[] = [base];
  if (process.env.EASYOCR_AB !== '1') return passes;

  const ab: EasyOcrPassEnv = {
    ...base,
    EASYOCR_ADJUST_CONTRAST: process.env.EASYOCR_AB_ADJUST_CONTRAST?.trim() || '0.72',
    EASYOCR_TEXT_THRESHOLD: process.env.EASYOCR_AB_TEXT_THRESHOLD?.trim() || '0.58',
    EASYOCR_LOW_TEXT: process.env.EASYOCR_AB_LOW_TEXT?.trim() || '0.32',
    EASYOCR_LINK_THRESHOLD: process.env.EASYOCR_AB_LINK_THRESHOLD?.trim() || '0.32',
  };
  passes.push(ab);
  return passes;
}

/** `lines`: one detected box per line. `rows`: boxes sharing a vertical band joined left-to-right (ruled tables). */
export type EasyOcrLayout = 'lines' | 'rows';

export type EasyOcrJob = {
  bytes: Buffer;
  layout: EasyOcrLayout;
};

type BatchManifestEntry = { file: string; mode: EasyOcrLayout; i: number };

/** One JSONL record per manifest job on stdout. */
type BatchResultLine = { i: number; text?: string; error?: string };

function parseBatchStdout(stdout: string, jobCount: number): (string | null)[] {
  const results: (string | null)[] = Array.from({ length: jobCount }, () => null);
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let record: BatchResultLine;
    try {
      record = JSON.parse(trimmed) as BatchResultLine;
    } catch {
      continue;
    }
    if (typeof record.i !== 'number' || record.i < 0 || record.i >= jobCount) continue;
    if (record.error) {
      appendImportJobDebug(`easyocr batch: job ${record.i} failed (${record.error})`);
      continue;
    }
    const text = (record.text ?? '').trim();
    if (text) results[record.i] = text;
  }
  return results;
}

/**
 * EasyOCR jobs are split across a few worker processes — each worker loads the
 * model once and reads its shard, so N images cost ~min(N, workers) model loads
 * while keeping torch's per-process parallelism (sequential batching was slower
 * wall-clock than parallel processes on multi-core hosts).
 */
function easyOcrWorkerCount(jobCount: number): number {
  const raw = Number(process.env.EASYOCR_BATCH_WORKERS ?? '2');
  const workers = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 2;
  return Math.max(1, Math.min(workers, jobCount));
}

/**
 * Run EasyOCR jobs through batched worker processes (one Reader load per worker
 * per pass). Returns per-job candidate texts (one entry per non-empty pass
 * result, deduped, pass order preserved); `results[i]` aligns with `jobs[i]`.
 */
async function runEasyOcrJobs(
  jobs: EasyOcrJob[],
  modelDir: string,
): Promise<string[][]> {
  const perJob: string[][] = jobs.map(() => []);
  if (!isEasyOcrEnabled() || jobs.length === 0) return perJob;
  const script = easyOcrScriptPath();
  if (!existsSync(script)) return perJob;

  const python = process.env.EASYOCR_PYTHON?.trim() || 'python3';
  const passes = easyOcrPassEnvironments();
  const workerCount = easyOcrWorkerCount(jobs.length);
  const dir = await mkdtemp(path.join(tmpdir(), 'nt-easyocr-batch-'));
  try {
    const shards: BatchManifestEntry[][] = Array.from({ length: workerCount }, () => []);
    for (const [index, job] of jobs.entries()) {
      const file = `${index}.png`;
      await writeFile(path.join(dir, file), job.bytes);
      shards[index % workerCount]!.push({ file, mode: job.layout, i: index });
    }
    const manifestPaths = await Promise.all(
      shards.map(async (shard, worker) => {
        const manifestPath = path.join(dir, `manifest-${worker}.json`);
        await writeFile(manifestPath, JSON.stringify(shard));
        return manifestPath;
      }),
    );

    for (const passEnv of passes) {
      const startedAt = Date.now();
      const shardSize = Math.ceil(jobs.length / workerCount);
      await Promise.all(
        manifestPaths.map(async (manifestPath, worker) => {
          try {
            const { stdout } = await execFileAsync(
              python,
              [script, '--batch', manifestPath, modelDir],
              {
                timeout: Math.min(900_000, 120_000 + shardSize * 120_000),
                maxBuffer: 16 * 1024 * 1024,
                env: passEnv,
              },
            );
            const results = parseBatchStdout(stdout, jobs.length);
            for (const [index, text] of results.entries()) {
              if (text && !perJob[index]!.includes(text)) perJob[index]!.push(text);
            }
          } catch (error: unknown) {
            const reason = error instanceof Error ? error.message : String(error);
            appendImportJobDebug(`easyocr subprocess: batch worker ${worker} failed (${reason})`);
          }
        }),
      );
      appendImportJobDebug(
        `easyocr batch: ${jobs.length} image(s) on ${workerCount} worker(s) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return perJob;
}

/**
 * Same PNG variants as Tesseract (from buildOcrImageVariants) × A/B passes → strings for slot merge.
 */
export async function extractEasyOcrTextsFromVariants(
  variants: Buffer[],
  modelDir: string,
  layout: EasyOcrLayout = 'lines',
): Promise<string[]> {
  if (!isEasyOcrEnabled() || variants.length === 0) return [];
  const perVariant = await runEasyOcrJobs(
    variants.map((bytes) => ({ bytes, layout })),
    modelDir,
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const texts of perVariant) {
    for (const text of texts) {
      if (seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}

/**
 * Per-image EasyOCR candidates for heterogeneous jobs (e.g. split-label halves
 * in one process). `results[i]` aligns with `jobs[i]`.
 */
export async function extractEasyOcrTextsForJobs(
  jobs: EasyOcrJob[],
  modelDir: string,
): Promise<string[][]> {
  return runEasyOcrJobs(jobs, modelDir);
}
