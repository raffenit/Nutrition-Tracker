/**
 * Extract primary OCR text + parse snapshot for one local/test-images JPG.
 * Usage: npm run build && node scripts/dump-local-test-image-ocr.mjs protein-shake
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractImageLabel } from '../dist/integrations/extractText.js';
import { inferLabelLayoutFromText } from '../dist/domain/labelLayout.js';
import { parseNutritionLabel } from '../dist/domain/parseLabel.js';

const filter = process.argv[2];
if (!filter) {
  console.error('Usage: node scripts/dump-local-test-image-ocr.mjs <image-basename-substring>');
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(repoRoot, 'local/test-images');
const { readdir } = await import('node:fs/promises');
const names = (await readdir(imageDir)).filter((n) => /\.jpe?g$/i.test(n) && n.includes(filter));
if (names.length !== 1) {
  console.error(`Expected 1 image matching "${filter}", got: ${names.join(', ') || '(none)'}`);
  process.exit(1);
}

const basename = names[0];
const bytes = await readFile(path.join(imageDir, basename));
const tessCache = path.join(repoRoot, 'data/tesseract-cache');
const easyocrModelDir = path.join(repoRoot, 'data/easyocr-models');

const result = await extractImageLabel(bytes, tessCache, { easyocrModelDir });
const layout = inferLabelLayoutFromText([result.text]);
const parsed = parseNutritionLabel(result.text);

const outDir = path.join(repoRoot, 'server/diagnostics');
const stem = basename.replace(/\.jpe?g$/i, '');
const textPath = path.join(outDir, `${stem}-primary-ocr.txt`);
await writeFile(textPath, result.text, 'utf8');

const summary = {
  image: basename,
  layout: layout.kind,
  textLength: result.text.length,
  nutrients: {
    calories: parsed.nutrients.calories,
    fat: parsed.nutrients.fat,
    sodium: parsed.nutrients.sodium,
    carbs: parsed.nutrients.carbs,
    fiber: parsed.nutrients.fiber,
    protein: parsed.nutrients.protein,
    cholesterol: parsed.nutrients.extras.find((e) => e.key === 'cholesterol')?.amount ?? null,
  },
  savedText: textPath,
};
console.log(JSON.stringify(summary, null, 2));