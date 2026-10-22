import assert from 'node:assert/strict';
import { test } from 'node:test';
import { easyOcrScriptPath, isEasyOcrEnabled } from '../../../integrations/easyOcr.js';

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
