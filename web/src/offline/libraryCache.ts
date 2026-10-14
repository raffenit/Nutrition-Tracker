import type { Food } from '../types';
import { listCachedFoods, readPinnedFoodIds } from './db';

export type LibraryShelf = 'foods' | 'recipes';

function filterFoods(foods: Food[], shelf: LibraryShelf, queryText: string): Food[] {
  const onShelf = foods.filter((food) =>
    shelf === 'recipes' ? food.kind === 'custom' : food.kind !== 'custom',
  );
  if (!queryText.trim()) return onShelf;
  const needle = queryText.trim().toLowerCase();
  return onShelf.filter(
    (food) =>
      food.name.toLowerCase().includes(needle)
      || (food.brand?.toLowerCase().includes(needle) ?? false),
  );
}

export async function filterFoodsForShelf(shelf: LibraryShelf, query: string): Promise<Food[]> {
  const [cached, pinnedIds] = await Promise.all([listCachedFoods(), readPinnedFoodIds()]);
  const pinned = cached.filter((food) => pinnedIds.includes(food.id));
  const merged = [...filterFoods(cached, shelf, query), ...filterFoods(pinned, shelf, query)];
  return [...new Map(merged.map((food) => [food.id, food])).values()];
}
