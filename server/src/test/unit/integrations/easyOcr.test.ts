import assert from 'node:assert/strict';
import { test } from 'node:test';
import { easyOcrPassEnvironments, easyOcrScriptPath, isEasyOcrEnabled } from '../../../integrations/easyOcr.js';

test('EasyOCR script path resolves under server/python', () => {
  const script = easyOcrScriptPath();
  assert.match(script, /easyocr_label\.py$/);
});

test('EasyOCR can be disabled via env', () => {
  const previous = process.env.EASYOCR_ENABLED;
  process.env.EASYOCR_ENABLED = '0';
  assert.equal(isEasyOcrEnabled(), false);
  process.env.EASYOCR_ENABLED = previous;
});

test('EasyOCR defaults to one pass; A/B pass when EASYOCR_AB=1', () => {
  const ab = process.env.EASYOCR_AB;
  const abContrast = process.env.EASYOCR_AB_ADJUST_CONTRAST;
  delete process.env.EASYOCR_AB;
  assert.equal(easyOcrPassEnvironments().length, 1);
  process.env.EASYOCR_AB = '1';
  delete process.env.EASYOCR_AB_ADJUST_CONTRAST;
  const passes = easyOcrPassEnvironments();
  assert.equal(passes.length, 2);
  assert.equal(passes[1]?.EASYOCR_ADJUST_CONTRAST, '0.72');
  if (ab !== undefined) process.env.EASYOCR_AB = ab;
  else delete process.env.EASYOCR_AB;
  if (abContrast !== undefined) process.env.EASYOCR_AB_ADJUST_CONTRAST = abContrast;
});
