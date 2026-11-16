import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRecipeCard } from '../../../domain/parseRecipeCard.js';

const MEAL_KIT_CARD = `
Smoky Paprika Chicken
Green Chef
Serves 2

INGREDIENTS
12 oz boneless chicken breasts
1 tbsp smoky paprika seasoning
8 oz Yukon Gold potatoes
2 oz sour cream

COOKING INSTRUCTIONS
1. Adjust rack to middle position and preheat oven to 425°F.
2. Pat chicken dry; season with salt and pepper.
3. Roast potatoes until tender, 18–20 minutes.
4. Rest chicken 2 minutes before slicing. Serve with sour cream.

Nutrition Values
Calories 760 kcal
Fat 14.00 g
Protein 43.00 g
Sodium 2070.00 mg
`;

test('parseRecipeCard extracts ingredients, instructions, title, and detects meal-kit layout', () => {
  const parsed = parseRecipeCard(MEAL_KIT_CARD);
  assert.equal(parsed.looksLikeRecipeCard, true);
  assert.equal(parsed.title, 'Smoky Paprika Chicken');
  assert.equal(parsed.brand, 'Green Chef');
  assert.equal(parsed.ingredientLines.length, 4);
  assert.match(parsed.ingredientLines[0], /chicken/i);
  assert.match(parsed.instructions, /preheat oven/i);
  assert.match(parsed.instructions, /Rest chicken/i);
});

test('parseRecipeCard ignores sparse OCR without section structure', () => {
  const parsed = parseRecipeCard('random line\nCalories 100');
  assert.equal(parsed.looksLikeRecipeCard, false);
  assert.equal(parsed.ingredientLines.length, 0);
});

// Pattern: grocery/product pages carry "Ingredients" + Nutrition Facts but are
// not recipes — the ingredient declaration is followed by allergen/disclaimer
// prose, and there are no instructions or serves count.
const PRODUCT_PAGE_TEXT = `
Kroger-style Dairy Product
Nutrition Facts
4.0 About Servings Per Container
Serving size 1/2 Cup (113g)
Amount per serving
Calories 110
Total Fat 5g 6%
Protein 13g 25%
Ingredients
Cultured Skim Milk, Cultured Cream, Whey, Salt, Potassium Chloride, Citric Acid, Carrageenan, Guar Gum.
Allergen Info
Contains Milk and its derivates.
Disclaimer
Actual product packaging may contain additional ingredient, nutritional, or proper usage information.
You are responsible for reading labels, warnings, and directions prior to using or consuming a product.
`;

test('parseRecipeCard does not flag product pages with ingredients + nutrition as recipes', () => {
  const parsed = parseRecipeCard(PRODUCT_PAGE_TEXT);
  assert.equal(parsed.looksLikeRecipeCard, false);
});

test('parseRecipeCard still flags ingredient+nutrition cards with quantified recipe lines and no instructions heading', () => {
  const parsed = parseRecipeCard(`
Weeknight Skillet Dinner
Nutrition Facts
Calories 620
Protein 32g
Ingredients
12 oz boneless chicken thighs
1 tbsp smoked paprika
8 oz Yukon Gold potatoes, cubed
2 oz crumbled feta
`);
  assert.equal(parsed.looksLikeRecipeCard, true);
});
