import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  inferLabelLayoutFromText,
  initialOcrLayoutProfile,
  pickImportTextCandidateIndex,
  shouldRetryWideTableOcr,
  shouldRunColumnStripOcr,
  type LabelLayoutFromText,
  type LabelLayoutHint,
} from '../../../domain/labelLayout.js';
import { MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS } from '../../fixtures/multiProductLabelTables.js';
import { primaryCandidateIndex } from '../../../domain/labelSlotExtract.js';

test('initialOcrLayoutProfile selects wideTable for landscape variety-pack photos', () => {
  assert.equal(initialOcrLayoutProfile({ widePanel: true, width: 2000, height: 1000, aspectRatio: 2 }), 'wideTable');
  assert.equal(initialOcrLayoutProfile({ widePanel: false, width: 1000, height: 1200, aspectRatio: 0.83 }), 'default');
});

test('inferLabelLayoutFromText detects multi-column table among candidates', () => {
  const good = MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS;
  const noisy = 'Nutrition Facts\nCrunchy snack\nCalories 140\nTotal fat 5g';
  const layout = inferLabelLayoutFromText([noisy, good]);
  assert.equal(layout.kind, 'multi_column_table');
  assert.equal(layout.multiProductColumnCount, 3);
  assert.equal(pickImportTextCandidateIndex([noisy, good], layout), 1);
});

test('pickImportTextCandidateIndex uses wide-table heuristic when Part A parse is not ready', () => {
  const tableish = `
Nutrition Facts
Snack A | Snack B | Snack C
calories 90 110 95
total fat 3g 4g 3g
`;
  const single = 'Nutrition Facts\nOne snack\nCalories 90\nTotal fat 3g\nProtein 5g\nSodium 100mg';
  const layout = inferLabelLayoutFromText([single, tableish]);
  assert.equal(layout.kind, 'single');
  assert.equal(pickImportTextCandidateIndex([single, tableish], layout), 1);
});

test('shouldRetryWideTableOcr only when wide image lacks multi-column parse', () => {
  const hint = { widePanel: true, width: 1800, height: 900, aspectRatio: 2 };
  const weak = inferLabelLayoutFromText(['Nutrition Facts\nOne product\nCalories 100']);
  assert.equal(shouldRetryWideTableOcr(hint, weak), true);

  const strong = inferLabelLayoutFromText([MULTI_PRODUCT_FIXTURE_SPACED_COLUMNS]);
  assert.equal(shouldRetryWideTableOcr(hint, strong), false);
});

test('shouldRunColumnStripOcr gate for wide variety-pack recovery', () => {
  const wide: LabelLayoutHint = { widePanel: true, width: 900, height: 300, aspectRatio: 3 };
  const narrow: LabelLayoutHint = { widePanel: false, width: 400, height: 800, aspectRatio: 0.5 };
  const weak: LabelLayoutFromText = {
    kind: 'single',
    bestCandidateIndex: 0,
    multiProductColumnCount: 0,
    nutritionFactsCount: 1,
  };
  const parsed: LabelLayoutFromText = { ...weak, kind: 'multi_column_table', multiProductColumnCount: 3 };
  const almost: LabelLayoutFromText = { ...weak, multiProductColumnCount: 1 };
  const repeated: LabelLayoutFromText = { ...weak, kind: 'repeated_nutrition_facts', nutritionFactsCount: 2 };
  const noNf: LabelLayoutFromText = { ...weak, nutritionFactsCount: 0 };

  assert.equal(shouldRunColumnStripOcr(wide, weak), true);
  assert.equal(shouldRunColumnStripOcr(wide, almost), true);
  assert.equal(shouldRunColumnStripOcr(wide, parsed), false);
  assert.equal(shouldRunColumnStripOcr(wide, repeated), false);
  assert.equal(shouldRunColumnStripOcr(wide, noNf), false);
  assert.equal(shouldRunColumnStripOcr(narrow, weak), false);
});

test('repeated nutrition facts layout picks candidate with most headings', () => {
  const twoPanels = `
Nutrition Facts
Serving size 1 bar
Calories 200
Total fat 10g
Nutrition Facts
Serving size 2 pieces
Calories 180
Total fat 8g
`;
  const onePanel = 'Nutrition Facts\nCalories 120\nTotal fat 4g';
  const layout = inferLabelLayoutFromText([onePanel, twoPanels]);
  assert.equal(layout.kind, 'repeated_nutrition_facts');
  const idx = pickImportTextCandidateIndex([onePanel, twoPanels], layout);
  assert.equal(idx, 1);
  assert.notEqual(idx, primaryCandidateIndex([onePanel, twoPanels]));
});
