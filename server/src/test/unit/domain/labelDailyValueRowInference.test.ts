import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountReadings,
  appendDailyValueInferredRows,
  inferDailyValueRows,
  percentReadings,
} from '../../../domain/labelDailyValueRowInference.js';
import { mergeSlotReadingsAcrossCandidates } from '../../../domain/labelSlotExtract.js';

test('amountReadings recovers dropped decimals and g read as 0', () => {
  assert.deepEqual(amountReadings('90mg'), [{ value: 90, unit: 'mg', cost: 0 }]);
  assert.deepEqual(amountReadings('IOmg'), [{ value: 10, unit: 'mg', cost: 0 }]);
  const values = amountReadings('350').map((a) => a.value);
  assert.ok(values.includes(3.5));
  assert.ok(amountReadings('45').some((a) => a.value === 4.5));
});

test('percentReadings treats a trailing 9 as a misread %', () => {
  assert.deepEqual(percentReadings('6%').map((p) => p.value), [6]);
  assert.deepEqual(percentReadings('129').map((p) => p.value), [129, 12]);
});

test('unlabeled rows are identified by amount and %DV (dual-column, squashed names)', () => {
  // Names on a curved tub edge read as junk; per-serving then per-container pairs follow.
  const text = [
    'Fa per container',
    'MFa 4.50 6% 14g 18%',
    'SantedFat 350 18 Itg _ 55%',
    'Me IOmg 3 25mg _ 89',
    'M 90mg 4 270mg 129',
  ].join('\n');
  const rows = new Map(inferDailyValueRows(text).map((r) => [r.key, r]));
  assert.equal(rows.get('fat')?.amount, 4.5);
  assert.equal(rows.get('saturated_fat')?.amount, 3.5);
  assert.equal(rows.get('cholesterol')?.amount, 10);
  assert.equal(rows.get('sodium')?.amount, 90);
});

test('per-container pairs after a %DV on the same row are ignored', () => {
  const rows = new Map(inferDailyValueRows('A IUmg 3 25mg 89\nSdFa 95 I8 11g 55%\nwml 3% % 11g 55%').map((r) => [r.key, r]));
  assert.equal(rows.get('cholesterol')?.amount, 10);
  assert.equal(rows.has('saturated_fat'), false);
});

test('ambiguous daily values (protein vs added sugars) are not guessed', () => {
  assert.equal(inferDailyValueRows('xx 5g 10%').length, 0);
});

test('appendDailyValueInferredRows lets slot parsing read fat and sodium without names', () => {
  const text = 'MFa 4.50 6% 14g 18%\nM 90mg 4 270mg 129';
  const merged = mergeSlotReadingsAcrossCandidates([appendDailyValueInferredRows(text)]);
  assert.equal(merged?.fat, 4.5);
  assert.equal(merged?.sodium, 90);
});

test('rows already named in the text are left alone', () => {
  const text = 'Total Fat 4.5g 6%\nSodium 90mg 4%';
  assert.equal(appendDailyValueInferredRows(text), text);
});
