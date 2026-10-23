import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { mergeFoodsCache } from '../offline/db';
import { FavoriteStar } from '../components/FavoriteStar';
import { RemoveButton } from '../components/RemoveButton';
import { LIBRARY_SORTS, readLibrarySort, sortLibraryFoods, type LibrarySort } from '../librarySort';
import { navigate, usePath } from '../nav';
import type { Food } from '../types';

type Shelf = 'foods' | 'recipes';

export function LibraryPage() {
  const href = usePath();
  const params = new URLSearchParams(href.includes('?') ? href.split('?')[1] : '');
  const [shelf, setShelf] = useState<Shelf>('foods');
  const [sort, setSort] = useState<LibrarySort>('favorites');
  const [foods, setFoods] = useState<Food[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sortedFoods = useMemo(() => sortLibraryFoods(foods, sort), [foods, sort]);

  async function load(next = query, nextShelf = shelf): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(next)}&shelf=${nextShelf}`);
      void mergeFoodsCache(result.foods);
      setFoods(result.foods);
    } catch (caught: unknown) {
      if (!navigator.onLine) {
        const { filterFoodsForShelf } = await import('../offline/libraryCache');
        setFoods(await filterFoodsForShelf(nextShelf, next));
        setError(null);
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not load library');
        setFoods([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const nextShelf = params.get('shelf');
    if (nextShelf === 'recipes' || nextShelf === 'foods') setShelf(nextShelf);
    setSort(readLibrarySort(params.get('sort')));
  }, [href]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(query, shelf), query ? 280 : 0);
    return () => window.clearTimeout(handle);
  }, [query, shelf]);

  function goShelf(nextShelf: Shelf): void {
    navigate(libraryHref(nextShelf, sort));
  }

  function goSort(nextSort: LibrarySort): void {
    setSort(nextSort);
    navigate(libraryHref(shelf, nextSort));
  }

  async function removeFood(food: Food): Promise<void> {
    const noun = shelf === 'foods' ? 'food' : 'recipe';
    if (!window.confirm(`Delete “${food.name}”? Past log entries will keep the name but lose the link to this ${noun}.`)) return;
    setError(null);
    try {
      await api(`/api/foods/${food.id}`, { method: 'DELETE' });
      await load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : `Could not delete this ${noun}`);
    }
  }

  const addHref = shelf === 'foods' ? '/foods/new' : '/recipes/new';

  return (
    <div className="page library-page">
      <div className="library-page-head">
        <div className="library-toolbar-top">
          <div className="segmented compact shelf-tabs" role="tablist" aria-label="Library shelf">
            <button type="button" role="tab" aria-selected={shelf === 'foods'} className={shelf === 'foods' ? 'active' : ''} onClick={() => goShelf('foods')}>Foods</button>
            <button type="button" role="tab" aria-selected={shelf === 'recipes'} className={shelf === 'recipes' ? 'active' : ''} onClick={() => goShelf('recipes')}>Recipes</button>
          </div>
          <button type="button" className="library-add primary" onClick={() => navigate(addHref)} aria-label={shelf === 'foods' ? 'Add food' : 'New recipe'}>
            +
          </button>
        </div>
        <div className="library-filters card">
          <input
            className="library-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={shelf === 'foods' ? 'Search foods…' : 'Search recipes…'}
            aria-label="Search library"
          />
          <label className="library-sort-label">
            Sort
            <select className="library-sort" value={sort} onChange={(event) => goSort(readLibrarySort(event.target.value))}>
              {LIBRARY_SORTS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {error && <p className="notice library-error">{error}</p>}
          <p className="library-count muted">{loading ? 'Loading…' : countLabel(sortedFoods.length, shelf)}</p>
        </div>
      </div>

      <ul className="library-list card">
        {sortedFoods.map((food) => (
          <LibraryRow
            key={food.id}
            food={food}
            shelf={shelf}
            onDelete={() => void removeFood(food)}
            onFavoriteToggle={() => void api(`/api/foods/${food.id}`, { method: 'PATCH', body: JSON.stringify({ isFavorite: !food.isFavorite }) }).then(() => load())}
          />
        ))}
        {!loading && sortedFoods.length === 0 && (
          <li className="library-empty muted">
            {query ? 'No matches.' : shelf === 'foods' ? 'Add a food to get started.' : 'Create a recipe from library foods.'}
          </li>
        )}
      </ul>
    </div>
  );
}

function LibraryRow({
  food,
  shelf,
  onDelete,
  onFavoriteToggle,
}: {
  food: Food;
  shelf: Shelf;
  onDelete: () => void;
  onFavoriteToggle: () => void;
}) {
  const editHref = shelf === 'foods' ? `/foods/edit?id=${food.id}` : `/recipes/edit?id=${food.id}`;

  return (
    <li>
      <div className="library-item">
        <button type="button" className="library-item-main" onClick={() => navigate(editHref)}>
          <span className="library-item-text">
            <span className="library-item-title">{food.name}</span>
            {(food.brand || food.servingLabel) && (
              <span className="library-item-meta">
                {[food.brand, food.servingLabel].filter(Boolean).join(' · ')}
              </span>
            )}
            <span className="library-item-macros">{macroSummary(food, shelf)}</span>
          </span>
          <span className="library-item-kcal">{Math.round(food.nutrients.calories)} kcal</span>
        </button>
        <div className="library-item-actions">
          <button type="button" className="library-action" onClick={() => navigate(editHref)}>Edit</button>
          <RemoveButton label={`Delete ${food.name}`} className="remove-icon-btn-danger" onClick={onDelete} />
          <FavoriteStar compact active={food.isFavorite} onToggle={onFavoriteToggle} />
        </div>
      </div>
    </li>
  );
}

function libraryHref(shelf: Shelf, sort: LibrarySort): string {
  return `/library?shelf=${shelf}&sort=${sort}`;
}

function countLabel(count: number, shelf: Shelf): string {
  const noun = shelf === 'foods' ? 'food' : 'recipe';
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function macroSummary(food: Food, shelf: Shelf): string {
  const { protein, carbs, fat, fiber, sodium } = food.nutrients;
  const macros = `P ${Math.round(protein)}g · C ${Math.round(carbs)}g · F ${Math.round(fat)}g`;
  if (shelf === 'recipes') {
    const count = food.ingredients.length;
    const servings = food.makesServings > 0 ? `${food.makesServings} servings` : null;
    const recipeMeta = [count > 0 ? `${count} ingredients` : null, servings].filter(Boolean).join(' · ');
    return recipeMeta ? `${recipeMeta} · ${macros}` : macros;
  }
  const extras = [
    fiber > 0 ? `Fiber ${Math.round(fiber)}g` : null,
    sodium > 0 ? `Na ${Math.round(sodium)}mg` : null,
    food.isDrink && food.drinkMl ? `${Math.round(food.drinkMl)} ml drink` : null,
  ].filter(Boolean);
  return extras.length > 0 ? `${macros} · ${extras.join(' · ')}` : macros;
}
