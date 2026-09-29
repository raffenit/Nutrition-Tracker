import { finiteNumber, isRecord } from '../domain/guards.js';
import { emptyNutrients } from '../domain/nutrients.js';
import type { Nutrients, SearchHit } from '../types.js';

const USER_AGENT = 'NutritionTracker/0.1 (self-hosted family nutrition app)';

export async function searchOpenFoodFacts(query: string): Promise<SearchHit[]> {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('search_terms', query);
  url.searchParams.set('search_simple', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('json', '1');
  url.searchParams.set('page_size', '6');
  url.searchParams.set('fields', 'code,product_name,brands,serving_size,nutriments');
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Open Food Facts search failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.products)) return [];
  return body.products.flatMap(toHit);
}

function toHit(value: unknown): SearchHit[] {
  if (!isRecord(value) || typeof value.product_name !== 'string' || !value.product_name.trim()) return [];
  if (!isRecord(value.nutriments)) return [];
  const perServing = finiteNumber(value.nutriments['energy-kcal_serving']) !== null;
  const nutrients = nutrientsFrom(value.nutriments, perServing ? '_serving' : '_100g');
  if (nutrients.calories <= 0 && nutrients.protein <= 0 && nutrients.carbs <= 0) return [];
  return [{
    name: value.product_name.trim(),
    brand: typeof value.brands === 'string' ? value.brands : null,
    servingLabel: servingLabel(value, perServing),
    nutrients,
    source: 'openfoodfacts',
    sourceRef: typeof value.code === 'string' ? `off:${value.code}` : null,
    foodId: null,
  }];
}

function nutrientsFrom(source: Record<string, unknown>, suffix: string): Nutrients {
  const nutrients = emptyNutrients();
  nutrients.calories = kcal(source, suffix);
  nutrients.protein = finiteNumber(source[`proteins${suffix}`]) ?? 0;
  nutrients.fat = finiteNumber(source[`fat${suffix}`]) ?? 0;
  nutrients.carbs = finiteNumber(source[`carbohydrates${suffix}`]) ?? 0;
  nutrients.fiber = finiteNumber(source[`fiber${suffix}`]) ?? 0;
  nutrients.sodium = sodiumMg(source, suffix);
  return nutrients;
}

function kcal(source: Record<string, unknown>, suffix: string): number {
  const fromKcal = finiteNumber(source[`energy-kcal${suffix}`]);
  if (fromKcal !== null) return fromKcal;
  const fromKj = finiteNumber(source[`energy${suffix}`]);
  return fromKj === null ? 0 : fromKj / 4.184;
}

function sodiumMg(source: Record<string, unknown>, suffix: string): number {
  const amount = finiteNumber(source[`sodium${suffix}`]) ?? 0;
  return source.sodium_unit === 'mg' ? amount : amount * 1000;
}

function servingLabel(product: Record<string, unknown>, perServing: boolean): string {
  if (perServing && typeof product.serving_size === 'string' && product.serving_size.trim()) return product.serving_size.trim();
  return '100 g';
}
