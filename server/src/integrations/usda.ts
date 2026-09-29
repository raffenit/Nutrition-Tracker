import { finiteNumber, isRecord } from '../domain/guards.js';
import { emptyNutrients } from '../domain/nutrients.js';
import type { Nutrients, SearchHit } from '../types.js';

const NUTRIENT_IDS: Record<number, keyof Omit<Nutrients, 'extras'>> = {
  1008: 'calories',
  208: 'calories',
  1003: 'protein',
  1004: 'fat',
  1005: 'carbs',
  1079: 'fiber',
  1093: 'sodium',
};

export async function searchUsda(query: string, apiKey: string): Promise<SearchHit[]> {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', '6');
  url.searchParams.set('dataType', 'Foundation,SR Legacy');
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`USDA search failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.foods)) return [];
  return body.foods.flatMap(toHit);
}

function toHit(value: unknown): SearchHit[] {
  if (!isRecord(value) || typeof value.description !== 'string') return [];
  const nutrients = emptyNutrients();
  if (Array.isArray(value.foodNutrients)) applyNutrients(nutrients, value.foodNutrients);
  const id = finiteNumber(value.fdcId);
  return [{
    name: value.description,
    brand: null,
    servingLabel: '100 g',
    nutrients,
    source: 'usda',
    sourceRef: id === null ? null : `fdc:${id}`,
    foodId: null,
  }];
}

function applyNutrients(nutrients: Nutrients, entries: unknown[]): void {
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = finiteNumber(entry.nutrientId);
    const key = id === null ? undefined : NUTRIENT_IDS[id];
    const amount = finiteNumber(entry.value);
    if (!key || amount === null) continue;
    nutrients[key] = key === 'sodium' ? sodiumMg(amount, entry.unitName) : amount;
  }
}

function sodiumMg(amount: number, unit: unknown): number {
  const name = typeof unit === 'string' ? unit.toUpperCase() : '';
  if (name === 'G' || name === 'GRAM') return amount * 1000;
  return amount;
}
