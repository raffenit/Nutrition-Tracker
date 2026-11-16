import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMenuFromSource } from '../../../domain/parseMenuTable.js';
import { parseMenuTextSections } from '../../../domain/parseMenuTextSections.js';

const HEADER_STACKED = [
  'Total calories (cal)',
  ' ',
  'Calories from fat (fat cal)',
  'Total fat (g)',
  'Sodium (mg)',
  'Total carbohydrate (g)',
  'Protein (g)',
];

test('stacked header with per-nutrient size codes expands each item per size (values one per line)', () => {
  const codes = Array.from({ length: 6 }, () => ['W \n8F \n16F']).join('\n');
  const values = ['200', '500', '1000', '80', '90', '180', '9', '10', '20', '700', '1400', '2800', '5', '60', '120', '20', '30', '60'];
  const text = [
    ...HEADER_STACKED,
    codes,
    'CLUB 1',
    ...values.flatMap((v) => [v, ' ']),
    'W = LETTUCE WRAP | 8F = 8" ROLL | 16F = 16" ROLL',
  ].join('\n');
  const items = parseMenuTextSections(text);
  assert.deepEqual(items.map((i) => i.name), ['CLUB 1, LETTUCE WRAP', 'CLUB 1, 8" ROLL', 'CLUB 1, 16" ROLL']);
  assert.deepEqual(items.map((i) => i.nutrients.calories), [200, 500, 1000]);
  assert.deepEqual(items.map((i) => i.nutrients.fat), [9, 10, 20]);
  assert.deepEqual(items.map((i) => i.nutrients.sodium), [700, 1400, 2800]);
  assert.deepEqual(items.map((i) => i.nutrients.protein), [20, 30, 60]);
});

test('portion rows (EZ / REG / XTRA) take the item name above them and a size per variant column', () => {
  const text = [
    'INGREDIENT \tCalories \tCalories from Fat \tTotal Fat \tSodium (mg) \tCarbohydrates (g) \tProtein (g)',
    'AVAILABLE ONLY ON THE\t',
    'HOUSE SANDWICH',
    'GARLIC',
    'SAUCE',
    'PORTION \t8" \t16" \t8" \t16" \t8" \t16" \t8" \t16" \t8" \t16" \t8" \t16"',
    'EZ \t50 \t100 \t40 \t80 \t4.5 \t9 \t125 \t250 \t2 \t4 \t0 \t0',
    'REG \t100 \t190 \t80 \t160 \t9 \t18 \t250 \t490 \t4 \t7 \t< 1 \t1',
    'XTRA \t190 \t390 \t160 \t320 \t18 \t35 \t490 \t990 \t7 \t14 \t1 \t2',
  ].join('\n');
  const items = parseMenuTextSections(text);
  assert.equal(items.length, 6);
  assert.equal(items[0]?.name, 'GARLIC SAUCE (EZ), 8"');
  assert.equal(items[3]?.name, 'GARLIC SAUCE (REG), 16"');
  assert.equal(items[3]?.nutrients.calories, 190);
  assert.equal(items[2]?.nutrients.protein, 1);
  assert.equal(items[5]?.nutrients.sodium, 990);
});

test('slash values split into sizes named by a "30/32 OUNCES" sub-heading', () => {
  const text = [
    'Total calories (cal) \tTotal fat (g) \tSodium (mg) \tTotal carbohydrate (g) \tProtein (g)',
    '30/32 OUNCES',
    'LEMONADE 370/400 0/0 \t250/260 94/100 \t0/0',
    'ICED TEA (UNSWEETENED) \t0/0 \t0/0 \t20/20 \t0/0 \t0/0',
  ].join('\n');
  const items = parseMenuTextSections(text);
  assert.deepEqual(items.map((i) => i.name), ['LEMONADE, 30 ounces', 'LEMONADE, 32 ounces', 'ICED TEA (UNSWEETENED), 30 ounces', 'ICED TEA (UNSWEETENED), 32 ounces']);
  assert.deepEqual(items.map((i) => i.nutrients.calories), [370, 400, 0, 0]);
  assert.equal(items[1]?.nutrients.carbs, 100);
});

test('a number that ends the item name is not read as a value, and single-size rows still parse', () => {
  const text = [
    'Total calories (cal) \tCalories from fat (fat cal) \tTotal fat (g) \tSodium (mg) \tTotal carbohydrate (g) \tProtein (g)',
    'KIDS 1 300 140 15',
    '770 25',
    '15',
    'SIDE PICKLE \t20 \t0 \t0 \t1710 \t3 \t1',
  ].join('\n');
  const items = parseMenuTextSections(text);
  assert.deepEqual(items.map((i) => [i.name, i.nutrients.calories, i.nutrients.sodium, i.nutrients.protein]), [
    ['KIDS 1', 300, 770, 15],
    ['SIDE PICKLE', 20, 1710, 1],
  ]);
});

test('parseMenuFromSource prefers sectioned parsing when it finds more items', () => {
  const text = [
    'Total calories (cal) \tTotal fat (g) \tSodium (mg) \tTotal carbohydrate (g) \tProtein (g)',
    '30/32 OUNCES',
    'LEMONADE 370/400 0/0 \t250/260 94/100 \t0/0',
  ].join('\n');
  assert.deepEqual(parseMenuFromSource(text, null).map((i) => i.name), ['LEMONADE, 30 ounces', 'LEMONADE, 32 ounces']);
});

test('a bare "Carbs" header keeps every column aligned', () => {
  const text = ['Item  Calories  Fat  Sodium  Carbs  Fiber  Protein', 'Grain Bowl \t520 \t18 \t890 \t60 \t9 \t42'].join('\n');
  const [bowl] = parseMenuTextSections(text);
  assert.equal(bowl?.name, 'Grain Bowl');
  assert.equal(bowl?.nutrients.calories, 520);
  assert.equal(bowl?.nutrients.carbs, 60);
  assert.equal(bowl?.nutrients.protein, 42);
});

test('short one-word item names are kept when no row names a parent item', () => {
  const text = ['Total calories (cal) \tTotal fat (g) \tSodium (mg) \tTotal carbohydrate (g) \tProtein (g)', 'TEA \t0 \t0 \t10 \t0 \t0', 'COLA \t240 \t0 \t45 \t65 \t0'].join('\n');
  assert.deepEqual(parseMenuTextSections(text).map((i) => [i.name, i.nutrients.calories]), [['TEA', 0], ['COLA', 240]]);
});
