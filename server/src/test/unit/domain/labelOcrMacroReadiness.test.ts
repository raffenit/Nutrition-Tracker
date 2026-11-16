import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessCoreMacroReadiness,
  coreImportMacrosReady,
  missingCoreImportMacros,
} from '../../../domain/labelOcrMacroReadiness.js';

describe('labelOcrMacroReadiness', () => {
  it('lists missing core import macros', () => {
    const missing = missingCoreImportMacros({
      calories: 100,
      fat: 0,
      sodium: 200,
      carbs: 10,
      protein: 5,
      fiber: 0,
      extras: [],
    });
    assert.deepEqual(missing, ['fat']);
    assert.equal(
      coreImportMacrosReady({
        calories: 100,
        fat: 2,
        sodium: 200,
        carbs: 10,
        protein: 5,
        fiber: 0,
        extras: [],
      }),
      true,
    );
  });

  const label = (carbs: number) => `
Nutrition Facts
Calories 150
Total Fat 2.5g
Sodium 230mg
Total Carbohydrate ${carbs}g
Dietary Fiber 1g
Total Sugars 2g
Protein 30g
`;

  it('settles when every candidate agrees on core macros', () => {
    const r = assessCoreMacroReadiness([label(4), label(4)]);
    assert.equal(r.settled, true);
    assert.deepEqual(r.contested, []);
  });

  it('does not settle when candidates disagree on a non-zero macro', () => {
    const r = assessCoreMacroReadiness([label(2), label(4)]);
    assert.equal(r.settled, false);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.contested, ['carbs']);
  });

  it('flags carbs smaller than sugars + fiber beyond rounding slack', () => {
    const r = assessCoreMacroReadiness([label(1), label(1)]);
    assert.equal(r.settled, false);
    assert.deepEqual(r.inconsistent, ['carbs<sugar+fiber']);
  });

  it('reports missing macros', () => {
    const r = assessCoreMacroReadiness(['Nutrition Facts\nProtein 30g\n']);
    assert.equal(r.settled, false);
    assert.ok(r.missing.includes('carbs'));
  });

  it('settles on the clean read when Tess glues a misread digit to the label (4g → "dg")', () => {
    // Glyph misread pattern from a real portrait single: the amount is unreadable in most
    // variants and a stray number after the %DV column is picked up instead.
    const candidates = [
      `Nutrition Facts\ncalories 150\nTotal Fat 2.5g 3%\nSodium 230mg 10%\n[Total Carbohydratedg 1% | 2 9\nDietary Fiber 1g 4%\nTotal Sugars 2g\nProtein 30g 60%\n`,
      `Nutrition Facts\nCalories 150\nTotal Fat 2.5g\nSodium 230mg 10%\nTotal Carbohydrate 4g 0h) Se <\nProtein 30g\n`,
      `Nutrition Facts\nCalories 150\nTotalFat 2.5g\nSodium 230mg\nTotal Carbohydrate dg 155 4 6 &\nDietaryFiberlg 4%\nProtein 30g\n`,
    ];
    const r = assessCoreMacroReadiness(candidates);
    assert.equal(r.settled, true);
    assert.equal(r.merged?.carbs, 4);
    assert.equal(r.merged?.fat, 2.5);
  });

  it('stays unsettled when only garbled reads disagree (no clean read to trust)', () => {
    const r = assessCoreMacroReadiness([
      `Nutrition Facts\nCalories 150\nTotal Fat 2.5g\nSodium 230mg\n[Total Carbohydratedg 1% | 2 9\nProtein 30g\n`,
      `Nutrition Facts\nCalories 150\nTotal Fat 2.5g\nSodium 230mg\nTolal Carbohydrate4g\nProtein 30g\n`,
    ]);
    assert.equal(r.settled, false);
    assert.deepEqual(r.contested, ['carbs']);
  });
});
