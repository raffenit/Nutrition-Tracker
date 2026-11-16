import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  inferNutrientsFromGluedBlobs,
  parseGluedAmountTail,
  parseGluedNutrientBlob,
  parseSodiumIngTail,
} from '../../../domain/gluedLabelAmount.js';
import { parseNutritionLabel } from '../../../domain/parseLabel.js';

test('parseGluedAmountTail: Fat decimal glued letters (2dd → 2.5g)', () => {
  const r = parseGluedAmountTail('2dd', 'total_fat');
  assert.ok(r);
  assert.equal(r.amount, 2.5);
  assert.equal(r.unit, 'g');
});

test('parseGluedNutrientBlob: TotalFat2dd and Sodum2ing', () => {
  const fat = parseGluedNutrientBlob('TotalFat2dd');
  assert.ok(fat);
  assert.equal(fat.slot, 'total_fat');
  assert.equal(fat.amount, 2.5);

  const sod = parseGluedNutrientBlob('Sodum2ing');
  assert.ok(sod);
  assert.equal(sod.slot, 'sodium');
  assert.equal(sod.amount, 230);
});

test('parseSodiumIngTail: digit + ing glue decodes hundreds-level sodium', () => {
  assert.equal(parseSodiumIngTail('230ing'), 230);
  assert.equal(parseSodiumIngTail('2ing'), 230);
});

test('parseGluedNutrientBlob: cholesterol blob (existing pattern)', () => {
  const r = parseGluedNutrientBlob('Icholesterol25mng');
  assert.ok(r);
  assert.equal(r.slot, 'cholesterol');
  assert.equal(r.amount, 25);
});

test('inferNutrientsFromGluedBlobs on interleaved NF line', () => {
  const merged = inferNutrientsFromGluedBlobs('|TotalFat2dd ~~ 3% Sodum2ing _109% Protein30g');
  assert.equal(merged.fat, 2.5);
  assert.equal(merged.sodium, 230);
  assert.equal(merged.protein, 30);
});

test('parseNutritionLabel: protein-shake diagnostic OCR fills fat and sodium', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ocrPath = path.join(here, '../../../../diagnostics/protein-shake-primary-ocr.txt');
  let text: string;
  try {
    text = readFileSync(ocrPath, 'utf8');
  } catch {
    text = [
      '|TotalFat2dd ~~ 3%| 5g',
      'Cholesterol 25mg',
      'Sodum2ing _109%',
      '[Total Carbohydrate dg 13%',
      'Protein 30g',
    ].join('\n');
  }
  const parsed = parseNutritionLabel(text);
  assert.equal(parsed.nutrients.fat, 2.5);
  assert.equal(parsed.nutrients.sodium, 230);
  assert.equal(parsed.nutrients.protein, 30);
});