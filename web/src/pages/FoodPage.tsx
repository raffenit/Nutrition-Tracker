import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { navigate } from '../nav';
import { CORE_NUTRIENT_FIELDS, removeExtraAt, setCoreNutrient, setExtraAt } from '../nutrientFields';
import { FoodLibraryPicker } from '../components/FoodLibraryPicker';
import { EMPTY_NUTRIENTS, type Food, type Nutrients } from '../types';

type FoodPageProps = { custom?: boolean; editId?: string | null };

export function FoodPage({ custom = false, editId = null }: FoodPageProps) {
  return custom ? <RecipeEditor editId={editId} /> : <FoodEditor editId={editId} />;
}

function FoodEditor({ editId }: { editId: string | null }) {
  const [nutrients, setNutrients] = useState<Nutrients>(EMPTY_NUTRIENTS);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serving, setServing] = useState('1 serving');
  const [isDrink, setIsDrink] = useState(false);
  const [drinkMl, setDrinkMl] = useState('355');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [menuItems, setMenuItems] = useState<Array<{ name: string; servingLabel: string; nutrients: Nutrients }>>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(editId));

  useEffect(() => {
    if (!editId) return;
    void api<{ food: Food }>(`/api/foods/${editId}`).then((result) => {
      const food = result.food;
      setName(food.name);
      setBrand(food.brand ?? '');
      setServing(food.servingLabel);
      setNutrients(food.nutrients);
      setIsDrink(food.isDrink);
      setDrinkMl(food.drinkMl ? String(food.drinkMl) : '355');
      setLoading(false);
    }).catch(() => setError('Could not load this food'));
  }, [editId]);

  function applyImport(result: {
    uploadId: string | null;
    draft: { nutrients: Nutrients; servingLabel: string };
    candidates: string[];
    menuItems?: Array<{ name: string; servingLabel: string; nutrients: Nutrients }>;
    warning: string | null;
  }): void {
    setUploadId(result.uploadId);
    setCandidates(result.candidates);
    setMenuItems(result.menuItems ?? []);
    setError(result.warning);
    if ((result.menuItems?.length ?? 0) > 0) {
      setName('');
      setNutrients(EMPTY_NUTRIENTS);
      setServing('1 serving');
      return;
    }
    setNutrients(result.draft.nutrients);
    setServing(result.draft.servingLabel);
    if (!result.warning && result.draft.nutrients.calories === 0 && result.draft.nutrients.protein === 0) {
      setError('No nutrition values were detected. Edit the fields below or try a photo/PDF.');
    }
  }

  function pickMenuItem(item: { name: string; servingLabel: string; nutrients: Nutrients }): void {
    setName(item.name);
    setServing(item.servingLabel);
    setNutrients(item.nutrients);
  }

  async function importLink(): Promise<void> {
    if (!importUrl.trim()) return;
    try {
      const result = await api<{ uploadId: string | null; draft: { nutrients: Nutrients; servingLabel: string }; candidates: string[]; warning: string | null }>(
        '/api/import-url',
        { method: 'POST', body: JSON.stringify({ url: importUrl.trim() }) },
      );
      applyImport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not import URL');
    }
  }

  async function upload(file: File): Promise<void> {
    const body = new FormData();
    body.set('file', file);
    const result = await api<{ uploadId: string | null; draft: { nutrients: Nutrients; servingLabel: string }; candidates: string[]; warning: string | null }>('/api/uploads', { method: 'POST', body });
    applyImport(result);
  }

  async function save(event: { preventDefault: () => void }): Promise<void> {
    event.preventDefault();
    const payload = {
      name, brand: brand || null, kind: 'packaged' as const, servingLabel: serving, nutrients, isDrink,
      drinkMl: isDrink ? Number(drinkMl) : null, isFavorite: false, source: uploadId ? 'image' as const : 'manual' as const, uploadId: uploadId ?? undefined,
    };
    try {
      if (editId) {
        await api(`/api/foods/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/api/foods', { method: 'POST', body: JSON.stringify(payload) });
      }
      navigate('/library?shelf=foods');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }

  if (loading) return <p className="page">Loading…</p>;

  return (
    <form className="page food-form" onSubmit={(event) => { void save(event); }}>
      <header className="form-head">
        <button type="button" className="back-link" onClick={() => navigate('/library?shelf=foods')}>← Foods</button>
        <h1>{editId ? 'Edit food' : 'Add food'}</h1>
      </header>

      <section className="card form-section">
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus={!editId} /></label>
        <div className="form-row-2">
          <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder="Optional" /></label>
          <label>Serving<input value={serving} onChange={(event) => setServing(event.target.value)} required /></label>
        </div>
        <label className="checkbox-inline">
          <input type="checkbox" checked={isDrink} onChange={(event) => setIsDrink(event.target.checked)} />
          <span>Counts as a drink (hydration)</span>
        </label>
        {isDrink && <label>Volume (ml)<input value={drinkMl} onChange={(event) => setDrinkMl(event.target.value)} /></label>}
      </section>

      <details className="card form-section import-panel">
        <summary>Import from photo, PDF, or link</summary>
        <label className="import-file">Choose file<input type="file" accept="image/*,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
        <div className="import-url-row">
          <input value={importUrl} onChange={(event) => setImportUrl(event.target.value)} placeholder="PDF or nutrition page URL" />
          <button type="button" onClick={() => void importLink()}>Import</button>
        </div>
        <p className="muted import-hint">Direct PDF/HTML links work best; in-app-only menus may not load.</p>
        {menuItems.length > 0 && (
          <ul className="library-list compact-list menu-pick-list">
            {menuItems.map((item) => (
              <li key={item.name}>
                <button type="button" className="library-item" onClick={() => pickMenuItem(item)}>
                  <span className="library-item-text">
                    <span className="library-item-title">{item.name}</span>
                    <span className="library-item-meta">{item.servingLabel} · {Math.round(item.nutrients.protein)} g protein</span>
                  </span>
                  <span className="library-item-kcal">{Math.round(item.nutrients.calories)} kcal</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {menuItems.length === 0 && candidates.length > 0 && (
          <div className="chip-row">{candidates.map((item) => <button type="button" className="chip" key={item} onClick={() => setName(item)}>{item}</button>)}</div>
        )}
      </details>

      <section className="card form-section">
        <NutrientFields nutrients={nutrients} onChange={setNutrients} />
      </section>

      {error && <p className="notice">{error}</p>}
      <button className="primary form-save" type="submit">Save food</button>
    </form>
  );
}

function RecipeEditor({ editId }: { editId: string | null }) {
  const [name, setName] = useState('');
  const [makesServings, setMakesServings] = useState('1');
  const [lines, setLines] = useState<Array<{ foodId: string | null; name: string; servings: number; servingLabel: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(editId));

  useEffect(() => {
    if (!editId) return;
    void api<{ food: Food }>(`/api/foods/${editId}`).then(async (result) => {
      const food = result.food;
      setName(food.name);
      setMakesServings(String(food.makesServings));
      const nextLines = await Promise.all(food.ingredients.map(async (line) => {
        if (line.childFoodId) {
          const hit = await api<{ food: Food }>(`/api/foods/${line.childFoodId}`);
          return { foodId: line.childFoodId, name: hit.food.name, servings: line.servings, servingLabel: hit.food.servingLabel };
        }
        return { foodId: null, name: line.name, servings: line.servings, servingLabel: '1 serving' };
      }));
      setLines(nextLines);
      setLoading(false);
    }).catch(() => setError('Could not load this recipe'));
  }, [editId]);

  const excludeIds = editId ? new Set([editId]) : undefined;

  function addLibraryIngredient(food: Food): void {
    setLines((prev) => {
      const index = prev.findIndex((line) => line.foodId === food.id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], servings: next[index].servings + 1 };
        return next;
      }
      return [...prev, { foodId: food.id, name: food.name, servings: 1, servingLabel: food.servingLabel }];
    });
  }

  async function save(): Promise<void> {
    const payload = {
      name,
      kind: 'custom' as const,
      makesServings: Number(makesServings),
      servingLabel: '1 serving',
      nutrients: EMPTY_NUTRIENTS,
      isFavorite: false,
      isDrink: false,
      drinkMl: null,
      source: 'composed' as const,
      ingredients: lines.map((line) => ({
        name: line.name,
        servings: line.servings,
        foodId: line.foodId,
      })),
    };
    try {
      if (editId) {
        await api(`/api/foods/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/api/foods/compose', { method: 'POST', body: JSON.stringify(payload) });
      }
      navigate('/library?shelf=recipes');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }

  if (loading) return <p className="page">Loading…</p>;

  return (
    <div className="page food-form">
      <header className="form-head">
        <button type="button" className="back-link" onClick={() => navigate('/library?shelf=recipes')}>← Recipes</button>
        <h1>{editId ? 'Edit recipe' : 'New recipe'}</h1>
      </header>

      <section className="card form-section">
        <div className="form-row-2">
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus={!editId} /></label>
          <label>Makes (servings)<input type="number" min="1" step="1" value={makesServings} onChange={(event) => setMakesServings(event.target.value)} required /></label>
        </div>
      </section>

      <section className="card form-section">
        <h2 className="form-section-title">Add from food library</h2>
        <p className="muted">Tap a food to add it as an ingredient. Search or scroll the list.</p>
        <FoodLibraryPicker shelf="foods" onSelect={addLibraryIngredient} excludeIds={excludeIds} />
        <button type="button" className="linkish" onClick={() => navigate('/foods/new')}>New food from label</button>
      </section>

      <section className="card form-section">
        <h2 className="form-section-title">Ingredients {lines.length > 0 ? `(${lines.length})` : ''}</h2>
        {lines.length === 0 && <p className="muted">Search above and tap a food to add it.</p>}
        <ul className="recipe-ingredients">
          {lines.map((line, index) => (
            <li key={`${line.foodId ?? line.name}-${index}`} className="recipe-ingredient">
              <span className="recipe-ingredient-name">{line.name}</span>
              <label className="recipe-ingredient-qty">
                <span className="sr-only">Servings of {line.name}</span>
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={line.servings}
                  aria-label={`Servings of ${line.name}`}
                  onChange={(event) => {
                    const next = [...lines];
                    next[index] = { ...line, servings: Number(event.target.value) };
                    setLines(next);
                  }}
                />
                <span className="muted">× {line.servingLabel}</span>
              </label>
              <button type="button" className="recipe-ingredient-remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((_, i) => i !== index))}>×</button>
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="notice">{error}</p>}
      <button className="primary form-save" type="button" onClick={() => void save()} disabled={lines.length === 0}>Save recipe</button>
    </div>
  );
}

function NutrientFields({ nutrients, onChange }: { nutrients: Nutrients; onChange: (value: Nutrients) => void }) {
  return (
    <fieldset className="nutrient-fields">
      <legend>Per serving</legend>
      {CORE_NUTRIENT_FIELDS.map((field) => (
        <label key={field.key} className="nutrient-field">
          <span>{field.label}</span>
          <span className="nutrient-input-wrap">
            <input
              type="number"
              inputMode="decimal"
              step={field.step}
              value={nutrients[field.key]}
              onChange={(event) => onChange(setCoreNutrient(nutrients, field.key, Number(event.target.value)))}
            />
            <span className="nutrient-unit">{field.unit}</span>
          </span>
        </label>
      ))}
      {nutrients.extras.map((extra, index) => (
        <label key={`${extra.key}-${index}`} className="nutrient-field">
          <span>{extra.label}</span>
          <span className="nutrient-input-wrap">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={extra.amount}
              onChange={(event) => onChange(setExtraAt(nutrients, index, Number(event.target.value)))}
            />
            <span className="nutrient-unit">{extra.unit}</span>
          </span>
          <button type="button" className="link-button" onClick={() => onChange(removeExtraAt(nutrients, index))}>Remove</button>
        </label>
      ))}
    </fieldset>
  );
}
