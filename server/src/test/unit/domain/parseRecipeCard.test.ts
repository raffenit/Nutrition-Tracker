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
