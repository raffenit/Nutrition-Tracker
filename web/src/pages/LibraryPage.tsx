import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { FavoriteStar } from '../components/FavoriteStar';
import { navigate } from '../nav';
import type { Food } from '../types';

type Shelf = 'foods' | 'recipes';

export function LibraryPage() {
  const [shelf, setShelf] = useState<Shelf>('foods');
  const [foods, setFoods] = useState<Food[]>([]);
  const [query, setQuery] = useState('');
  async function load(next = query, nextShelf = shelf): Promise<void> {
    const result = await api<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(next)}&shelf=${nextShelf}`);
    setFoods(result.foods);
  }
  useEffect(() => { void load('', shelf); }, [shelf]);
  return (
    <div className="page">
      <div className="segmented shelf-tabs">
        <button type="button" className={shelf === 'foods' ? 'active' : ''} onClick={() => setShelf('foods')}>Food library</button>
        <button type="button" className={shelf === 'recipes' ? 'active' : ''} onClick={() => setShelf('recipes')}>Recipes</button>
      </div>
      <div className="row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={shelf === 'foods' ? 'Search foods' : 'Search recipes'} />
        <button type="button" onClick={() => void load()}>Search</button>
      </div>
      <div className="row">
        {shelf === 'foods' ? (
          <button className="primary" type="button" onClick={() => navigate('/foods/new')}>Add food</button>
        ) : (
          <button className="primary" type="button" onClick={() => navigate('/recipes/new')}>New recipe</button>
        )}
      </div>
      <ul className="list card">
        {foods.map((food) => (
          <li key={food.id} className="library-row">
            <button
              type="button"
              className="library-row-main library-row-open"
              onClick={() => navigate(shelf === 'foods' ? `/foods/edit?id=${food.id}` : `/recipes/edit?id=${food.id}`)}
            >
              <span className="library-row-title">{food.name}{food.brand ? ` · ${food.brand}` : ''}</span>
              <span className="library-row-meta">{food.servingLabel} · {Math.round(food.nutrients.calories)} kcal</span>
            </button>
            <FavoriteStar
              active={food.isFavorite}
              onToggle={() => void api(`/api/foods/${food.id}`, { method: 'PATCH', body: JSON.stringify({ isFavorite: !food.isFavorite }) }).then(() => load())}
            />
          </li>
        ))}
        {foods.length === 0 && <li className="library-empty muted">Nothing here yet.</li>}
      </ul>
    </div>
  );
}
