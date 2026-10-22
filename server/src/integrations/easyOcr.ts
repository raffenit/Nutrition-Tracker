import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function isEasyOcrEnabled(): boolean {
  return process.env.EASYOCR_ENABLED !== '0' && process.env.EASYOCR_ENABLED !== 'false';
}

export function easyOcrScriptPath(): string {
  const fromDist = path.resolve(MODULE_DIR, '../../python/easyocr_label.py');
  if (existsSync(fromDist)) return fromDist;
  return path.resolve(MODULE_DIR, '../../../python/easyocr_label.py');
}

/** Neural OCR (CRAFT + CRNN via EasyOCR). Returns null when disabled or Python deps missing. */
export async function extractEasyOcrText(bytes: Buffer, modelDir: string): Promise<string | null> {
  if (!isEasyOcrEnabled()) return null;
  const script = easyOcrScriptPath();
  if (!existsSync(script)) return null;

  const python = process.env.EASYOCR_PYTHON?.trim() || 'python3';
  const dir = await mkdtemp(path.join(tmpdir(), 'nt-easyocr-'));
  const imagePath = path.join(dir, 'label.jpg');
  try {
    await writeFile(imagePath, bytes);
    const { stdout } = await execFileAsync(python, [script, imagePath, modelDir], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const text = stdout.trim();
    return text || null;
  } catch {
    return null;
  } finally {
    await unlink(imagePath).catch(() => undefined);
  }
}
