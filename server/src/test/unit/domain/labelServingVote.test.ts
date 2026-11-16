import assert from 'node:assert/strict';
import test from 'node:test';
import { voteServingFields } from '../../../domain/labelServingVote.js';
import { parseNutritionLabel } from '../../../domain/parseLabel.js';

test('serving fields come from whichever OCR candidates read the header rows', () => {
  const voted = voteServingFields([
    'sing per container fF\nCalories 150\nTotal Fat 2.5g',
    '1 serving per container\nServing size 1 bottle (340 mL)\nCalories 150',
    '1 serving per container\nServing size 1 bottle (340 mL)\nCalories 150',
    'Serving size 2 bottles (680 mL)\nCalories 300',
  ]);
  assert.equal(voted.servingLabel, '1 bottle (340 mL)');
  assert.equal(voted.servingsPerContainer, 1);
});

test('servings per container read by only one of several candidates is not trusted', () => {
  const voted = voteServingFields([
    'serving per container =28) Serving Size 1 Bottle (340 mL)\nCalories 150',
    'Serving size 1 bottle (340 mL)\nCalories 150',
    'Calories 150\nProtein 30g',
  ]);
  assert.equal(voted.servingsPerContainer, null);
  assert.equal(voted.servingLabel?.toLowerCase(), '1 bottle (340 ml)');
});

test('no header rows in any candidate leaves serving fields empty', () => {
  assert.deepEqual(voteServingFields(['Calories 150\nProtein 30g']), { servingLabel: null, servingsPerContainer: null });
});

test('label parse reads trans fat, added sugars and minerals with their own units', () => {
  const parsed = parseNutritionLabel(
    [
      'Nutrition Facts',
      'Calories 170',
      'Total Fat 4.5g 6%',
      'Trans Fat 0.5g',
      'Total Sugars 20g',
      'Includes 16g Added Sugars 32%',
      'Protein 5g',
      'Vitamin D 0.2mcg 0%',
      'Calcium 130mg 10%',
      'Iron 0.8mg 4%',
      'Potassium 200mg 4%',
    ].join('\n'),
  );
  const extras = Object.fromEntries(parsed.nutrients.extras.map((e) => [e.key, `${e.amount}${e.unit}`]));
  assert.equal(extras.trans_fat, '0.5g');
  assert.equal(extras.added_sugars, '16g');
  assert.equal(extras.vitamin_d, '0.2mcg');
  assert.equal(extras.calcium, '130mg');
  assert.equal(extras.iron, '0.8mg');
  assert.equal(extras.potassium, '200mg');
  assert.equal(extras.sugar, '20g');
});
