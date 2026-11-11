import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLeadingQuantityUnit } from '../../../domain/parseIngredientLine.js';

test('parseLeadingQuantityUnit reads oz and name', () => {
  const parsed = parseLeadingQuantityUnit('12 oz boneless chicken thighs');
  assert.deepEqual(parsed, { name: 'boneless chicken thighs', quantity: 12, unit: 'oz' });
});

test('parseLeadingQuantityUnit reads fractions', () => {
  const parsed = parseLeadingQuantityUnit('1/2 cup diced onion');
  assert.ok(parsed);
  assert.equal(parsed?.quantity, 0.5);
  assert.equal(parsed?.unit, 'cup');
});

test('parseLeadingQuantityUnit returns null without qty pattern', () => {
  assert.equal(parseLeadingQuantityUnit('chicken thighs'), null);
});
