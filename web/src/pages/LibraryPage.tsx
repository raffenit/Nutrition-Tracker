import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { navigate } from '../nav';
import type { Food } from '../types';

export function LibraryPage() {
  const [foods, setFoods] = useState<Food[]>([]);
  const [query, setQuery] = useState('');
  async function load(next = query): Promise<void> {
    const result = await api<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(next)}`);
    setFoods(result.foods);
  }
  useEffect(() => { void load(''); }, []);
  return (
    <div className="stack">
      <div className="row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the library" />
        <button type="button" onClick={() => void load()}>Search</button>
      </div>
      <div className="row">
        <button className="primary" type="button" onClick={() => navigate('/foods/new')}>New food</button>
        <button type="button" onClick={() => navigate('/foods/custom')}>Custom meal</button>
      </div>
      <ul className="list card">
        {foods.map((food) => (
          <li key={food.id}>
            <span>{food.isFavorite ? '★ ' : ''}{food.name}{food.brand ? ` · ${food.brand}` : ''} · {food.servingLabel}</span>
            <button type="button" onClick={() => void api(`/api/foods/${food.id}`, { method: 'PATCH', body: JSON.stringify({ isFavorite: !food.isFavorite }) }).then(() => load())}>
              {food.isFavorite ? 'Unfavorite' : 'Favorite'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
