import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { RemoveButton } from '../components/RemoveButton';
import { IconCopy, IconSave } from '../components/NavIcons';
import { formatDisplayDate } from '../dateFormat';
import { navigate, nowLocalInput, shiftDate, usePath } from '../nav';
import type { Food, ProteinTag } from '../types';
import { PROTEIN_TAGS } from '../types';
import { scaledIngredientDisplay } from '../lib/ingredientLine';
import { convertMeasure, convertibleUnitOptions, formatMeasureQty } from '../lib/measureUnits';
import { weekDays, weekEndSunday, weekStartMonday } from '../weekPlan';

type PlanEntry = {
  id: string;
  localDate: string;
  slot: 'meal' | 'side' | 'snack' | 'dessert' | 'drink';
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
  const [cooking, setCooking] = useState<CookingSession | null>(null);
  const [grocery, setGrocery] = useState<{ weekStart: string; customized: boolean; lineItems: GroceryLineItem[]; markdown: string } | null>(null);
  const [shopItems, setShopItems] = useState<GroceryLineItem[]>([]);
  const [shopMode, setShopMode] = useState<'shop' | 'edit' | 'text' | 'markdown'>('shop');
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
  const [editEntry, setEditEntry] = useState<PlanEntry | null>(null);

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

  /** Shopping mode lets shoppers re-express a line in another unit ("2 cup" → "470 g"). */
  function patchShopUnit(item: GroceryLineItem, unit: string): void {
    const converted = convertMeasure(item.quantity, item.unit, unit);
    patchShopItem(item.key, { unit, quantity: converted ?? item.quantity });
  }

  // Checked-off items sink to the bottom; stable sort keeps list order otherwise.
  const orderedShopItems = useMemo(
    () => [...shopItems].sort((a, b) => Number(Boolean(checks[a.key])) - Number(Boolean(checks[b.key]))),
    [shopItems, checks],
  );
  const shopText = orderedShopItems
    .map((item) => `- [${checks[item.key] ? 'x' : ' '}] ${item.name} — ${formatMeasureQty(item.quantity)} ${item.unit}`)
    .join('\n');

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
                      <span className="plan-meal-slot">
                        {slotLabel(entry.slot)} · {formatServingsText(entry.servings)}
                      </span>
                      <button
                        type="button"
                        className="linkish plan-meal-name"
                        title="Edit recipe"
                        onClick={() => navigate(planEditHref(entry, planFoods, weekStart))}
                      >
                        {entry.foodName}
                      </button>
                    </div>
                    <div className="plan-meal-actions">
                      <button
                        type="button"
                        className="library-action"
                        onClick={() => setEditEntry(entry)}
                      >
                        Edit
                      </button>
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
            <div className="shop-mode-switch" role="group" aria-label="List mode">
              {(['shop', 'edit', 'text', 'markdown'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={shopMode === mode ? 'shop-mode-btn is-active' : 'shop-mode-btn'}
                  aria-pressed={shopMode === mode}
                  onClick={() => setShopMode(mode)}
                >
                  {mode === 'shop' ? 'Shop' : mode === 'edit' ? 'Edit' : mode === 'text' ? 'Text' : 'Markdown'}
                </button>
              ))}
            </div>
            <span className="muted shop-count">
              {shopItems.length} items{shopDirty ? ' · unsaved' : ''}
            </span>
          </div>
          <div className="shop-main">
          {shopMode === 'text' || shopMode === 'markdown' ? (
            <pre className="shop-markdown shop-text">
              {shopMode === 'markdown'
                ? (shopDirty ? `${grocery.markdown}\n\n_(unsaved changes not reflected)_` : grocery.markdown)
                : (shopText || 'List is empty.')}
            </pre>
          ) : (
          <ul className="shop-list">
            {orderedShopItems.map((item) => {
              const done = Boolean(checks[item.key]);
              const checkbox = (
                <input
                  type="checkbox"
                  className="shop-check"
                  checked={done}
                  onChange={(event) => persistChecks({ ...checks, [item.key]: event.target.checked })}
                />
              );
              const kitLine = item.recipeLineName && (
                <span className="muted shop-kit-line">recipe: {item.recipeLineName}</span>
              );
              if (shopMode === 'shop') {
                const unitOptions = convertibleUnitOptions(item.unit);
                return (
                  <li key={item.key} className={done ? 'shop-row shop-row-done' : 'shop-row'}>
                    {checkbox}
                    <span className="shop-item-name">{item.name}</span>
                    <span className="shop-item-qty">{formatMeasureQty(item.quantity)}</span>
                    {unitOptions.length > 1 ? (
                      <select
                        className="shop-edit-unit shop-unit-select"
                        value={item.unit}
                        aria-label={`Unit for ${item.name}`}
                        onChange={(event) => patchShopUnit(item, event.target.value)}
                      >
                        {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    ) : (
                      <input
                        className="shop-edit-unit"
                        value={item.unit}
                        aria-label="Unit"
                        onChange={(event) => patchShopItem(item.key, { unit: event.target.value })}
                      />
                    )}
                    {kitLine}
                  </li>
                );
              }
              return (
                <li key={item.key} className={done ? 'shop-row shop-row-done' : 'shop-row'}>
                  {checkbox}
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
                  {kitLine}
                </li>
              );
            })}
            {orderedShopItems.length === 0 && <li className="muted">List is empty — add items below or regenerate from the plan.</li>}
          </ul>
          )}
          {shopMode === 'edit' && (
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
          )}
          </div>
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

      {editEntry && (
        <EditPlanEntryDialog
          entry={editEntry}
          saving={busy}
          onClose={() => setEditEntry(null)}
          onSave={(slot, servings) => {
            void saveEntries(entries.map((row) => (row.id === editEntry.id ? { ...row, slot, servings } : row)));
            setEditEntry(null);
          }}
        />
      )}

      {cooking && <CookingDialog session={cooking} onClose={() => setCooking(null)} />}

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
  const [query, setQuery] = useState('');
  const recipe = recipes.find((item) => item.id === foodId);
  const filteredRecipes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recipes;
    return recipes.filter((item) => item.name.toLowerCase().includes(needle));
  }, [recipes, query]);
  useEffect(() => {
    if (filteredRecipes.length > 0 && !filteredRecipes.some((item) => item.id === foodId)) {
      setFoodId(filteredRecipes[0]!.id);
    }
  }, [filteredRecipes, foodId]);
  useEffect(() => {
    const food = recipes.find((item) => item.id === foodId);
    if (food) setServings(String(Math.max(1, food.makesServings)));
  }, [foodId, recipes]);
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
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${recipes.length} items…`}
                aria-label="Search foods and recipes"
              />
              <select value={foodId} onChange={(event) => setFoodId(event.target.value)}>
                {filteredRecipes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.kind === 'packaged' ? ' (packaged)' : ''}</option>
                ))}
              </select>
              {query.trim() && filteredRecipes.length === 0 && (
                <span className="muted">No matches for “{query.trim()}”.</span>
              )}
            </label>
            <label>
              Slot
              <select value={slot} onChange={(event) => setSlot(event.target.value as PlanEntry['slot'])}>
                <option value="meal">Meal</option>
                <option value="side">Side</option>
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
              <option value="side">Side</option>
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

type CookingSession = {
  title: string;
  instructions: string;
  ingredients: Food['ingredients'];
  /** plannedServings / food.makesServings — scales ingredient quantities for display. */
  factor: number;
  makesServings: number;
  plannedServings: number;
};

async function openCooking(
  entry: PlanEntry,
  setCooking: (value: CookingSession | null) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  try {
    const result = await api<{ food: Food }>(`/api/foods/${entry.foodId}`);
    const food = result.food;
    const instructions = food.instructions?.trim() ?? '';
    const hasIngredients = food.kind === 'custom' && food.ingredients.length > 0;
    if (!instructions && !hasIngredients) {
      setError('This item has no cooking instructions or ingredients. Edit the recipe to add them.');
      return;
    }
    setCooking({
      title: entry.foodName,
      instructions,
      ingredients: food.ingredients,
      factor: entry.servings / Math.max(food.makesServings, 1),
      makesServings: food.makesServings,
      plannedServings: entry.servings,
    });
    setError(null);
  } catch (caught: unknown) {
    setError(caught instanceof Error ? caught.message : 'Could not load recipe');
  }
}

function CookingDialog({ session, onClose }: { session: CookingSession; onClose: () => void }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const scaled = session.ingredients.map((line) => scaledIngredientDisplay(line, session.factor));
  const scaledNote = session.plannedServings !== session.makesServings
    ? `Amounts shown for ${session.plannedServings} serving${session.plannedServings === 1 ? '' : 's'} (recipe makes ${session.makesServings}).`
    : null;
  return (
    <div className="plan-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="card plan-dialog cooking-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{session.title}</h2>
        <div className="cooking-columns">
        {session.ingredients.length > 0 && (
          <section className="cooking-ingredients">
            <h3 className="form-section-title">Ingredients</h3>
            {scaledNote && <p className="muted cooking-scale-note">{scaledNote}</p>}
            <ul className="cooking-ingredient-list">
              {scaled.map((line, index) => (
                <li key={index} className={checked.has(index) ? 'is-checked' : undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={checked.has(index)}
                      onChange={(event) => {
                        const next = new Set(checked);
                        if (event.target.checked) next.add(index);
                        else next.delete(index);
                        setChecked(next);
                      }}
                    />
                    <span className="cooking-ingredient-text">
                      {line.text}
                      {line.notes && <span className="cooking-ingredient-note"> ({line.notes})</span>}
                      {line.alternates.map((alt) => (
                        <span key={alt} className="cooking-ingredient-alt"> ({alt})</span>
                      ))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        {session.instructions && (
          <section className="cooking-steps">
            <h3 className="form-section-title">Instructions</h3>
            <pre className="cooking-instructions">{session.instructions}</pre>
          </section>
        )}
        </div>
        <button type="button" className="primary" onClick={onClose}>Done</button>
      </div>
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

function formatServingsText(servings: number): string {
  const rounded = Math.round(servings * 100) / 100;
  return `${rounded} serving${rounded === 1 ? '' : 's'}`;
}

function EditPlanEntryDialog({
  entry,
  saving,
  onClose,
  onSave,
}: {
  entry: PlanEntry;
  saving: boolean;
  onClose: () => void;
  onSave: (slot: PlanEntry['slot'], servings: number) => void;
}) {
  const [slot, setSlot] = useState<PlanEntry['slot']>(entry.slot);
  const [servings, setServings] = useState(String(entry.servings));
  const quantity = Number(servings);
  const valid = Number.isFinite(quantity) && quantity > 0;
  return (
    <div className="plan-dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="card plan-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>Edit {entry.foodName}</h2>
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
          <input
            type="number"
            min={0.25}
            step={0.25}
            value={servings}
            onChange={(event) => setServings(event.target.value)}
          />
        </label>
        <div className="row plan-edit-actions">
          <button
            type="button"
            className="primary"
            disabled={!valid || saving}
            onClick={() => onSave(slot, quantity)}
          >
            Save
          </button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function slotLabel(slot: PlanEntry['slot']): string {
  if (slot === 'meal') return 'Meal';
  if (slot === 'side') return 'Side';
  if (slot === 'snack') return 'Snack';
  if (slot === 'dessert') return 'Dessert';
  return 'Drink';
}


