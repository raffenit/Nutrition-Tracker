import assert from 'node:assert/strict';
import test from 'node:test';
import { humanizeImportDebugLine } from '../../../import/importJobTelegraph.js';

function ui(line: string): string | null {
  return humanizeImportDebugLine(line, { audience: 'ui' });
}

test('humanizeImportDebugLine covers shared-rail OCR routing', () => {
  assert.match(ui('geometry: shared-rail plan (10 value cols) — skip full-page OCR') ?? '', /shared label table/i);
  assert.match(
    ui('shared-label grid: label 120px, 10 value columns (ruled-grid detect)') ?? '',
    /10 product columns/i,
  );
  assert.match(
    ui('shared-label grid: batched row-band OCR (15 slices × 11 columns, one worker)') ?? '',
    /row by row/i,
  );
  assert.equal(ui('shared-label grid value 4/10'), '__VALUE_PROGRESS__:4/10');
  assert.match(
    ui('shared-label grid: reading header stacks (10 product columns)') ?? '',
    /header stacks/i,
  );
  assert.equal(ui('shared-label grid: header column 3/10 OCR 42 chars'), '__HEADER_PROGRESS__:3/10');
  assert.match(
    ui('shared-label grid: row-band yielded no macro columns — fallback to body-column OCR') ?? '',
    /full-column OCR/i,
  );
  assert.match(
    ui(
      'shared-label grid: row-band weak macros (calories_row_cells_not_numeric, plausibleCalories=0) — fallback to body-column OCR',
    ) ?? '',
    /Calories row unreliable/i,
  );
  assert.match(ui('shared-label grid: stitch OK — 9 products (7 with macros)') ?? '', /Stitched 9/);
});

test('humanizeImportDebugLine covers column-strip and fallback paths', () => {
  assert.match(ui('column-strip: stitch OK — 3 products') ?? '', /Stitched 3/);
  assert.match(ui('column-strip: detect returned null') ?? '', /full-page OCR/i);
  assert.match(
    ui('geometry: shared-rail stitch unavailable — import will pad 10 placeholder panel(s)') ?? '',
    /placeholder/i,
  );
  assert.match(ui('per-column variety pack: 4 ruled product columns') ?? '', /Variety pack/i);
});

test('humanizeImportDebugLine covers PDF and failure telegraph', () => {
  assert.match(ui('pdf ocr: page 2/5') ?? '', /page 2 of 5/i);
  assert.match(ui('readExtractedText:image: failed (boom)') ?? '', /Could not read file/i);
  assert.match(ui('easyocr subprocess: failed (timeout)') ?? '', /Neural OCR unavailable/i);
  assert.match(ui('ocr preprocess: variant build failed — bad extract area') ?? '', /Image prep issue/i);
});

test('humanizeImportDebugLine suppresses noisy OCR on UI', () => {
  assert.equal(ui('Tesseract run 1: start — full'), null);
  assert.equal(ui('ocr full: 4 variant(s) for profile default'), null);
  assert.equal(ui('value 2 slice 3: 24×300px (below min)'), null);
});