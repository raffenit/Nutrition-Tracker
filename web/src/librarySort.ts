import type { Food } from './types';

export type LibrarySort = 'favorites' | 'name-asc' | 'name-desc' | 'calories-desc' | 'calories-asc';

export const LIBRARY_SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'favorites', label: 'Favorites first' },
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'calories-desc', label: 'Calories (high–low)' },
  { value: 'calories-asc', label: 'Calories (low–high)' },
];

export function readLibrarySort(value: string | null): LibrarySort {
  if (value && LIBRARY_SORTS.some((option) => option.value === value)) return value as LibrarySort;
  return 'favorites';
}

export function sortLibraryFoods(foods: Food[], sort: LibrarySort): Food[] {
  const copy = [...foods];
  copy.sort((a, b) => compareFoods(a, b, sort));
  return copy;
}

function compareFoods(a: Food, b: Food, sort: LibrarySort): number {
  if (sort === 'favorites') {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }
  if (sort === 'name-desc') return b.name.localeCompare(a.name, undefined, { sensitivity: 'base' });
  if (sort === 'calories-desc') {
    return b.nutrients.calories - a.nutrients.calories
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }
  if (sort === 'calories-asc') {
    return a.nutrients.calories - b.nutrients.calories
      || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}
