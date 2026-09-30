import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FavoriteStar } from '../components/FavoriteStar';
import { navigate, usePath } from '../nav';
import type { Food } from '../types';

type Shelf = 'foods' | 'recipes';

export function LibraryPage() {
  const href = usePath();
  const [shelf, setShelf] = useState<Shelf>('foods');
  const [foods, setFoods] = useState<Food[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(next = query, nextShelf = shelf): Promise<void> {
    setLoading(true);
    try {
      const result = await api<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(next)}&shelf=${nextShelf}`);
      const sorted = [...result.foods].sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setFoods(sorted);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const param = new URLSearchParams(href.includes('?') ? href.split('?')[1] : '').get('shelf');
    if (param === 'recipes' || param === 'foods') setShelf(param);
  }, [href]);

  useEffect(() => {
    const handle = window.setTimeout(() => void load(query, shelf), query ? 280 : 0);
    return () => window.clearTimeout(handle);
  }, [query, shelf]);

  const addHref = shelf === 'foods' ? '/foods/new' : '/recipes/new';

  return (
    <div className="page library-page">
      <header className="library-toolbar card">
        <div className="library-toolbar-top">
          <div className="segmented compact shelf-tabs" role="tablist" aria-label="Library shelf">
            <button type="button" role="tab" aria-selected={shelf === 'foods'} className={shelf === 'foods' ? 'active' : ''} onClick={() => navigate('/library?shelf=foods')}>Foods</button>
            <button type="button" role="tab" aria-selected={shelf === 'recipes'} className={shelf === 'recipes' ? 'active' : ''} onClick={() => navigate('/library?shelf=recipes')}>Recipes</button>
          </div>
          <button type="button" className="library-add primary" onClick={() => navigate(addHref)} aria-label={shelf === 'foods' ? 'Add food' : 'New recipe'}>
            +
          </button>
        </div>
        <input
          className="library-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={shelf === 'foods' ? 'Search foods…' : 'Search recipes…'}
          aria-label="Search library"
        />
        <p className="library-count muted">{loading ? 'Loading…' : countLabel(foods.length, shelf)}</p>
      </header>

      <ul className="library-list card">
        {foods.map((food) => (
          <li key={food.id}>
            <button
              type="button"
              className="library-item"
              onClick={() => navigate(shelf === 'foods' ? `/foods/edit?id=${food.id}` : `/recipes/edit?id=${food.id}`)}
            >
              <span className="library-item-text">
                <span className="library-item-title">{food.name}</span>
                {(food.brand || food.servingLabel) && (
                  <span className="library-item-meta">
                    {[food.brand, food.servingLabel].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="library-item-end">
                <span className="library-item-kcal">{Math.round(food.nutrients.calories)} kcal</span>
                <FavoriteStar
                  compact
                  active={food.isFavorite}
                  onToggle={() => void api(`/api/foods/${food.id}`, { method: 'PATCH', body: JSON.stringify({ isFavorite: !food.isFavorite }) }).then(() => load())}
                />
              </span>
            </button>
          </li>
        ))}
        {!loading && foods.length === 0 && (
          <li className="library-empty muted">
            {query ? 'No matches.' : shelf === 'foods' ? 'Add a food to get started.' : 'Create a recipe from library foods.'}
          </li>
        )}
      </ul>
    </div>
  );
}

function countLabel(count: number, shelf: Shelf): string {
  const noun = shelf === 'foods' ? 'food' : 'recipe';
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
