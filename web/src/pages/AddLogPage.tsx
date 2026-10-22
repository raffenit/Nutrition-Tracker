import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { postMealLog } from '../offline/mutations';
import { mergeFoodsCache, readTargetsCache } from '../offline/db';
import { FoodLibraryPicker, type LibraryShelf } from '../components/FoodLibraryPicker';
import { navigate, nowLocalInput } from '../nav';
import { CORE_NUTRIENT_FIELDS, setCoreNutrient, setExtraAt } from '../nutrientFields';
import { EMPTY_NUTRIENTS, type Food, type MealLog, type Nutrients, type Targets } from '../types';

const SLOTS: MealLog['slot'][] = ['meal', 'snack', 'dessert', 'drink'];
type LogMode = 'library' | 'quick';

export function AddLogPage() {
  const [mode, setMode] = useState<LogMode>('library');
  const [slot, setSlot] = useState<MealLog['slot']>('meal');
  const [shelf, setShelf] = useState<LibraryShelf>('foods');
  const [food, setFood] = useState<Food | null>(null);
  const [servings, setServings] = useState('1');
  const [eatenAt, setEatenAt] = useState(nowLocalInput());
  const [drinkMl, setDrinkMl] = useState('355');
  const [quickName, setQuickName] = useState('');
  const [entryTotals, setEntryTotals] = useState(false);
  const [quickNutrients, setQuickNutrients] = useState<Nutrients>(EMPTY_NUTRIENTS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ targets: Targets }>('/api/targets').then((result) => {
      setQuickNutrients({
        ...EMPTY_NUTRIENTS,
        extras: result.targets.extras.map((extra) => ({ ...extra, amount: 0 })),
      });
    }).catch(async () => {
      const cached = await readTargetsCache();
      if (!cached) return;
      setQuickNutrients({
        ...EMPTY_NUTRIENTS,
        extras: cached.extras.map((extra) => ({ ...extra, amount: 0 })),
      });
    });
  }, []);

  useEffect(() => {
    if (food) void mergeFoodsCache([food]);
  }, [food]);

  const createHref = shelf === 'foods' ? '/foods/new' : '/recipes/new';
  const createLabel = shelf === 'foods' ? 'New food from label' : 'New recipe';

  async function saveLibrary(): Promise<void> {
    if (!food) return;
    await postMealLog({
      foodId: food.id,
      slot,
      servings: Number(servings),
      eatenAt,
      drinkMl: slot === 'drink' || food.isDrink ? Number(drinkMl) : null,
    });
    navigate('/');
  }

  async function saveQuick(): Promise<void> {
    await postMealLog({
      adHoc: true,
      name: quickName.trim(),
      slot,
      servings: Number(servings),
      eatenAt,
      entryTotals,
      nutrients: quickNutrients,
      drinkMl: slot === 'drink' ? Number(drinkMl) : null,
    });
    navigate('/');
  }

  async function save(): Promise<void> {
    setError(null);
    try {
      if (mode === 'quick') await saveQuick();
      else await saveLibrary();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }

  return (
    <div className="page add-log-page">
      <header className="page-layout-span add-log-head">
        <button type="button" className="back-link" onClick={() => navigate('/')}>← Today</button>
        <div className="segmented compact log-mode-tabs" role="group" aria-label="Log type">
        <button type="button" className={mode === 'library' ? 'active' : ''} onClick={() => { setMode('library'); setFood(null); }}>From library</button>
        <button type="button" className={mode === 'quick' ? 'active' : ''} onClick={() => setMode('quick')}>Quick entry</button>
        </div>
        <div className="segmented compact slot-tabs" role="group" aria-label="Meal slot">
        {SLOTS.map((item) => (
          <button type="button" className={item === slot ? 'active' : ''} key={item} onClick={() => setSlot(item)}>
            {item}
          </button>
        ))}
        </div>
      </header>

      {mode === 'library' && !food && (
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

      {mode === 'library' && food && (
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

      {mode === 'quick' && (
        <form className="card form-section add-log-quick-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h1>Quick entry</h1>
          <p className="muted">Log once without saving to your library.</p>
          <label>Name<input value={quickName} onChange={(event) => setQuickName(event.target.value)} required /></label>
          <label>Servings<input value={servings} onChange={(event) => setServings(event.target.value)} inputMode="decimal" required /></label>
          <label className="checkbox-row">
            <input type="checkbox" checked={entryTotals} onChange={(event) => setEntryTotals(event.target.checked)} />
            Numbers below are totals for this log (not per serving)
          </label>
          <fieldset className="nutrient-fields">
            <legend>{entryTotals ? 'Totals for this entry' : 'Per serving'}</legend>
            {CORE_NUTRIENT_FIELDS.map((field) => (
              <label key={field.key} className="nutrient-field">
                <span>{field.label}</span>
                <span className="nutrient-input-wrap">
                  <input
                    type="number"
                    inputMode="decimal"
                    step={field.step}
                    value={quickNutrients[field.key]}
                    onChange={(event) => setQuickNutrients(setCoreNutrient(quickNutrients, field.key, Number(event.target.value)))}
                  />
                  <span className="nutrient-unit">{field.key === 'calories' ? 'kcal' : field.key === 'sodium' ? 'mg' : 'g'}</span>
                </span>
              </label>
            ))}
            {quickNutrients.extras.map((extra, index) => (
              <label key={`${extra.key}-${index}`} className="nutrient-field">
                <span>{extra.label}</span>
                <span className="nutrient-input-wrap">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={extra.amount}
                    onChange={(event) => setQuickNutrients(setExtraAt(quickNutrients, index, Number(event.target.value)))}
                  />
                  <span className="nutrient-unit">{extra.unit}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label>When<input type="datetime-local" value={eatenAt} onChange={(event) => setEatenAt(event.target.value)} required /></label>
          {slot === 'drink' && (
            <label>Volume (ml)<input value={drinkMl} onChange={(event) => setDrinkMl(event.target.value)} /></label>
          )}
          {error && <p className="notice">{error}</p>}
          <button className="primary form-save" type="submit">Add to today</button>
        </form>
      )}
    </div>
  );
}
