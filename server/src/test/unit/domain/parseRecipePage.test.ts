import assert from 'node:assert/strict';
import test from 'node:test';
import { recipeCardFromPageText } from '../../../domain/parseRecipePage.js';

const RECIPE_PAGE_TEXT = `
Tomato Basil Soup
4.8 stars · 1,204 reviews
Jump to Recipe
Print
Save
Prep Time 10 mins
Cook Time 30 mins
Total Time 40 mins
Serves 4

Ingredients
2 tbsp olive oil
1 large onion, diced
3 cloves garlic, minced
2 (28 oz) cans crushed tomatoes
1 cup vegetable broth
1/2 cup fresh basil, chopped
Salt and pepper to taste

Instructions
1. Heat olive oil in a large pot over medium heat.
2. Cook onion until softened, about 5 minutes.
3. Add garlic and cook 1 minute until fragrant.
4. Stir in tomatoes and broth; simmer 20 minutes.
5. Blend until smooth, then stir in basil and season.

Nutrition Facts
Serving size 1 bowl (approx. 350g)
Calories 180
Protein 6g
`;

test('recipeCardFromPageText extracts ingredients, numbered steps, and servings', () => {
  const draft = recipeCardFromPageText(RECIPE_PAGE_TEXT, 'Tomato Basil Soup');
  assert.ok(draft);
  assert.equal(draft.name, 'Tomato Basil Soup');
  assert.equal(draft.makesServings, 4);
  assert.equal(draft.ingredients.length, 7);
  assert.match(draft.ingredients[0]!.name, /olive oil/i);
  assert.match(draft.instructions, /simmer 20 minutes/i);
  assert.ok(draft.nutrients.calories > 0);
});

test('recipeCardFromPageText falls back to a guessed title when no page title is given', () => {
  const draft = recipeCardFromPageText(RECIPE_PAGE_TEXT);
  assert.ok(draft);
  assert.equal(draft.name, 'Tomato Basil Soup');
});

test('recipeCardFromPageText rejects product pages with directions-for-use prose', () => {
  const productText = `
Daily Moisturizer
Ingredients
Aqua, Glycerin, Niacinamide, Panthenol, Allantoin, Tocopheryl Acetate, Carbomer, Phenoxyethanol, Ethylhexylglycerin
Directions
Apply a small amount to clean skin morning and night. For external use only. Avoid contact with eyes.
`;
  assert.equal(recipeCardFromPageText(productText, 'Daily Moisturizer'), null);
});

test('recipeCardFromPageText requires both ingredient and instruction sections', () => {
  const ingredientsOnly = `
Great Cookies
Ingredients
1 cup flour
1/2 cup sugar
1/2 cup butter
1 tsp baking soda
`;
  assert.equal(recipeCardFromPageText(ingredientsOnly, 'Great Cookies'), null);
});
