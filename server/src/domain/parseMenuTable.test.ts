import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMenuFromSource, parseNutritionixHtml, parsePipeTableText } from './parseMenuTable.js';

const NUTRITIONIX_ROW = `<tr class="odd"><td class="al"><a class="nmItem" title="American Breakfast" href="viewLabel">American Breakfast</a></td><td class="col">650</td><td class="col">43</td><td class="col">20</td><td class="col">0</td><td class="col">490</td><td class="col">1,330</td><td class="col">32</td><td class="col">1</td><td class="col">7</td><td class="col">32</td></tr>`;

test('parses Nutritionix HTML menu rows', () => {
  const items = parseNutritionixHtml(NUTRITIONIX_ROW);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'American Breakfast');
  assert.equal(items[0]?.nutrients.calories, 650);
  assert.equal(items[0]?.nutrients.protein, 32);
  assert.equal(items[0]?.nutrients.sodium, 1330);
});

test('parses pipe table rows like nutrition guides', () => {
  const text = `| Item | Calories | Total Fat (g) | Saturated Fat (g) | Trans Fat (g) | Cholesterol (mg) | Sodium (mg) | Total Carb (g) | Dietary Fiber (g) | Total Sugars (g) | Added Sugars (g) | Protein (g) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ham & Cheese Croissant Stuffer | 1 Croissant | 330 | 17 | 10 | 0 | 60 | 580 | 30 | 2 | 6 | 4 | 14 |`;
  const items = parsePipeTableText(text);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'Ham & Cheese Croissant Stuffer');
  assert.equal(items[0]?.servingLabel, '1 Croissant');
  assert.equal(items[0]?.nutrients.calories, 330);
  assert.equal(items[0]?.nutrients.protein, 14);
});

test('parses a generic HTML nutrition table by column headers', () => {
  const html = `<table>
    <tr><th>Menu Item</th><th>Calories</th><th>Total Fat (g)</th><th>Protein (g)</th><th>Sodium (mg)</th></tr>
    <tr><td>Grilled Chicken Bowl</td><td>520</td><td>18</td><td>42</td><td>890</td></tr>
  </table>`;
  const items = parseMenuFromSource('', html);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.name, 'Grilled Chicken Bowl');
  assert.equal(items[0]?.nutrients.calories, 520);
  assert.equal(items[0]?.nutrients.protein, 42);
  assert.equal(items[0]?.nutrients.sodium, 890);
});
