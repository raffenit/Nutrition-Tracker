import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { formatDisplayDate } from '../dateFormat';
import { navigate, nowLocalInput, shiftDate, usePath } from '../nav';
import type { Food } from '../types';
import { weekDays, weekEndSunday, weekStartMonday } from '../weekPlan';

type PlanEntry = {
  id: string;
  localDate: string;
  slot: 'meal' | 'snack' | 'dessert' | 'drink';
  foodId: string;
  foodName: string;
  servings: number;
};

type GroceryLineItem = {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  foodId: string | null;
};

type PlanView = 'week' | 'shop';

export function PlanPage() {
  const href = usePath();
  const weekParam = new URLSearchParams(href.includes('?') ? href.split('?')[1] : '').get('week');
  const [view, setView] = useState<PlanView>('week');
  const [weekStart, setWeekStart] = useState(() => weekStartMonday(weekParam ?? new Date().toISOString().slice(0, 10)));
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [today, setToday] = useState('');
  const [recipes, setRecipes] = useState<Food[]>([]);
  const [grocery, setGrocery] = useState<{ lineItems: GroceryLineItem[]; markdown: string } | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addDay, setAddDay] = useState<string | null>(null);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  async function loadPlan(start = weekStart): Promise<void> {
    const plan = await api<{ weekStart: string; today: string; entries: PlanEntry[] }>(`/api/meal-plan?week=${start}`);
    setWeekStart(plan.weekStart);
    setToday(plan.today);
    setEntries(plan.entries);
  }

  async function loadGrocery(start = weekStart): Promise<void> {
    const result = await api<{ lineItems: GroceryLineItem[]; markdown: string }>(`/api/meal-plan/grocery?week=${start}`);
    setGrocery(result);
    const stored = localStorage.getItem(checkKey(start));
    setChecks(stored ? JSON.parse(stored) as Record<string, boolean> : {});
  }

  useEffect(() => {
    const anchor = weekParam ?? new Date().toISOString().slice(0, 10);
    void loadPlan(weekStartMonday(anchor)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load plan'));
    void api<{ foods: Food[] }>('/api/foods?shelf=recipes').then((result) => setRecipes(result.foods));
  }, [href]);

  useEffect(() => {
    if (view === 'shop') void loadGrocery().catch(() => setError('Could not load grocery list'));
  }, [view, weekStart]);

  function persistChecks(next: Record<string, boolean>): void {
    setChecks(next);
    localStorage.setItem(checkKey(weekStart), JSON.stringify(next));
  }

  async function saveEntries(next: PlanEntry[]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ entries: PlanEntry[] }>('/api/meal-plan', {
        method: 'PUT',
        body: JSON.stringify({
          weekStart,
          entries: next.map(({ localDate, slot, foodId, servings }) => ({ localDate, slot, foodId, servings })),
        }),
      });
      setEntries(result.entries);
      if (view === 'shop') await loadGrocery();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not save plan');
    } finally {
      setBusy(false);
    }
  }

  function shiftWeek(delta: number): void {
    const next = shiftDate(weekStart, delta * 7);
    navigate(`/plan?week=${next}`);
    void loadPlan(next);
  }

  return (
    <div className="page plan-page">
      <header className="plan-head card">
        <div className="plan-head-row">
          <button type="button" className="datebar-arrow" aria-label="Previous week" onClick={() => shiftWeek(-1)}>‹</button>
          <div className="plan-head-title">
            <h1 className="page-title">Meal plan</h1>
            <p className="muted plan-range">{formatDisplayDate(weekStart, 'mdy_long')} – {formatDisplayDate(weekEndSunday(weekStart), 'mdy_long')}</p>
          </div>
          <button type="button" className="datebar-arrow" aria-label="Next week" onClick={() => shiftWeek(1)}>›</button>
        </div>
        <div className="segmented compact" role="tablist" aria-label="Plan views">
          <button type="button" role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>Week</button>
          <button type="button" role="tab" aria-selected={view === 'shop'} className={view === 'shop' ? 'active' : ''} onClick={() => setView('shop')}>Shopping list</button>
        </div>
      </header>

      {error && <p className="notice">{error}</p>}

      {view === 'week' && (
        <div className="plan-days">
          {days.map((day) => (
            <section className="card plan-day" key={day}>
              <header className="plan-day-head">
                <h2>{dayLabel(day, today)}</h2>
                <button type="button" className="linkish" onClick={() => setAddDay(day)}>+ Add</button>
              </header>
              <ul className="plan-meal-list">
                {entries.filter((entry) => entry.localDate === day).map((entry) => (
                  <li className="plan-meal-row" key={entry.id}>
                    <div className="plan-meal-main">
                      <span className="plan-meal-slot">{slotLabel(entry.slot)}</span>
                      <strong>{entry.foodName}</strong>
                      <span className="muted">{entry.servings} serving{entry.servings === 1 ? '' : 's'}</span>
                    </div>
                    <div className="plan-meal-actions">
                      <button
                        type="button"
                        className="library-action"
                        onClick={() => void logFromPlan(entry, setError)}
                      >
                        Log
                      </button>
                      <button
                        type="button"
                        className="library-action danger"
                        disabled={busy}
                        onClick={() => void saveEntries(entries.filter((row) => row.id !== entry.id))}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
                {entries.filter((entry) => entry.localDate === day).length === 0 && (
                  <li className="muted plan-empty">Nothing planned.</li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}

      {view === 'shop' && grocery && (
        <section className="card shop-panel">
          <div className="shop-toolbar row">
            <button
              type="button"
              className="primary"
              onClick={() => void navigator.clipboard.writeText(grocery.markdown)}
            >
              Copy Markdown
            </button>
            <span className="muted">{grocery.lineItems.length} items</span>
          </div>
          <ul className="shop-list">
            {grocery.lineItems.map((item) => (
              <li key={item.key}>
                <label className="shop-item">
                  <input
                    type="checkbox"
                    checked={Boolean(checks[item.key])}
                    onChange={(event) => persistChecks({ ...checks, [item.key]: event.target.checked })}
                  />
                  <span className={checks[item.key] ? 'shop-item-done' : undefined}>
                    <strong>{item.name}</strong>
                    <span className="muted"> · {formatQty(item.quantity)} {item.unit}</span>
                  </span>
                </label>
              </li>
            ))}
            {grocery.lineItems.length === 0 && <li className="muted">Add recipes to the week to build a list.</li>}
          </ul>
          <details className="shop-markdown-preview">
            <summary>Markdown preview</summary>
            <pre className="shop-markdown">{grocery.markdown}</pre>
          </details>
        </section>
      )}

      {addDay && (
        <AddPlanMealDialog
          day={addDay}
          recipes={recipes}
          onClose={() => setAddDay(null)}
          onAdd={(draft) => {
            setAddDay(null);
            void saveEntries([
              ...entries,
              {
                id: `tmp-${Date.now()}`,
                localDate: draft.localDate,
                slot: draft.slot,
                foodId: draft.foodId,
                foodName: draft.foodName,
                servings: draft.servings,
              },
            ]);
          }}
        />
      )}
    </div>
  );
}

function AddPlanMealDialog({
  day,
  recipes,
  onClose,
  onAdd,
}: {
  day: string;
  recipes: Food[];
  onClose: () => void;
  onAdd: (entry: { localDate: string; slot: PlanEntry['slot']; foodId: string; foodName: string; servings: number }) => void;
}) {
  const [foodId, setFoodId] = useState(recipes[0]?.id ?? '');
  const [servings, setServings] = useState('2');
  const [slot, setSlot] = useState<PlanEntry['slot']>('meal');
  const recipe = recipes.find((item) => item.id === foodId);
  return (
    <div className="plan-dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="card plan-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!recipe) return;
          onAdd({ localDate: day, slot, foodId: recipe.id, foodName: recipe.name, servings: Number(servings) });
        }}
      >
        <h2>Add to {day}</h2>
        {recipes.length === 0 ? (
          <p className="muted">Create a recipe in Library first.</p>
        ) : (
          <>
            <label>
              Recipe
              <select value={foodId} onChange={(event) => setFoodId(event.target.value)}>
                {recipes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              Slot
              <select value={slot} onChange={(event) => setSlot(event.target.value as PlanEntry['slot'])}>
                <option value="meal">Meal</option>
                <option value="snack">Snack</option>
                <option value="dessert">Dessert</option>
                <option value="drink">Drink</option>
              </select>
            </label>
            <label>
              Servings
              <input type="number" min={0.25} step={0.25} value={servings} onChange={(event) => setServings(event.target.value)} required />
            </label>
          </>
        )}
        <div className="row">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!recipe}>Add</button>
        </div>
      </form>
    </div>
  );
}

async function logFromPlan(entry: PlanEntry, setError: (value: string | null) => void): Promise<void> {
  try {
    await api(`/api/meal-plan/entries/${entry.id}/log`, {
      method: 'POST',
      body: JSON.stringify({ eatenAt: nowLocalInput() }),
    });
    navigate(`/?date=${entry.localDate}`);
  } catch (caught: unknown) {
    setError(caught instanceof Error ? caught.message : 'Could not log this meal');
  }
}

function checkKey(weekStart: string): string {
  return `nutrition-grocery-checks:${weekStart}`;
}

function dayLabel(day: string, today: string): string {
  if (day === today) return `Today · ${day}`;
  return day;
}

function slotLabel(slot: PlanEntry['slot']): string {
  if (slot === 'meal') return 'Meal';
  if (slot === 'snack') return 'Snack';
  if (slot === 'dessert') return 'Dessert';
  return 'Drink';
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
