import { useState } from 'react';
import { api } from '../api/client';
import { navigate, nowLocalInput } from '../nav';
import type { Food, MealLog } from '../types';

const SLOTS: MealLog['slot'][] = ['meal', 'snack', 'dessert', 'drink'];

export function AddLogPage() {
  const [slot, setSlot] = useState<MealLog['slot']>('meal');
  const [foods, setFoods] = useState<Food[]>([]);
  const [food, setFood] = useState<Food | null>(null);
  const [query, setQuery] = useState('');
  const [servings, setServings] = useState('1');
  const [eatenAt, setEatenAt] = useState(nowLocalInput());
  const [drinkMl, setDrinkMl] = useState('355');
  const [error, setError] = useState<string | null>(null);

  async function search(): Promise<void> {
    const result = await api<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(query)}`);
    setFoods(result.foods);
  }
  async function save(): Promise<void> {
    if (!food) return;
    try {
      await api('/api/logs', { method: 'POST', body: JSON.stringify({
        foodId: food.id, slot, servings: Number(servings), eatenAt,
        drinkMl: slot === 'drink' || food.isDrink ? Number(drinkMl) : null,
      }) });
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }
  return (
    <div className="stack">
      <button type="button" className="back-link" onClick={() => navigate('/')}>← Today</button>
      <div className="row">{SLOTS.map((item) => <button type="button" className={item === slot ? 'primary' : ''} key={item} onClick={() => setSlot(item)}>{item}</button>)}</div>
      <div className="row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search foods" />
        <button type="button" onClick={() => void search()}>Search</button>
        <button type="button" onClick={() => navigate('/foods/new')}>New from a label</button>
      </div>
      <ul className="list">{foods.map((item) => <li key={item.id}><button type="button" onClick={() => setFood(item)}>{item.name}</button></li>)}</ul>
      {food && (
        <form className="card" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h2>{food.name}</h2>
          <label>Servings<input value={servings} onChange={(event) => setServings(event.target.value)} /></label>
          <label>When did you have this?<input type="datetime-local" value={eatenAt} onChange={(event) => setEatenAt(event.target.value)} required /></label>
          {(slot === 'drink' || food.isDrink) && <label>Volume (ml)<input value={drinkMl} onChange={(event) => setDrinkMl(event.target.value)} /></label>}
          {error && <p className="notice">{error}</p>}
          <button className="primary" type="submit">Add to today</button>
        </form>
      )}
    </div>
  );
}
