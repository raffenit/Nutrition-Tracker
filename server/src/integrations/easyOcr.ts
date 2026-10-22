import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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
 * Default pass + optional A/B pass (contrast + looser detection thresholds).
 * Disable second pass with EASYOCR_AB=0.
 */
export function easyOcrPassEnvironments(): EasyOcrPassEnv[] {
  const base = easyOcrBaseEnv();
  const passes: EasyOcrPassEnv[] = [base];
  if (process.env.EASYOCR_AB === '0') return passes;

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

async function runEasyOcrOnImage(
  imageBytes: Buffer,
  modelDir: string,
  passEnv: EasyOcrPassEnv,
): Promise<string | null> {
  if (!isEasyOcrEnabled()) return null;
  const script = easyOcrScriptPath();
  if (!existsSync(script)) return null;

  const python = process.env.EASYOCR_PYTHON?.trim() || 'python3';
  const dir = await mkdtemp(path.join(tmpdir(), 'nt-easyocr-'));
  const imagePath = path.join(dir, 'label.png');
  try {
    await writeFile(imagePath, imageBytes);
    const { stdout } = await execFileAsync(python, [script, '--lines', imagePath, modelDir], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      env: passEnv,
    });
    const text = stdout.trim();
    return text || null;
  } catch {
    return null;
  } finally {
    await unlink(imagePath).catch(() => undefined);
  }
}

/**
 * Same PNG variants as Tesseract (from buildOcrImageVariants) × A/B passes → strings for slot merge.
 */
export async function extractEasyOcrTextsFromVariants(
  variants: Buffer[],
  modelDir: string,
): Promise<string[]> {
  if (!isEasyOcrEnabled() || variants.length === 0) return [];
  const passes = easyOcrPassEnvironments();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const image of variants) {
    for (const passEnv of passes) {
      const text = await runEasyOcrOnImage(image, modelDir, passEnv);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
  }
  return out;
}
