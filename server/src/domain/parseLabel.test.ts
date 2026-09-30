import assert from 'node:assert/strict';
import test from 'node:test';
import { menuCandidates, parseNutritionLabel } from './parseLabel.js';

const LABEL = `
Nutrition Facts
Serving size 1 cup (240ml)
Amount per serving
Calories 120
Calories from fat 45
Total Fat 5g
Sodium 160mg
Total Carbohydrate 12g
Dietary Fiber 2g
Protein 8g
`;

test('reads a standard nutrition label and ignores calories from fat', () => {
  const parsed = parseNutritionLabel(LABEL);
  assert.equal(parsed.servingLabel, '1 cup (240ml)');
  assert.equal(parsed.nutrients.calories, 120);
  assert.equal(parsed.nutrients.fat, 5);
  assert.equal(parsed.nutrients.sodium, 160);
  assert.equal(parsed.nutrients.carbs, 12);
  assert.equal(parsed.nutrients.fiber, 2);
  assert.equal(parsed.nutrients.protein, 8);
  assert.equal(parsed.looksLikeLabel, true);
});

test('joins values that OCR placed on the following line', () => {
  const parsed = parseNutritionLabel('Calories\n90\nProtein\n3g');
  assert.equal(parsed.nutrients.calories, 90);
  assert.equal(parsed.nutrients.protein, 3);
});

const GREEN_CHEF = `
Nutrition Values
Calories 760 kcal
Fat 14.00 g
Saturated Fat 1.50 g
Carbohydrate 112.00 g
Sugar 23.00 g
Dietary Fiber 8.00 g
Protein 43.00 g
Cholesterol 200.00 mg
Sodium 2070.00 mg
`;

test('reads meal-kit panels like Green Chef with units', () => {
  const parsed = parseNutritionLabel(GREEN_CHEF);
  assert.equal(parsed.servingLabel, '1 serving');
  assert.equal(parsed.nutrients.calories, 760);
  assert.equal(parsed.nutrients.fat, 14);
  assert.equal(parsed.nutrients.carbs, 112);
  assert.equal(parsed.nutrients.fiber, 8);
  assert.equal(parsed.nutrients.protein, 43);
  assert.equal(parsed.nutrients.sodium, 2070);
  assert.deepEqual(
    parsed.nutrients.extras.map((extra) => [extra.key, extra.amount]),
    [['saturated_fat', 1.5], ['sugar', 23], ['cholesterol', 200]],
  );
  assert.equal(parsed.looksLikeLabel, true);
});

const PASTA_BOX = `
Nutrition Facts
About 6 servings per container
Serving Size 2 oz (56g) dry
Calories 200
Total Fat 2g 3%
Saturated Fat 0g
Trans Fat 0g
Cholesterol 0mg
Sodium 20mg
Total Carb. 36g 13%
Dietary Fiber 5g
Total Sugars <1g
Protein 12g
`;

test('reads abbreviated FDA labels like pasta boxes', () => {
  const parsed = parseNutritionLabel(PASTA_BOX);
  assert.equal(parsed.servingLabel, '2 oz (56g) dry');
  assert.equal(parsed.nutrients.calories, 200);
  assert.equal(parsed.nutrients.fat, 2);
  assert.equal(parsed.nutrients.carbs, 36);
  assert.equal(parsed.nutrients.fiber, 5);
  assert.equal(parsed.nutrients.protein, 12);
  assert.equal(parsed.nutrients.sodium, 20);
});

const SAUCE_JAR = `
Nutrition Facts
About 6 servings per container
Serving size 1/2 cup (125g)
Calories 120
Total Fat 9g 12%
Saturated Fat 6g 30%
Trans Fat 0g
Cholesterol 0mg
Sodium 400mg 17%
Total Carbohydrate 6g 2%
Dietary Fiber 1g 4%
Total Sugars 5g
Protein 2g
`;

test('reads sauce-style labels with percent daily values', () => {
  const parsed = parseNutritionLabel(SAUCE_JAR);
  assert.equal(parsed.servingLabel, '1/2 cup (125g)');
  assert.equal(parsed.nutrients.calories, 120);
  assert.equal(parsed.nutrients.fat, 9);
  assert.equal(parsed.nutrients.carbs, 6);
  assert.equal(parsed.nutrients.fiber, 1);
  assert.equal(parsed.nutrients.protein, 2);
  assert.equal(parsed.nutrients.sodium, 400);
  assert.equal(parsed.nutrients.extras.find((extra) => extra.key === 'saturated_fat')?.amount, 6);
  assert.equal(parsed.nutrients.extras.find((extra) => extra.key === 'sugar')?.amount, 5);
});

test('treats a restaurant menu as names rather than a label', () => {
  const text = 'Spring Menu\nRoasted chicken\nGarden salad\n';
  const parsed = parseNutritionLabel(text);
  assert.equal(parsed.looksLikeLabel, false);
  assert.deepEqual(menuCandidates(text), ['Spring Menu', 'Roasted chicken', 'Garden salad']);
});
