import assert from 'node:assert/strict';
import test from 'node:test';
import { pageTitleFromHtml, recipeCardFromJsonLd } from '../../../integrations/recipeJsonLd.js';

const RECIPE_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Weeknight Tomato Pasta",
  "recipeYield": "4 servings",
  "recipeIngredient": [
    "12 oz spaghetti",
    "2 cups cherry tomatoes",
    "3 cloves garlic, minced",
    { "@type": "HowToSupply", "name": "1/4 cup olive oil" },
    "Salt and pepper to taste"
  ],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "Bring a large pot of salted water to a boil." },
    { "@type": "HowToStep", "text": "Cook pasta until al dente, about 9 minutes." },
    { "@type": "HowToStep", "text": "Meanwhile, warm olive oil and garlic in a large skillet." }
  ],
  "nutrition": {
    "@type": "NutritionInformation",
    "calories": "520 calories",
    "proteinContent": "18 g",
    "fatContent": "14 g",
    "carbohydrateContent": "82 g",
    "fiberContent": "5 g",
    "sodiumContent": "640 mg"
  }
}
</script>
</head><body><h1>Weeknight Tomato Pasta</h1></body></html>`;

test('recipeCardFromJsonLd extracts name, yield, ingredients, steps, and nutrition', () => {
  const draft = recipeCardFromJsonLd(RECIPE_HTML);
  assert.ok(draft);
  assert.equal(draft.name, 'Weeknight Tomato Pasta');
  assert.equal(draft.makesServings, 4);
  assert.equal(draft.ingredients.length, 5);
  assert.match(draft.ingredients[0]!.name, /spaghetti/i);
  assert.match(draft.instructions, / salted water to a boil/i);
  assert.match(draft.instructions, /warm olive oil/i);
  assert.equal(draft.nutrients.calories, 520);
  assert.equal(draft.nutrients.protein, 18);
  assert.equal(draft.nutrients.sodium, 640);
});

test('recipeCardFromJsonLd handles @graph wrapping and string instructions', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', name: 'Ignore me' },
      {
        '@type': 'Recipe',
        name: 'Simple Soup',
        recipeYield: 6,
        recipeIngredient: ['4 cups broth', '1 onion diced', '2 carrots sliced'],
        recipeInstructions: 'Simmer everything for 30 minutes.',
      },
    ],
  })}</script>`;
  const draft = recipeCardFromJsonLd(html);
  assert.ok(draft);
  assert.equal(draft.name, 'Simple Soup');
  assert.equal(draft.makesServings, 6);
  assert.equal(draft.ingredients.length, 3);
  assert.match(draft.instructions, /Simmer/);
});

test('recipeCardFromJsonLd finds recipes inside array-valued @type', () => {
  const html = `<script type="application/ld+json">${JSON.stringify([
    { '@type': ['Recipe', 'CreativeWork'], name: 'Array Typed Dish', recipeIngredient: ['1 cup rice', '2 cups water', '1 tsp salt'] },
  ])}</script>`;
  const draft = recipeCardFromJsonLd(html);
  assert.ok(draft);
  assert.equal(draft.name, 'Array Typed Dish');
});

test('recipeCardFromJsonLd returns null for non-recipe pages', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Cereal', nutrition: { calories: 120 } })}</script>`;
  assert.equal(recipeCardFromJsonLd(html), null);
  assert.equal(recipeCardFromJsonLd('<html><body>no json-ld</body></html>'), null);
  assert.equal(recipeCardFromJsonLd(null), null);
});

test('pageTitleFromHtml prefers og:title, then h1, then title tag', () => {
  assert.equal(
    pageTitleFromHtml('<meta property="og:title" content="My Recipe &amp; More"><h1>Other</h1>'),
    'My Recipe & More',
  );
  assert.equal(pageTitleFromHtml('<h1>Heading <em>Recipe</em></h1>'), 'Heading Recipe');
  assert.equal(pageTitleFromHtml('<title>Site | Dish Name</title>'), 'Site | Dish Name');
  assert.equal(pageTitleFromHtml('<html></html>'), null);
});
