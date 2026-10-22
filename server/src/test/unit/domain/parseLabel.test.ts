import assert from 'node:assert/strict';
import test from 'node:test';
import { menuCandidates, parseNutritionLabel } from '../../../domain/parseLabel.js';

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
  assert.equal(parsed.servingLabel, '1 cup (240 ml)');
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
  assert.equal(parsed.servingLabel, '2 oz (56 g) dry');
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
  assert.equal(parsed.servingLabel, '1/2 cup (125 g)');
  assert.equal(parsed.nutrients.calories, 120);
  assert.equal(parsed.nutrients.fat, 9);
  assert.equal(parsed.nutrients.carbs, 6);
  assert.equal(parsed.nutrients.fiber, 1);
  assert.equal(parsed.nutrients.protein, 2);
  assert.equal(parsed.nutrients.sodium, 400);
  assert.equal(parsed.nutrients.extras.find((extra) => extra.key === 'saturated_fat')?.amount, 6);
  assert.equal(parsed.nutrients.extras.find((extra) => extra.key === 'sugar')?.amount, 5);
});

const COLUMNAR_OCR = `
Nutrition Facts
Serving Size 1 cup (240ml)
Calories
Total Fat
Saturated Fat
Trans Fat
Cholesterol
Sodium
Total Carbohydrate
Dietary Fiber
Total Sugars
Protein
120
5g
1g
0g
0mg
160mg
12g
2g
1g
8g
`;

test('pairs OCR columns when labels and values are in separate blocks', () => {
  const parsed = parseNutritionLabel(COLUMNAR_OCR);
  assert.equal(parsed.nutrients.calories, 120);
  assert.equal(parsed.nutrients.fat, 5);
  assert.equal(parsed.nutrients.sodium, 160);
  assert.equal(parsed.nutrients.carbs, 12);
  assert.equal(parsed.nutrients.fiber, 2);
  assert.equal(parsed.nutrients.protein, 8);
  assert.equal(parsed.nutrients.extras.find((extra) => extra.key === 'sugar')?.amount, 1);
});

/** OCR often emits % Daily Value as bare 1–2 digit lines between macro amounts (any FDA panel). */
const FDA_OCR_PERCENT_NOISE = `
Nutrition Facts
1 serving per container
Serving size 1 bottle (340 mL)
Amount per serving
Calories
Total Fat
Saturated Fat
Trans Fat
Cholesterol
Sodium
Total Carbohydrate
Dietary Fiber
Total Sugars
Protein
150
2.5g
1.5g
0g
25mg
230mg
4g
1g
2g
30g
3
10
1
60
`;

test('skips daily-value percent lines when pairing label columns', () => {
  const parsed = parseNutritionLabel(FDA_OCR_PERCENT_NOISE);
  assert.equal(parsed.nutrients.calories, 150);
  assert.equal(parsed.nutrients.fat, 2.5);
  assert.equal(parsed.nutrients.carbs, 4);
  assert.equal(parsed.nutrients.fiber, 1);
  assert.equal(parsed.nutrients.protein, 30);
  assert.equal(parsed.nutrients.sodium, 230);
});

test('reads servings per container from label headings', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
1 serving per container
Serving size 1 bottle (340 mL)
Calories 150
`);
  assert.equal(parsed.servingsPerContainer, 1);
});

test('infers one serving per container from noisy OCR near calories 150', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
pee] per container —~15
Amount per serving
calories 150
Protein 30g
`);
  assert.equal(parsed.servingsPerContainer, 1);
});

test('reads macros when labels precede amounts with percent noise in between', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
Amount per serving
Calories
Total Fat
Total Carbohydrate
150
2.5g
3
4g
Protein 30g
Sodium 230mg
`);
  assert.equal(parsed.nutrients.calories, 150);
  assert.equal(parsed.nutrients.fat, 2.5);
  assert.equal(parsed.nutrients.carbs, 4);
  assert.equal(parsed.nutrients.protein, 30);
  assert.equal(parsed.nutrients.sodium, 230);
});

test('rewrites gram amounts when OCR merges g as a trailing digit', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
Calories 150
Fat 2.59 8
Protein 30g
`);
  assert.equal(parsed.nutrients.fat, 2.5);
});

test('infers mg and g from fuzzy OCR units when label words are garbled', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
Calories 152
Sedium 230mg_
Fat 2.59 8
Total Carbohydrate 4g
Protein 30g
`);
  assert.equal(parsed.nutrients.sodium, 230);
  assert.equal(parsed.nutrients.fat, 2.5);
  assert.equal(parsed.nutrients.protein, 30);
  assert.equal(parsed.nutrients.carbs, 4);
});

test('reads cholesterol and fiber from embedded label and confusable amount OCR', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
Icholesterol25mng
Dietary Fiber Ig
Protein 30g
`);
  const cholesterol = parsed.nutrients.extras.find((row) => row.key === 'cholesterol');
  assert.equal(cholesterol?.amount, 25);
  assert.equal(parsed.nutrients.fiber, 1);
});

const FAIRLIFE_STYLE_OCR = `
RLiRilrait AleR OPENING Nutrition Facts Tsering per conlaier Bottle  (4omL)] 1 Senvng size rper senving il Anunt calories 152/22 Dal Valuer Fat 2.59 8 (Total[ 39 Salurated [ Fat 4.59 8% U Trans Fat Og Icholesterol25mng 8% 8 L (Sedium 230mg_ 10% 1 [Total Carbohydrate 4g 1% 1 Dietary Fiber Ig 00 2 { 1 Total Sugars 2g 1 Includes Og AddedE Sugars 0% Q 1 Protein 30g 60% 2 6
`;

test('parses fairlife-style one-line OCR for headers and saturated fat from DV', () => {
  const parsed = parseNutritionLabel(FAIRLIFE_STYLE_OCR);
  assert.equal(parsed.servingsPerContainer, 1);
  assert.equal(parsed.servingLabel, '1 bottle (340 ml)');
  assert.equal(parsed.nutrients.calories, 150);
  assert.equal(parsed.nutrients.fat, 2.5);
  assert.equal(parsed.nutrients.extras.find((row) => row.key === 'saturated_fat')?.amount, 1.5);
});

test('reads sodium when OCR uses underscore gap in label word', () => {
  const parsed = parseNutritionLabel(`
Nutrition Facts
Calories 152
S_dium 230mg
Protein 30g
`);
  assert.equal(parsed.nutrients.sodium, 230);
});

/** One-line OCR: misspelled “total”, fat glued to `2.Sg`, fiber `Ig`, cholesterol after trans fat. */
const GLUED_FAT_ONE_LINE_OCR = `
Nutrition Facts Calories 150/12 Tolal Fat2.Sg Saturated Fat LSg Trans Fat Og 25mg_ Total Carbohydrate 4g Dietary Fiber Ig 8 Total Sugars 2g Protein 30g
`;

test('parses glued fat decimal, saturated LSg, fiber Ig, and cholesterol after trans fat on one line', () => {
  const parsed = parseNutritionLabel(GLUED_FAT_ONE_LINE_OCR);
  assert.equal(parsed.nutrients.calories, 150);
  assert.equal(parsed.nutrients.fat, 2.5);
  assert.equal(parsed.nutrients.fiber, 1);
  assert.equal(parsed.nutrients.protein, 30);
  assert.equal(parsed.nutrients.extras.find((row) => row.key === 'saturated_fat')?.amount, 1.5);
  assert.equal(parsed.nutrients.extras.find((row) => row.key === 'cholesterol')?.amount, 25);
});

test('treats a restaurant menu as names rather than a label', () => {
  const text = 'Spring Menu\nRoasted chicken\nGarden salad\n';
  const parsed = parseNutritionLabel(text);
  assert.equal(parsed.looksLikeLabel, false);
  assert.deepEqual(menuCandidates(text), ['Spring Menu', 'Roasted chicken', 'Garden salad']);
});
