import assert from 'node:assert/strict';
import test from 'node:test';
import { reconstructRecipePageLayout, type OcrWordBox } from '../../../domain/recipeCardLayout.js';

/** Words laid out like a meal-kit card front: big title, serving-column table, side list. */
function word(text: string, x0: number, y0: number, x1: number, y1: number): OcrWordBox {
  return { text, bbox: { x0, y0, x1, y1 } };
}

function row(y: number, qty2: string, qty4: string, name: string, side?: string): OcrWordBox[] {
  const words: OcrWordBox[] = [];
  qty2.split(' ').forEach((part, index) => words.push(word(part, 585 + index * 30, y, 610 + index * 30, y + 18)));
  qty4.split(' ').forEach((part, index) => words.push(word(part, 712 + index * 30, y, 737 + index * 30, y + 18)));
  name.split(' ').forEach((part, index) => words.push(word(part, 856 + index * 90, y, 936 + index * 90, y + 18)));
  side?.split(' ').forEach((part, index) => words.push(word(part, 1234 + index * 70, y, 1294 + index * 70, y + 18)));
  return words;
}

const CARD_WORDS: OcrWordBox[] = [
  word('GREEN', 80, 1030, 200, 1050),
  word('MOROCCAN', 403, 1028, 682, 1059),
  word('CHICKEN', 705, 1028, 913, 1059),
  word('&', 935, 1030, 960, 1059),
  word('QUINOA', 986, 1028, 1191, 1059),
  word('This', 94, 1164, 137, 1183),
  word('vibrant', 144, 1164, 223, 1183),
  word('bowl', 231, 1164, 283, 1183),
  word('2', 584, 1181, 593, 1193),
  word('SERVINGS', 601, 1180, 693, 1193),
  word('|', 701, 1178, 703, 1195),
  word('4', 711, 1181, 721, 1193),
  word('SERVINGS', 729, 1180, 821, 1193),
  word('INGREDIENTS', 856, 1177, 1019, 1193),
  word('WHAT', 1232, 1164, 1300, 1180),
  word('NEED', 1406, 1164, 1467, 1180),
  ...row(1216, '¥2 cup', '1cup', 'White quinoa', 'small pot'),
  ...row(1254, '1whole', '2 whole', 'Carrot', 'large pan'),
  ...row(1296, '1% oz', '3% 0z', 'Turmeric-spiced ginger', 'peeler'),
  word('vinaigrette', 854, 1324, 981, 1344),
  word('se', 991, 1328, 1008, 1341),
  ...row(1360, '2 oz', '4 oz', 'Feta cheese m', 'ALLERGENS'),
  // Footer paragraph well below the table must not be read as an ingredient.
  word("We're", 600, 1600, 660, 1618),
  word('committed', 670, 1600, 780, 1618),
  word('providing', 860, 1600, 960, 1618),
];

test('reconstructRecipePageLayout rebuilds ingredient rows from serving columns', () => {
  const layout = reconstructRecipePageLayout(CARD_WORDS);
  assert.ok(layout);
  assert.deepEqual(layout.servings, [2, 4]);
  assert.deepEqual(layout.ingredients.map((entry) => entry.name), [
    'White quinoa',
    'Carrot',
    'Turmeric-spiced ginger vinaigrette',
    'Feta cheese',
  ]);
  assert.deepEqual(layout.ingredients[0]!.quantities, ['¥2 cup', '1cup']);
  assert.deepEqual(layout.ingredients[2]!.quantities, ['1% oz', '3% 0z']);
});

test('reconstructRecipePageLayout picks the large-type title and drops a same-row logo', () => {
  const layout = reconstructRecipePageLayout(CARD_WORDS);
  assert.equal(layout?.title, 'MOROCCAN CHICKEN & QUINOA');
});

test('reconstructRecipePageLayout returns null for pages without words', () => {
  assert.equal(reconstructRecipePageLayout([]), null);
});

test('reconstructRecipePageLayout keeps "&" continuation rows with the previous item', () => {
  const words = [
    word('2', 584, 1181, 593, 1193),
    word('SERVINGS', 601, 1180, 693, 1193),
    word('4', 711, 1181, 721, 1193),
    word('SERVINGS', 729, 1180, 821, 1193),
    word('INGREDIENTS', 856, 1177, 1019, 1193),
    ...row(1216, '12 oz', '24 oz', 'Potatoes'),
    ...row(1256, '2% oz', '5% oz', 'Corn'),
    ...row(1284, '& 2s oz', '& 4% oz', '& roasted red peppers'),
  ];
  const layout = reconstructRecipePageLayout(words);
  assert.deepEqual(layout?.ingredients.map((entry) => entry.name), ['Potatoes', 'Corn & roasted red peppers']);
});
