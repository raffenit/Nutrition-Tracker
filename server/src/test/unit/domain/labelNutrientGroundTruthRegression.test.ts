import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateNutrientGroundTruthRegression } from '../../../domain/labelNutrientGroundTruthRegression.js';

test('evaluateNutrientGroundTruthRegression: shared_rail calorie columns', () => {
  const compare = {
    columns: [],
    summary: {
      layout: 'shared_rail' as const,
      columnCount: 10,
      matchedColumnCount: 3,
      totalCells: 10,
      ok: 3,
      off: 0,
      unusable: 7,
    },
  };
  assert.equal(
    evaluateNutrientGroundTruthRegression({
      compare,
      spec: { minCalorieColumnsMatch: 3 },
    }).pass,
    true,
  );
  assert.equal(
    evaluateNutrientGroundTruthRegression({
      compare,
      spec: { minCalorieColumnsMatch: 4 },
    }).pass,
    false,
  );
});