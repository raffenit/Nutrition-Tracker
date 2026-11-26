import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveIngredientLine } from '../../../domain/kitEcosystemIngredients.js';
import type { IngredientLine } from '../../../types.js';

function line(name: string, extra: Partial<IngredientLine> = {}): IngredientLine {
  return {
    name,
    servings: 1,
    sourceRef: null,
    childFoodId: null,
    componentRole: null,
    shopEquivalentFoodId: null,
    shopEquivalentLabel: null,
    notes: null,
    altMeasurements: [],
    ...extra,
  };
}

const mapping = {
  id: 'm1',
  ecosystemId: 'e1',
  nameKey: 'broccoli',
  kitLineName: 'Broccoli florets',
  shopEquivalentFoodId: null,
  shopEquivalentLabel: null,
  notes: null,
  altMeasurements: [],
  nutritionFoodId: null,
};

test('effectiveIngredientLine preserves the line quantity prefix', () => {
  const result = effectiveIngredientLine(line('2 cups broccoli'), mapping);
  assert.equal(result.name, '2 cups Broccoli florets');
});

test('effectiveIngredientLine replaces bare names wholesale', () => {
  const result = effectiveIngredientLine(line('broccoli'), mapping);
  assert.equal(result.name, 'Broccoli florets');
});

test('effectiveIngredientLine fills nutrition link from mapping when line has none', () => {
  const result = effectiveIngredientLine(
    line('broccoli'),
    { ...mapping, nutritionFoodId: 'f1' },
  );
  assert.equal(result.childFoodId, 'f1');
});

test('effectiveIngredientLine keeps line-level links over mapping', () => {
  const result = effectiveIngredientLine(
    line('broccoli', { childFoodId: 'own' }),
    { ...mapping, nutritionFoodId: 'f1' },
  );
  assert.equal(result.childFoodId, 'own');
});
