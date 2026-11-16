import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractImageLabel, type ImageLabelExtraction } from '../../integrations/extractText.js';

/**
 * Full-pipeline OCR on local photos is the slowest part of `npm test` (tens of seconds per image).
 * Several localFixtures tests OCR the same photo, so results are cached on disk under
 * `local/.ocr-test-cache/`, keyed by image bytes + a hash of every compiled production module.
 * Any change to non-test source invalidates the cache. `OCR_TEST_CACHE=0` always runs OCR.
 */
const compiledRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(compiledRoot, '../..');
const cacheDir = path.join(repoRoot, 'local', '.ocr-test-cache');

let codeHashMemo: string | null = null;

function productionCodeHash(): string {
  if (codeHashMemo) return codeHashMemo;
  const hash = createHash('sha256');
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(compiledRoot, 'test')) walk(full);
      } else if (entry.name.endsWith('.js')) {
        hash.update(path.relative(compiledRoot, full));
        hash.update(readFileSync(full));
      }
    }
  };
  walk(compiledRoot);
  hash.update(JSON.stringify({ portrait: process.env.OCR_PORTRAIT_SINGLE ?? '', easy: process.env.EASYOCR_ENABLED ?? '' }));
  codeHashMemo = hash.digest('hex').slice(0, 16);
  return codeHashMemo;
}

function cacheEnabled(): boolean {
  const flag = process.env.OCR_TEST_CACHE;
  return flag !== '0' && flag !== 'false';
}

export async function extractImageLabelCached(
  bytes: Buffer,
  tessCachePath: string,
  options?: { easyocrModelDir?: string },
): Promise<ImageLabelExtraction> {
  if (!cacheEnabled()) return extractImageLabel(bytes, tessCachePath, options);
  const codeHash = productionCodeHash();
  const imageHash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${codeHash}-${imageHash}.json`);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ImageLabelExtraction;
    } catch {
      rmSync(file, { force: true });
    }
  }
  const result = await extractImageLabel(bytes, tessCachePath, options);
  mkdirSync(cacheDir, { recursive: true });
  for (const stale of readdirSync(cacheDir)) {
    if (!stale.startsWith(`${codeHash}-`)) rmSync(path.join(cacheDir, stale), { force: true });
  }
  writeFileSync(file, JSON.stringify(result));
  return result;
}
