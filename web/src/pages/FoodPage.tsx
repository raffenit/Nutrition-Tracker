import { useState } from 'react';
import { api } from '../api/client';
import { navigate } from '../nav';
import { EMPTY_NUTRIENTS, type Nutrients, type SearchHit } from '../types';

const FIELDS = ['calories', 'protein', 'fiber', 'fat', 'carbs', 'sodium'] as const;

export function FoodPage({ custom }: { custom: boolean }) {
  return custom ? <CustomMeal /> : <LabelFood />;
}

function LabelFood() {
  const [nutrients, setNutrients] = useState<Nutrients>(EMPTY_NUTRIENTS);
  const [name, setName] = useState('');
  const [serving, setServing] = useState('1 serving');
  const [isDrink, setIsDrink] = useState(false);
  const [drinkMl, setDrinkMl] = useState('355');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    const body = new FormData();
    body.set('file', file);
    const result = await api<{ uploadId: string; draft: { nutrients: Nutrients; servingLabel: string }; candidates: string[]; warning: string | null }>('/api/uploads', { method: 'POST', body });
    setUploadId(result.uploadId);
    setNutrients(result.draft.nutrients);
    setServing(result.draft.servingLabel);
    setCandidates(result.candidates);
    setError(result.warning);
  }
  async function save(form: FormData): Promise<void> {
    try {
      await api('/api/foods', { method: 'POST', body: JSON.stringify({
        name, brand: form.get('brand'), kind: 'packaged', servingLabel: serving, nutrients, isDrink, drinkMl: isDrink ? Number(drinkMl) : null,
        isFavorite: false, source: uploadId ? 'image' : 'manual', uploadId,
      }) });
      navigate('/library');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }
  return (
    <form className="card stack" onSubmit={(event) => { event.preventDefault(); void save(new FormData(event.currentTarget)); }}>
      <h2>Add to the library</h2>
      <label>Photo or PDF<input type="file" accept="image/*,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
      <div className="row">{candidates.map((item) => <button type="button" key={item} onClick={() => setName(item)}>{item}</button>)}</div>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>Brand<input name="brand" /></label>
      <label>Serving<input value={serving} onChange={(event) => setServing(event.target.value)} required /></label>
      {FIELDS.map((field) => (
        <label key={field}>{field}<input value={nutrients[field]} onChange={(event) => setNutrients({ ...nutrients, [field]: Number(event.target.value) })} /></label>
      ))}
      <label><span>This is a drink</span><input type="checkbox" checked={isDrink} onChange={(event) => setIsDrink(event.target.checked)} /></label>
      {isDrink && <label>Volume (ml)<input value={drinkMl} onChange={(event) => setDrinkMl(event.target.value)} /></label>}
      {error && <p className="notice">{error}</p>}
      <button className="primary" type="submit">Save food</button>
    </form>
  );
}

function CustomMeal() {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [lines, setLines] = useState<Array<SearchHit & { servings: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  async function search(): Promise<void> {
    const result = await api<{ results: SearchHit[]; usda: string }>(`/api/ingredients/search?q=${encodeURIComponent(query)}`);
    setHits(result.results);
    if (result.usda === 'missing_key') setError('USDA ingredient search needs a free API key. Packaged foods still search.');
  }
  async function save(): Promise<void> {
    try {
      await api('/api/foods/compose', { method: 'POST', body: JSON.stringify({
        name, makesServings: 1, ingredients: lines.map((line) => ({
          name: line.name, servings: line.servings, nutrients: line.nutrients, sourceRef: line.sourceRef, foodId: line.foodId,
        })),
      }) });
      navigate('/library');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    }
  }
  return (
    <div className="stack">
      <label>Meal name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <div className="row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ingredient" />
        <button type="button" onClick={() => void search()}>Search</button>
      </div>
      {hits.map((hit) => <button type="button" key={`${hit.source}:${hit.name}`} onClick={() => setLines([...lines, { ...hit, servings: 1 }])}>{hit.name} · {hit.servingLabel} · {hit.source}</button>)}
      {lines.map((line, index) => <p key={`${line.name}-${index}`}>{line.servings} × {line.name}</p>)}
      {error && <p className="notice">{error}</p>}
      <button className="primary" type="button" onClick={() => void save()}>Save custom meal</button>
    </div>
  );
}
