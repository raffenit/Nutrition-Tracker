import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLeadingQuantityUnit, splitIngredientPrefix } from '../../../domain/parseIngredientLine.js';

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

test('parseLeadingQuantityUnit reads unicode fractions', () => {
  const parsed = parseLeadingQuantityUnit('½ cup white quinoa');
  assert.deepEqual(parsed, { name: 'white quinoa', quantity: 0.5, unit: 'cup' });
});

test('parseLeadingQuantityUnit reads mixed numbers', () => {
  const parsed = parseLeadingQuantityUnit('1½ cups rolled oats');
  assert.deepEqual(parsed, { name: 'rolled oats', quantity: 1.5, unit: 'cup' });
});

test('parseLeadingQuantityUnit reads bare counts as unit', () => {
  const parsed = parseLeadingQuantityUnit('2 eggs, beaten');
  assert.deepEqual(parsed, { name: 'eggs, beaten', quantity: 2, unit: 'unit' });
});

test('parseLeadingQuantityUnit reads capitalized bare counts', () => {
  const parsed = parseLeadingQuantityUnit('2 Eggs');
  assert.deepEqual(parsed, { name: 'Eggs', quantity: 2, unit: 'unit' });
});

test('parseLeadingQuantityUnit reads x-counts and sprigs', () => {
  assert.deepEqual(parseLeadingQuantityUnit('2x eggs'), { name: 'eggs', quantity: 2, unit: 'x' });
  assert.deepEqual(parseLeadingQuantityUnit('3 sprigs fresh thyme'), { name: 'fresh thyme', quantity: 3, unit: 'sprig' });
});

test('parseLeadingQuantityUnit reads mixed vulgar fractions', () => {
  const parsed = parseLeadingQuantityUnit('1 1/2 cups flour');
  assert.deepEqual(parsed, { name: 'flour', quantity: 1.5, unit: 'cup' });
});

test('splitIngredientPrefix keeps the raw quantity text', () => {
  assert.deepEqual(splitIngredientPrefix('1/2 cup white quinoa'), { prefix: '1/2 cup', name: 'white quinoa' });
  assert.deepEqual(splitIngredientPrefix('2 eggs, beaten'), { prefix: '2', name: 'eggs, beaten' });
  assert.deepEqual(splitIngredientPrefix('2x eggs'), { prefix: '2x', name: 'eggs' });
  assert.deepEqual(splitIngredientPrefix('broccoli'), null);
});
