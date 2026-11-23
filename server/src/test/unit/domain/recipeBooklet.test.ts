import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNutritionImportWithPanels } from '../../../domain/nutritionImport.js';
import {
  buildRecipeBookletDraft,
  cleanRecipeStepText,
  groupRecipeBookletCards,
  kitQuantityForFirstColumn,
  normalizeKitQuantity,
} from '../../../domain/recipeBooklet.js';
import type { RecipePageLayout } from '../../../domain/recipeCardLayout.js';

// Trimmed from real PSM.AUTO OCR of a scanned Green Chef card (front + back).
const FRONT = `COOK TIME 25 MIN
| GREEN
CHEF
This vibrant bowl is a delicious
2 SERVINGS | 4 SERVINGS
¥2 cup 1cup
1whole  2whole
CALORIES PER SERVING 740
INGREDIENTS
White quinoa
Carrot
MOROCCAN CHICKEN & SPINACH QUINOA BOWLS
carrof ribbons, dates, feta, schug sauce
WHAT YOU'LL NEED
small pot with lid
GREEN CHEF IS PROUD fo be a USDA Certified Organic`;

const BACK = `1 COOK QUINOA
© Bring 1 cup water @ cups for 4 servings) and ¼ teaspoon salt (V2 teaspoon for 4) to a
boil in a small pot. Once boiling, stir in white quinoa.
O Remove from heat. Let rest, covered, 3 minutes.
If you modified your meal, refer to the cooking instructions on the CUSTOMIZE
card and use them as a guide to modify your recipe as needed.
PREP
O Trim and peel carrot. Shave carrot into ribbons until you get fo the core.
ANY ISSUES WITH =]
! YOURORDER? WE'DBE pr,
PLATE YOUR DISH | SIMMERING LIKE STEW
O Cut chicken cutlets into 5-7 slices each. | OVERTHERETOO. SCAN [=
HERE TO GET HELP. =
O Divide salad between bowls. Enjoy!`;

const LAYOUT: RecipePageLayout = {
  title: 'MOROCCAN CHICKEN & SPINACH QUINOA BOWLS',
  servings: [2, 4],
  ingredients: [
    { quantities: ['¥2 cup', '1cup'], name: 'White quinoa' },
    { quantities: ['1whole', '2whole'], name: 'Carrot' },
    { quantities: ['Ya oz', '1 oz'], name: 'Chicken cutlets*' },
  ],
};

test('cleanRecipeStepText numbers headed steps, joins wrapped bullets, drops print boilerplate', () => {
  const steps = cleanRecipeStepText(BACK);
  assert.equal(steps, [
    '1. Cook Quinoa',
    '- Bring 1 cup water @ cups for 4 servings) and ¼ teaspoon salt (½ teaspoon for 4) to a boil in a small pot. Once boiling, stir in white quinoa.',
    '- Remove from heat. Let rest, covered, 3 minutes.',
    '',
    '2. Prep',
    '- Trim and peel carrot. Shave carrot into ribbons until you get to the core.',
    '',
    '3. Plate Your Dish',
    '- Cut chicken cutlets into 5-7 slices each.',
    '- Divide salad between bowls. Enjoy!',
  ].join('\n'));
});

test('groupRecipeBookletCards pairs each card front with its back and skips a leading cover', () => {
  const pages = ['Welcome to your box!', FRONT, BACK, FRONT, BACK];
  const cards = groupRecipeBookletCards(pages, [null, LAYOUT, null, null, null]);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.pages), [[1, 2], [3, 4]]);
});

test('normalizeKitQuantity fixes common OCR glyph confusions', () => {
  assert.equal(normalizeKitQuantity('¥2 cup'), '½ cup');
  assert.equal(normalizeKitQuantity('5o0z'), '5 oz');
  assert.equal(normalizeKitQuantity('loz'), '1 oz');
  assert.equal(normalizeKitQuantity('Twhole'), '1 whole');
  assert.equal(normalizeKitQuantity('2(60z)'), '2 (6 oz)');
  assert.equal(normalizeKitQuantity('1tbsp'), '1 tbsp');
});

test('kitQuantityForFirstColumn scales a clean column when the first is garbled', () => {
  assert.equal(kitQuantityForFirstColumn(['Ya oz', '1 oz'], [2, 4]), '½ oz');
  assert.equal(kitQuantityForFirstColumn(['3%2 oz', '7 oz'], [2, 4]), '3½ oz');
  // "1½" misread as "12" — whole numbers disagree, keep the raw reading.
  assert.equal(kitQuantityForFirstColumn(['¥% oz', '12 0z'], [2, 4]), '¥% oz');
  assert.equal(kitQuantityForFirstColumn(['12 oz', '24 oz'], [2, 4]), '12 oz');
});

test('buildRecipeBookletDraft uses table geometry for title, servings, and quantities', () => {
  const [card] = groupRecipeBookletCards([FRONT, BACK], [LAYOUT, null]);
  const draft = buildRecipeBookletDraft(card!);
  assert.equal(draft.name, 'Moroccan Chicken & Spinach Quinoa Bowls');
  assert.equal(draft.brand, 'Green Chef');
  assert.equal(draft.makesServings, 2);
  assert.equal(draft.nutrients.calories, 740);
  assert.deepEqual(draft.ingredients.map((line) => line.name), ['½ cup White quinoa', '1 whole Carrot', '½ oz Chicken cutlets']);
  assert.match(draft.instructions, /^1\. Cook Quinoa/);
});

test('buildNutritionImportWithPanels returns one recipe per card for a booklet PDF', () => {
  const pages = [FRONT, BACK, FRONT.replace('MOROCCAN CHICKEN & SPINACH QUINOA BOWLS', 'SOUTHWEST SALMON & BLACK BEAN SUCCOTASH'), BACK];
  const layouts = [LAYOUT, null, { ...LAYOUT, title: 'SOUTHWEST SALMON & BLACK BEAN SUCCOTASH' }, null];
  const built = buildNutritionImportWithPanels(pages.join('\n\n'), 'pdf', null, pages, { recipePageLayouts: layouts });
  assert.equal(built.recipeCards?.length, 2);
  assert.equal(built.recipeCard?.name, 'Moroccan Chicken & Spinach Quinoa Bowls');
  assert.equal(built.recipeCards?.[1]?.name, 'Southwest Salmon & Black Bean Succotash');
  assert.match(built.warning ?? '', /2 recipe cards/);
});

test('buildNutritionImportWithPanels booklet path works from text alone (no geometry)', () => {
  const built = buildNutritionImportWithPanels([FRONT, BACK].join('\n\n'), 'pdf', null, [FRONT, BACK]);
  assert.equal(built.recipeCards?.length ?? 0, 0, 'single text-only card falls back to the legacy recipe parser');
});
