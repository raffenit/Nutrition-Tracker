import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { RemoveButton } from '../components/RemoveButton';
import { IconCopy, IconSave } from '../components/NavIcons';
import { formatDisplayDate } from '../dateFormat';
import { navigate, nowLocalInput, shiftDate, usePath } from '../nav';
import type { Food, ProteinTag } from '../types';
import { PROTEIN_TAGS } from '../types';
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
  recipeLineName?: string | null;
};

type PlanView = 'week' | 'shop';

type GeneratedCandidate = {
  foodId: string;
  name: string;
  role: 'main' | 'side';
  proteinTags: string[];
  sourceRecipeId: string | null;
  servings: number;
};

type DraftMeal = {
  localDate: string;
  slot: PlanEntry['slot'];
  main: GeneratedCandidate;
  side: GeneratedCandidate | null;
  include: boolean;
};

export function PlanPage() {
  const href = usePath();
  const weekParam = new URLSearchParams(href.includes('?') ? href.split('?')[1] : '').get('week');
  const [view, setView] = useState<PlanView>('week');
  const [weekStart, setWeekStart] = useState(() => weekStartMonday(weekParam ?? new Date().toISOString().slice(0, 10)));
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [today, setToday] = useState('');
  const [planFoods, setPlanFoods] = useState<Food[]>([]);
  const [cooking, setCooking] = useState<{ title: string; instructions: string } | null>(null);
  const [grocery, setGrocery] = useState<{ weekStart: string; customized: boolean; lineItems: GroceryLineItem[]; markdown: string } | null>(null);
  const [shopItems, setShopItems] = useState<GroceryLineItem[]>([]);
  const [shopDirty, setShopDirty] = useState(false);
  const [shopBusy, setShopBusy] = useState(false);
  const [shopCopied, setShopCopied] = useState(false);
  const [newShopItem, setNewShopItem] = useState({ name: '', quantity: '1', unit: 'unit' });
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addDay, setAddDay] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [dragEntryId, setDragEntryId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [moveEntry, setMoveEntry] = useState<PlanEntry | null>(null);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  async function loadPlan(start = weekStart): Promise<void> {
    const plan = await api<{ weekStart: string; today: string; entries: PlanEntry[] }>(`/api/meal-plan?week=${start}`);
    setWeekStart(plan.weekStart);
    setToday(plan.today);
    setEntries(plan.entries);
  }

  async function loadGrocery(start = weekStart): Promise<void> {
    const result = await api<{ weekStart: string; customized: boolean; lineItems: GroceryLineItem[]; markdown: string }>(`/api/meal-plan/grocery?week=${start}`);
    setGrocery(result);
    setShopItems(result.lineItems);
    setShopDirty(false);
    const stored = localStorage.getItem(checkKey(start));
    setChecks(stored ? JSON.parse(stored) as Record<string, boolean> : {});
  }

  useEffect(() => {
    const anchor = weekParam ?? new Date().toISOString().slice(0, 10);
    void loadPlan(weekStartMonday(anchor)).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load plan'));
    void api<{ foods: Food[] }>('/api/foods?shelf=all').then((result) => {
      setPlanFoods(result.foods.filter((food) => food.kind === 'custom' || food.kind === 'packaged'));
    });
  }, [href]);

  useEffect(() => {
    if (view === 'shop') void loadGrocery().catch(() => setError('Could not load grocery list'));
  }, [view, weekStart]);

  function persistChecks(next: Record<string, boolean>): void {
    setChecks(next);
    localStorage.setItem(checkKey(weekStart), JSON.stringify(next));
  }

  function patchShopItem(key: string, patch: Partial<GroceryLineItem>): void {
    setShopItems((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
    setShopDirty(true);
  }

  function addShopItem(): void {
    const name = newShopItem.name.trim();
    const quantity = Number(newShopItem.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
      setError('New items need a name and a quantity above zero');
      return;
    }
    setShopItems((items) => [
      ...items,
      {
        key: `custom-${crypto.randomUUID()}`,
        name,
        quantity,
        unit: newShopItem.unit.trim() || 'unit',
        foodId: null,
        recipeLineName: null,
      },
    ]);
    setNewShopItem({ name: '', quantity: '1', unit: 'unit' });
    setShopDirty(true);
    setError(null);
  }

  async function saveShopList(items: GroceryLineItem[]): Promise<void> {
    if (items.some((item) => !item.name.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      setError('Every item needs a name and a quantity above zero');
      return;
    }
    setShopBusy(true);
    setError(null);
    try {
      const result = await api<{ weekStart: string; customized: boolean; lineItems: GroceryLineItem[]; markdown: string }>(
        '/api/meal-plan/grocery',
        { method: 'PUT', body: JSON.stringify({ weekStart, items }) },
      );
      setGrocery(result);
      setShopItems(result.lineItems);
      setShopDirty(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not save grocery list');
    } finally {
      setShopBusy(false);
    }
  }

  async function regenerateShopList(): Promise<void> {
    setShopBusy(true);
    setError(null);
    try {
      const result = await api<{ weekStart: string; customized: boolean; lineItems: GroceryLineItem[]; markdown: string }>(
        `/api/meal-plan/grocery?week=${weekStart}`,
        { method: 'DELETE' },
      );
      setGrocery(result);
      setShopItems(result.lineItems);
      setShopDirty(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not regenerate grocery list');
    } finally {
      setShopBusy(false);
    }
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

  function moveEntryToDay(entryId: string, day: string): void {
    const entry = entries.find((row) => row.id === entryId);
    if (!entry || entry.localDate === day || busy) return;
    void saveEntries(entries.map((row) => (row.id === entryId ? { ...row, localDate: day } : row)));
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
        {view === 'week' && (
          <button type="button" className="settings-secondary-btn plan-generate-btn" onClick={() => setGenerateOpen(true)}>
            Generate meals…
          </button>
        )}
      </header>

      {error && <p className="notice">{error}</p>}

      {view === 'week' && (
        <div className="plan-days">
          {days.map((day) => (
            <section
              className={dropDay === day ? 'card plan-day plan-day-drop' : 'card plan-day'}
              key={day}
              onDragOver={(event) => {
                if (!dragEntryId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropDay(day);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDay(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropDay(null);
                if (dragEntryId) moveEntryToDay(dragEntryId, day);
                setDragEntryId(null);
              }}
            >
              <header className="plan-day-head">
                <h2>{dayLabel(day, today)}</h2>
                <button type="button" className="linkish" onClick={() => setAddDay(day)}>+ Add</button>
              </header>
              <ul className="plan-meal-list">
                {entries.filter((entry) => entry.localDate === day).map((entry) => (
                  <li
                    className={dragEntryId === entry.id ? 'plan-meal-row plan-meal-dragging' : 'plan-meal-row'}
                    key={entry.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', entry.id);
                      setDragEntryId(entry.id);
                    }}
                    onDragEnd={() => {
                      setDragEntryId(null);
                      setDropDay(null);
                    }}
                  >
                    <div className="plan-meal-main">
                      <span className="plan-meal-slot">{slotLabel(entry.slot)}</span>
                      <button
                        type="button"
                        className="linkish plan-meal-name"
                        title="Edit recipe"
                        onClick={() => navigate(planEditHref(entry, planFoods, weekStart))}
                      >
                        {entry.foodName}
                      </button>
                      <span className="muted">{entry.servings} serving{entry.servings === 1 ? '' : 's'}</span>
                    </div>
                    <div className="plan-meal-actions">
                      <button
                        type="button"
                        className="library-action plan-move-btn"
                        aria-label={`Move ${entry.foodName} to another day`}
                        onClick={() => setMoveEntry(entry)}
                      >
                        Move
                      </button>
                      <button
                        type="button"
                        className="library-action"
                        onClick={() => void openCooking(entry, setCooking, setError)}
                      >
                        Cook
                      </button>
                      <button
                        type="button"
                        className="library-action"
                        onClick={() => void logFromPlan(entry, setError)}
                      >
                        Log
                      </button>
                      <RemoveButton
                        label={`Remove ${entry.foodName} from plan`}
                        className="remove-icon-btn-danger"
                        disabled={busy}
                        onClick={() => void saveEntries(entries.filter((row) => row.id !== entry.id))}
                      />
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
        <section className="card shop-panel shop-layout">
          <div className="shop-toolbar row shop-layout-span">
            <div className="row shop-actions">
              <button
                type="button"
                className="icon-btn"
                title={shopCopied ? 'Copied!' : 'Copy markdown'}
                aria-label="Copy markdown"
                onClick={() => {
                  void navigator.clipboard.writeText(grocery.markdown).then(() => {
                    setShopCopied(true);
                    window.setTimeout(() => setShopCopied(false), 1500);
                  });
                }}
              >
                <IconCopy className="icon-btn-icon" />
              </button>
              <button
                type="button"
                className="icon-btn"
                title={shopBusy ? 'Saving…' : shopDirty ? 'Save list' : 'List saved'}
                aria-label={shopBusy ? 'Saving list' : 'Save list'}
                disabled={!shopDirty || shopBusy}
                aria-busy={shopBusy}
                onClick={() => void saveShopList(shopItems)}
              >
                <IconSave className="icon-btn-icon" />
              </button>
              {grocery.customized && (
                <button
                  type="button"
                  className="linkish"
                  title="Regenerate from plan"
                  disabled={shopBusy}
                  onClick={() => void regenerateShopList()}
                >
                  Regenerate
                </button>
              )}
            </div>
            <span className="muted shop-count">
              {shopItems.length} items{shopDirty ? ' · unsaved' : ''}
            </span>
          </div>
          <div className="shop-main">
          <ul className="shop-list">
            {shopItems.map((item) => {
              const done = Boolean(checks[item.key]);
              return (
                <li key={item.key} className={done ? 'shop-row shop-row-done' : 'shop-row'}>
                  <input
                    type="checkbox"
                    className="shop-check"
                    checked={done}
                    onChange={(event) => persistChecks({ ...checks, [item.key]: event.target.checked })}
                  />
                  <input
                    className="shop-edit-name"
                    value={item.name}
                    aria-label="Item name"
                    onChange={(event) => patchShopItem(item.key, { name: event.target.value })}
                  />
                  <input
                    className="shop-edit-qty"
                    type="number"
                    min={0}
                    step="any"
                    value={item.quantity}
                    aria-label="Quantity"
                    onChange={(event) => patchShopItem(item.key, { quantity: Number(event.target.value) })}
                  />
                  <input
                    className="shop-edit-unit"
                    value={item.unit}
                    aria-label="Unit"
                    onChange={(event) => patchShopItem(item.key, { unit: event.target.value })}
                  />
                  <RemoveButton
                    label={`Remove ${item.name} from list`}
                    className="remove-icon-btn-danger"
                    disabled={shopBusy}
                    onClick={() => {
                      setShopItems((items) => items.filter((row) => row.key !== item.key));
                      setShopDirty(true);
                    }}
                  />
                  {item.recipeLineName && (
                    <span className="muted shop-kit-line">recipe: {item.recipeLineName}</span>
                  )}
                </li>
              );
            })}
            {shopItems.length === 0 && <li className="muted">List is empty — add items below or regenerate from the plan.</li>}
          </ul>
          <div className="shop-add-row">
            <input
              className="shop-edit-name"
              placeholder="Add an item…"
              value={newShopItem.name}
              onChange={(event) => setNewShopItem({ ...newShopItem, name: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addShopItem(); } }}
            />
            <input
              className="shop-edit-qty"
              type="number"
              min={0}
              step="any"
              value={newShopItem.quantity}
              aria-label="Quantity"
              onChange={(event) => setNewShopItem({ ...newShopItem, quantity: event.target.value })}
            />
            <input
              className="shop-edit-unit"
              value={newShopItem.unit}
              aria-label="Unit"
              onChange={(event) => setNewShopItem({ ...newShopItem, unit: event.target.value })}
            />
            <button type="button" className="settings-secondary-btn" onClick={addShopItem}>Add</button>
          </div>
          </div>
          <details className="shop-markdown-preview">
            <summary>Markdown preview</summary>
            <pre className="shop-markdown">{grocery.markdown}</pre>
          </details>
        </section>
      )}

      {moveEntry && (
        <div className="plan-dialog-backdrop" role="presentation" onClick={() => setMoveEntry(null)}>
          <div className="card plan-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Move {moveEntry.foodName}</h2>
            <div className="plan-move-days">
              {days.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={day === moveEntry.localDate ? 'plan-move-day current' : 'plan-move-day'}
                  disabled={day === moveEntry.localDate || busy}
                  onClick={() => {
                    moveEntryToDay(moveEntry.id, day);
                    setMoveEntry(null);
                  }}
                >
                  {formatDisplayDate(day, 'mdy')}{day === today ? ' · Today' : ''}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setMoveEntry(null)}>Cancel</button>
          </div>
        </div>
      )}

      {cooking && (
        <div className="plan-dialog-backdrop" role="presentation" onClick={() => setCooking(null)}>
          <div className="card plan-dialog cooking-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>{cooking.title}</h2>
            <pre className="cooking-instructions">{cooking.instructions}</pre>
            <button type="button" className="primary" onClick={() => setCooking(null)}>Done</button>
          </div>
        </div>
      )}

      {generateOpen && (
        <GeneratePlanDialog
          weekStart={weekStart}
          saving={busy}
          onClose={() => setGenerateOpen(false)}
          onAdd={(drafts) => {
            setGenerateOpen(false);
            const additions: PlanEntry[] = [];
            for (const draft of drafts) {
              for (const part of [draft.main, draft.side]) {
                if (!part) continue;
                additions.push({
                  id: `tmp-${Date.now()}-${part.foodId}`,
                  localDate: draft.localDate,
                  slot: draft.slot,
                  foodId: part.foodId,
                  foodName: part.name,
                  servings: part.servings,
                });
              }
            }
            void saveEntries([...entries, ...additions]);
          }}
        />
      )}

      {addDay && (
        <AddPlanMealDialog
          day={addDay}
          recipes={planFoods}
          saving={busy}
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
  saving,
  onClose,
  onAdd,
}: {
  day: string;
  recipes: Food[];
  saving: boolean;
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
          <p className="muted">Add a recipe or packaged food in Library first.</p>
        ) : (
          <>
            <label>
              Food or recipe
              <select value={foodId} onChange={(event) => setFoodId(event.target.value)}>
                {recipes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.kind === 'packaged' ? ' (packaged)' : ''}</option>
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
          <button type="submit" className="primary" disabled={!recipe || saving} aria-busy={saving}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}

function GeneratePlanDialog({
  weekStart,
  saving,
  onClose,
  onAdd,
}: {
  weekStart: string;
  saving: boolean;
  onClose: () => void;
  onAdd: (drafts: DraftMeal[]) => void;
}) {
  const [mealCount, setMealCount] = useState('4');
  const [slot, setSlot] = useState<PlanEntry['slot']>('meal');
  const [proteins, setProteins] = useState<Set<ProteinTag>>(new Set());
  const [options, setOptions] = useState<{ proteinTags: ProteinTag[]; candidates: { mains: number; sides: number } } | null>(null);
  const [drafts, setDrafts] = useState<DraftMeal[] | null>(null);
  const [seed, setSeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ proteinTags: ProteinTag[]; candidates: { mains: number; sides: number } }>('/api/meal-plan/generate/options')
      .then(setOptions)
      .catch(() => setError('Could not load generator options'));
  }, []);

  async function generate(count: number, nextSeed: number, dates?: string[], avoid?: string[]): Promise<DraftMeal[]> {
    const result = await api<{ seed: number; meals: Array<{ localDate: string; slot: PlanEntry['slot']; main: GeneratedCandidate; side: GeneratedCandidate | null }> }>(
      '/api/meal-plan/generate',
      {
        method: 'POST',
        body: JSON.stringify({
          mealCount: count,
          proteins: [...proteins],
          slot,
          week: weekStart,
          dates,
          seed: nextSeed,
          avoidFoodIds: avoid ?? [],
        }),
      },
    );
    setSeed(result.seed + 1);
    return result.meals.map((meal) => ({ ...meal, include: true }));
  }

  async function runGenerate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const count = Math.max(1, Math.min(31, Number(mealCount) || 1));
      setDrafts(await generate(count, seed));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function rerollMeal(index: number): Promise<void> {
    if (!drafts) return;
    setBusy(true);
    setError(null);
    try {
      const others = drafts.flatMap((meal, i) => i === index ? [] : [meal.main.foodId, meal.side?.foodId].filter((id): id is string => Boolean(id)));
      const replacement = await generate(1, seed, [drafts[index]!.localDate], [...others, drafts[index]!.main.foodId, drafts[index]!.side?.foodId ?? ''].filter(Boolean));
      const next = [...drafts];
      next[index] = { ...replacement[0]!, include: drafts[index]!.include };
      setDrafts(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Re-roll failed');
    } finally {
      setBusy(false);
    }
  }

  const included = drafts?.filter((meal) => meal.include) ?? [];

  return (
    <div className="plan-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="card plan-dialog generate-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>Generate meals</h2>
        <div className="form-row-2">
          <label>
            Meals
            <input type="number" min={1} max={31} value={mealCount} onChange={(event) => setMealCount(event.target.value)} />
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
        </div>
        <fieldset className="protein-tags-field">
          <legend className="muted">Proteins (any of — none selected = all)</legend>
          <div className="protein-tags-row">
            {PROTEIN_TAGS.map((tag) => (
              <label key={tag} className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={proteins.has(tag)}
                  onChange={(event) => {
                    const next = new Set(proteins);
                    if (event.target.checked) next.add(tag); else next.delete(tag);
                    setProteins(next);
                  }}
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {options && (
          <p className="muted">
            {options.candidates.mains} mains · {options.candidates.sides} sides in the library
          </p>
        )}
        {error && <p className="notice">{error}</p>}
        {drafts && (
          <ul className="generate-drafts">
            {drafts.map((meal, index) => (
              <li key={`${meal.localDate}-${index}`} className="generate-draft">
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={meal.include}
                    onChange={(event) => {
                      const next = [...drafts];
                      next[index] = { ...meal, include: event.target.checked };
                      setDrafts(next);
                    }}
                  />
                </label>
                <div className="generate-draft-body">
                  <strong>{formatDisplayDate(meal.localDate, 'mdy')}</strong>
                  <span className="muted">{meal.main.name}{meal.side ? ` + ${meal.side.name}` : ''}</span>
                  {meal.main.proteinTags.length > 0 && <span className="muted"> · {meal.main.proteinTags.join(', ')}</span>}
                </div>
                <button type="button" className="linkish" disabled={busy} onClick={() => void rerollMeal(index)}>
                  Re-roll
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" onClick={onClose}>Cancel</button>
          {!drafts ? (
            <button type="button" className="primary" disabled={busy || !options} aria-busy={busy} onClick={() => void runGenerate()}>
              {busy ? 'Generating…' : 'Generate'}
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => void runGenerate()}>Re-generate</button>
              <button
                type="button"
                className="primary"
                disabled={busy || saving || included.length === 0}
                aria-busy={saving}
                onClick={() => onAdd(included)}
              >
                {saving ? 'Saving…' : `Add ${included.length} meal${included.length === 1 ? '' : 's'} to plan`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

async function openCooking(
  entry: PlanEntry,
  setCooking: (value: { title: string; instructions: string } | null) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  try {
    const result = await api<{ food: Food }>(`/api/foods/${entry.foodId}`);
    const text = result.food.instructions?.trim();
    if (!text) {
      setError('This item has no cooking instructions. Edit the recipe to add steps from the meal card.');
      return;
    }
    setCooking({ title: entry.foodName, instructions: text });
    setError(null);
  } catch (caught: unknown) {
    setError(caught instanceof Error ? caught.message : 'Could not load instructions');
  }
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

function planEditHref(entry: PlanEntry, foods: Food[], weekStart: string): string {
  const food = foods.find((item) => item.id === entry.foodId);
  const base = food?.kind === 'custom' ? '/recipes/edit' : '/foods/edit';
  return `${base}?id=${entry.foodId}&from=plan&week=${encodeURIComponent(weekStart)}`;
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


