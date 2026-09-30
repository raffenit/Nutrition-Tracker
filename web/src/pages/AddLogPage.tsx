import { useState } from 'react';
import { api } from '../api/client';
import { FoodLibraryPicker, type LibraryShelf } from '../components/FoodLibraryPicker';
import { navigate, nowLocalInput } from '../nav';
import type { Food, MealLog } from '../types';

const SLOTS: MealLog['slot'][] = ['meal', 'snack', 'dessert', 'drink'];

export function AddLogPage() {
  const [slot, setSlot] = useState<MealLog['slot']>('meal');
  const [shelf, setShelf] = useState<LibraryShelf>('foods');
  const [food, setFood] = useState<Food | null>(null);
  const [servings, setServings] = useState('1');
  const [eatenAt, setEatenAt] = useState(nowLocalInput());
  const [drinkMl, setDrinkMl] = useState('355');
  const [error, setError] = useState<string | null>(null);

  const createHref = shelf === 'foods' ? '/foods/new' : '/recipes/new';
  const createLabel = shelf === 'foods' ? 'New food from label' : 'New recipe';

  async function save(): Promise<void> {
    if (!food) return;
    try {
      await api('/api/logs', {
        method: 'POST',
        body: JSON.stringify({
          foodId: food.id,
          slot,
          servings: Number(servings),
          eatenAt,
          drinkMl: slot === 'drink' || food.isDrink ? Number(drinkMl) : null,
        }),
      });
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }

  return (
    <div className="page add-log-page">
      <button type="button" className="back-link" onClick={() => navigate('/')}>← Today</button>

      <div className="segmented compact slot-tabs" role="group" aria-label="Meal slot">
        {SLOTS.map((item) => (
          <button type="button" className={item === slot ? 'active' : ''} key={item} onClick={() => setSlot(item)}>
            {item}
          </button>
        ))}
      </div>

      {!food && (
        <section className="card form-section">
          <div className="library-toolbar-top add-log-toolbar">
            <div className="segmented compact shelf-tabs" role="tablist" aria-label="Library type">
              <button type="button" role="tab" aria-selected={shelf === 'foods'} className={shelf === 'foods' ? 'active' : ''} onClick={() => setShelf('foods')}>Foods</button>
              <button type="button" role="tab" aria-selected={shelf === 'recipes'} className={shelf === 'recipes' ? 'active' : ''} onClick={() => setShelf('recipes')}>Recipes</button>
            </div>
            <button type="button" className="linkish" onClick={() => navigate(createHref)}>{createLabel}</button>
          </div>
          <FoodLibraryPicker shelf={shelf} onSelect={setFood} actionLabel="Log" />
        </section>
      )}

      {food && (
        <form className="card form-section" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="form-head">
            <button type="button" className="back-link" onClick={() => setFood(null)}>← Pick another</button>
            <h1>{food.name}</h1>
            <p className="muted">{food.servingLabel} · {Math.round(food.nutrients.calories)} kcal per serving</p>
          </div>
          <label>Servings<input value={servings} onChange={(event) => setServings(event.target.value)} inputMode="decimal" required /></label>
          <label>When<input type="datetime-local" value={eatenAt} onChange={(event) => setEatenAt(event.target.value)} required /></label>
          {(slot === 'drink' || food.isDrink) && (
            <label>Volume (ml)<input value={drinkMl} onChange={(event) => setDrinkMl(event.target.value)} /></label>
          )}
          {error && <p className="notice">{error}</p>}
          <button className="primary form-save" type="submit">Add to today</button>
        </form>
      )}
    </div>
  );
}
