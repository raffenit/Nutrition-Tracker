import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { FoodLibraryPicker } from '../components/FoodLibraryPicker';
import { RemoveButton } from '../components/RemoveButton';
import { navigate } from '../nav';
import { kitLineKeyFromText } from '../kitLineKey';
import type { Food } from '../types';

type Ecosystem = { id: string; name: string; mappingCount: number };

type KitMapping = {
  id: string;
  ecosystemId: string;
  kitLineName: string;
  nameKey: string;
  shopEquivalentFoodId: string | null;
  shopEquivalentLabel: string | null;
  nutritionFoodId: string | null;
};

type DraftRow = {
  id: string | null;
  kitLineName: string;
  shopEquivalentFoodId: string | null;
  shopEquivalentLabel: string;
  nutritionFoodId: string | null;
};

export function MealKitsPage({ ecosystemId }: { ecosystemId: string | null }) {
  const [ecosystems, setEcosystems] = useState<Ecosystem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(ecosystemId);
  const [mappings, setMappings] = useState<KitMapping[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [newEcosystemName, setNewEcosystemName] = useState('');
  const [shopPickIndex, setShopPickIndex] = useState<number | null>(null);
  const [nutritionPickIndex, setNutritionPickIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ ecosystems: Ecosystem[] }>('/api/meal-kits').then((result) => {
      setEcosystems(result.ecosystems);
      if (ecosystemId && result.ecosystems.some((e) => e.id === ecosystemId)) {
        setSelectedId(ecosystemId);
      } else if (!selectedId && result.ecosystems[0]) {
        setSelectedId(result.ecosystems[0].id);
      }
    });
  }, [ecosystemId]);

  useEffect(() => {
    if (!selectedId) {
      setMappings([]);
      setDrafts([]);
      return;
    }
    void api<{ mappings: KitMapping[] }>(`/api/meal-kits/${selectedId}/mappings`).then((result) => {
      setMappings(result.mappings);
      setDrafts(result.mappings.map((row) => ({
        id: row.id,
        kitLineName: row.kitLineName,
        shopEquivalentFoodId: row.shopEquivalentFoodId,
        shopEquivalentLabel: row.shopEquivalentLabel ?? '',
        nutritionFoodId: row.nutritionFoodId,
      })));
    });
  }, [selectedId]);

  async function createEcosystem(): Promise<void> {
    const name = newEcosystemName.trim();
    if (!name) return;
    setError(null);
    try {
      const result = await api<{ ecosystem: Ecosystem }>('/api/meal-kits', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setEcosystems((prev) => [...prev, result.ecosystem].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(result.ecosystem.id);
      setNewEcosystemName('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create ecosystem');
    }
  }

  function addBlankRow(): void {
    setDrafts((prev) => [...prev, {
      id: null,
      kitLineName: '',
      shopEquivalentFoodId: null,
      shopEquivalentLabel: '',
      nutritionFoodId: null,
    }]);
  }

  async function saveRow(index: number): Promise<void> {
    if (!selectedId) return;
    const row = drafts[index];
    if (!row || !row.kitLineName.trim()) {
      setError('Each row needs a kit ingredient name');
      return;
    }
    setError(null);
    setStatus(null);
    const payload = {
      kitLineName: row.kitLineName.trim(),
      shopEquivalentFoodId: row.shopEquivalentFoodId,
      shopEquivalentLabel: row.shopEquivalentLabel.trim() || null,
      nutritionFoodId: row.nutritionFoodId,
    };
    try {
      const result = row.id
        ? await api<{ mapping: KitMapping }>(`/api/meal-kits/${selectedId}/mappings/${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<{ mapping: KitMapping }>(`/api/meal-kits/${selectedId}/mappings`, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setDrafts((prev) => {
        const next = [...prev];
        next[index] = {
          id: result.mapping.id,
          kitLineName: result.mapping.kitLineName,
          shopEquivalentFoodId: result.mapping.shopEquivalentFoodId,
          shopEquivalentLabel: result.mapping.shopEquivalentLabel ?? '',
          nutritionFoodId: result.mapping.nutritionFoodId,
        };
        return next;
      });
      setStatus(`Saved “${result.mapping.kitLineName}”`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save row');
    }
  }

  async function removeRow(index: number): Promise<void> {
    if (!selectedId) return;
    const row = drafts[index];
    if (!row) return;
    if (row.id) {
      await api(`/api/meal-kits/${selectedId}/mappings/${row.id}`, { method: 'DELETE' });
    }
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  const selectedName = ecosystems.find((e) => e.id === selectedId)?.name ?? '';

  return (
    <div className="page meal-kits-page">
      <header className="form-head">
        <button type="button" className="back-link" onClick={() => navigate('/settings')}>← Settings</button>
        <h1>Meal-kit reference sheets</h1>
      </header>
      <p className="muted">
        One sheet per meal-kit brand (Green Chef, HelloFresh, …). Kit ingredient names map to what you buy at the store and apply to every recipe in that ecosystem.
      </p>

      <div className="meal-kits-layout">
        <aside className="card meal-kits-ecosystems">
          <h2 className="form-section-title">Ecosystems</h2>
          <ul className="meal-kit-eco-list">
            {ecosystems.map((eco) => (
              <li key={eco.id}>
                <button
                  type="button"
                  className={eco.id === selectedId ? 'meal-kit-eco-btn meal-kit-eco-btn--active' : 'meal-kit-eco-btn'}
                  onClick={() => setSelectedId(eco.id)}
                >
                  {eco.name}
                  <span className="muted">{eco.mappingCount} mapped</span>
                </button>
              </li>
            ))}
          </ul>
          <label className="meal-kit-new-eco">
            New ecosystem
            <input value={newEcosystemName} onChange={(e) => setNewEcosystemName(e.target.value)} placeholder="Green Chef" />
          </label>
          <button type="button" className="settings-secondary-btn" onClick={() => void createEcosystem()}>Add</button>
        </aside>

        <section className="card meal-kits-sheet">
          {selectedId ? (
            <>
              <h2 className="form-section-title">{selectedName} — kit → store</h2>
              <button type="button" className="linkish" onClick={addBlankRow}>Add ingredient mapping</button>
              <ul className="meal-kit-mapping-list">
                {drafts.map((row, index) => (
                  <li key={row.id ?? `new-${index}`} className="meal-kit-mapping-row">
                    <label>
                      Kit name (canonical)
                      <input
                        value={row.kitLineName}
                        onChange={(e) => {
                          const next = [...drafts];
                          next[index] = { ...row, kitLineName: e.target.value };
                          setDrafts(next);
                        }}
                        placeholder="Garlic & herb butter"
                      />
                    </label>
                    <label>
                      Buy at store
                      <input
                        value={row.shopEquivalentLabel}
                        onChange={(e) => {
                          const next = [...drafts];
                          next[index] = { ...row, shopEquivalentLabel: e.target.value, shopEquivalentFoodId: null };
                          setDrafts(next);
                        }}
                      />
                    </label>
                    <MappingRowPickers
                      index={index}
                      row={row}
                      shopPickIndex={shopPickIndex}
                      nutritionPickIndex={nutritionPickIndex}
                      setShopPickIndex={setShopPickIndex}
                      setNutritionPickIndex={setNutritionPickIndex}
                      onShopLink={(food: Food) => {
                        const next = [...drafts];
                        next[index] = { ...row, shopEquivalentFoodId: food.id, shopEquivalentLabel: food.name };
                        setDrafts(next);
                        setShopPickIndex(null);
                      }}
                      onNutritionLink={(food: Food) => {
                        const next = [...drafts];
                        next[index] = { ...row, nutritionFoodId: food.id };
                        setDrafts(next);
                        setNutritionPickIndex(null);
                      }}
                    />
                    <MappingRowKey row={row} />
                    <div className="meal-kit-mapping-actions">
                      <button type="button" className="settings-secondary-btn" onClick={() => void saveRow(index)}>Save row</button>
                      <RemoveButton label="Remove mapping" onClick={() => void removeRow(index)} />
                    </div>
                  </li>
                ))}
              </ul>
              {mappings.length === 0 && drafts.length === 0 && (
                <p className="muted">No mappings yet — add rows here or save equivalents from a recipe in this ecosystem.</p>
              )}
            </>
          ) : (
            <p className="muted">Create an ecosystem to start a reference sheet.</p>
          )}
          {status && <p className="muted">{status}</p>}
          {error && <p className="notice">{error}</p>}
        </section>
      </div>
    </div>
  );
}

function MappingRowKey({ row }: { row: DraftRow }): ReactNode {
  if (!row.kitLineName.trim()) return null;
  return <p className="muted">Matches imports like: <code>{kitLineKeyFromText(row.kitLineName)}</code></p>;
}

function MappingRowPickers({
  index,
  row,
  shopPickIndex,
  nutritionPickIndex,
  setShopPickIndex,
  setNutritionPickIndex,
  onShopLink,
  onNutritionLink,
}: {
  index: number;
  row: DraftRow;
  shopPickIndex: number | null;
  nutritionPickIndex: number | null;
  setShopPickIndex: (v: number | null) => void;
  setNutritionPickIndex: (v: number | null) => void;
  onShopLink: (food: Food) => void;
  onNutritionLink: (food: Food) => void;
}): ReactNode {
  return (
    <div className="meal-kit-mapping-links">
      {row.shopEquivalentFoodId ? (
        <p className="muted">Shop link: library item selected</p>
      ) : (
        <button type="button" className="linkish" onClick={() => setShopPickIndex(shopPickIndex === index ? null : index)}>
          {shopPickIndex === index ? 'Cancel shop link' : 'Link library food for shopping'}
        </button>
      )}
      {shopPickIndex === index && (
        <FoodLibraryPicker shelf="foods" onSelect={onShopLink} actionLabel="Link" />
      )}
      {row.nutritionFoodId ? (
        <p className="muted">Nutrition rollup linked</p>
      ) : (
        <button type="button" className="linkish" onClick={() => setNutritionPickIndex(nutritionPickIndex === index ? null : index)}>
          {nutritionPickIndex === index ? 'Cancel nutrition link' : 'Link library food for nutrition'}
        </button>
      )}
      {nutritionPickIndex === index && (
        <FoodLibraryPicker shelf="foods" onSelect={onNutritionLink} actionLabel="Link" />
      )}
    </div>
  );
}
