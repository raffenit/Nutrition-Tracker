import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Food } from '../types';

export type LibraryShelf = 'foods' | 'recipes';

type FoodLibraryPickerProps = {
  shelf: LibraryShelf;
  onSelect: (food: Food) => void;
  /** Hide foods already in the list (e.g. recipe ingredients). */
  excludeIds?: ReadonlySet<string>;
  actionLabel?: string;
};

export function FoodLibraryPicker({ shelf, onSelect, excludeIds, actionLabel = '+' }: FoodLibraryPickerProps) {
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<Food[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoading(true);
      void api<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(query.trim())}&shelf=${shelf}`)
        .then((result) => {
          if (cancelled) return;
          const sorted = [...result.foods].sort((a, b) => {
            if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          });
          setFoods(sorted);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, query.trim() ? 280 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, shelf]);

  const visible = excludeIds ? foods.filter((food) => !excludeIds.has(food.id)) : foods;

  return (
    <div className="food-library-picker">
      <input
        className="library-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={shelf === 'foods' ? 'Search or browse foods…' : 'Search or browse recipes…'}
        aria-label={shelf === 'foods' ? 'Search foods' : 'Search recipes'}
      />
      <p className="library-count muted">
        {loading ? 'Loading…' : pickerCount(visible.length, shelf, Boolean(query.trim()))}
      </p>
      <ul className="library-list compact-list picker-scroll">
        {visible.map((food) => (
          <li key={food.id}>
            <button type="button" className="library-item" onClick={() => onSelect(food)}>
              <span className="library-item-text">
                <span className="library-item-title">{food.name}</span>
                <span className="library-item-meta">
                  {[food.brand, food.servingLabel].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="library-item-end">
                <span className="library-item-kcal">{Math.round(food.nutrients.calories)} kcal</span>
                <span className="picker-action" aria-hidden="true">{actionLabel}</span>
              </span>
            </button>
          </li>
        ))}
        {!loading && visible.length === 0 && (
          <li className="library-empty muted">{query.trim() ? 'No matches.' : 'Nothing in the library yet.'}</li>
        )}
      </ul>
    </div>
  );
}

function pickerCount(count: number, shelf: LibraryShelf, filtering: boolean): string {
  const noun = shelf === 'foods' ? 'food' : 'recipe';
  if (count === 0) return filtering ? 'No matches' : `No ${noun}s`;
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
