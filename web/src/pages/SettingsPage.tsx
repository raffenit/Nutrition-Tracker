import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DATE_FORMAT_OPTIONS, type DateFormat } from '../dateFormat';
import {
  hydrationGoalFromInput,
  hydrationGoalInputValue,
  hydrationTargetLabel,
  type Units,
} from '../units';
import type { DietPresetPublic, Targets, User, WeightStatus } from '../types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type SettingsPageProps = {
  user: User;
  household: { name: string; timezone: string } | null;
};

export function SettingsPage({ user, household }: SettingsPageProps) {
  const [targets, setTargets] = useState<Targets | null>(null);
  const [weight, setWeight] = useState<WeightStatus | null>(null);
  const [kioskUrl, setKioskUrl] = useState<string | null>(null);
  useEffect(() => {
    void api<{ targets: Targets }>('/api/targets').then((result) => setTargets(result.targets));
    void api<{ weight: WeightStatus }>('/api/weight').then((result) => setWeight(result.weight));
  }, []);
  if (!targets || !weight) return <p>Loading settings…</p>;
  return (
    <div className="page">
      <DisplayPreferences
        units={targets.units}
        dateFormat={targets.dateFormat}
        onChange={async (patch) => {
          const next = { ...targets, ...patch };
          const result = await api<{ targets: Targets }>('/api/targets', { method: 'PUT', body: JSON.stringify(next) });
          setTargets(result.targets);
        }}
      />
      <DietPresetPicker
        onApplied={async (next) => {
          setTargets(next);
        }}
      />
      <TargetForm targets={targets} onSave={async (next) => {
        const result = await api<{ targets: Targets }>('/api/targets', { method: 'PUT', body: JSON.stringify(next) });
        setTargets(result.targets);
      }} />
      <WeightSettings weight={weight} onChange={setWeight} />
      {user.role === 'admin' && (
        <section className="card">
          <h2>{household?.name ?? 'Household'}</h2>
          <p className="muted">Times use {household?.timezone ?? 'the server timezone'}.</p>
          <MemberForm />
          <button type="button" onClick={() => void api<{ url: string }>('/api/household/kiosk', { method: 'POST', body: '{}' }).then((result) => setKioskUrl(result.url))}>Create family display link</button>
          {kioskUrl && <p>Paste this into a Home Assistant panel: {kioskUrl}</p>}
        </section>
      )}
    </div>
  );
}

function DisplayPreferences({
  units,
  dateFormat,
  onChange,
}: {
  units: Units;
  dateFormat: DateFormat;
  onChange: (patch: Partial<Pick<Targets, 'units' | 'dateFormat'>>) => Promise<void>;
}) {
  return (
    <section className="card">
      <h2>Display</h2>
      <p className="muted">Personal preferences for dates and units on Home and Family.</p>
      <label>
        Date format
        <select
          value={dateFormat}
          onChange={(event) => void onChange({ dateFormat: event.target.value as DateFormat })}
        >
          {DATE_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.example}</option>
          ))}
        </select>
      </label>
      <p className="muted">Hydration uses fluid ounces in imperial mode and milliliters in metric mode.</p>
      <div className="segmented" role="group" aria-label="Measurement units">
        <button type="button" className={units === 'imperial' ? 'active' : ''} onClick={() => void onChange({ units: 'imperial' })}>Imperial</button>
        <button type="button" className={units === 'metric' ? 'active' : ''} onClick={() => void onChange({ units: 'metric' })}>Metric</button>
      </div>
    </section>
  );
}

function DietPresetPicker({ onApplied }: { onApplied: (targets: Targets) => Promise<void> }) {
  const [presets, setPresets] = useState<DietPresetPublic[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ presets: DietPresetPublic[] }>('/api/diet-presets').then((result) => setPresets(result.presets));
  }, []);
  const selected = presets.find((preset) => preset.id === selectedId) ?? null;
  return (
    <section className="card diet-presets">
      <h2>Diet templates</h2>
      <p className="muted">
        Starting points from public nutrition guidelines (NIH, USDA, ADA, and similar). Not medical advice—adjust with your care team.
      </p>
      <label>
        Template
        <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setError(null); }}>
          <option value="">Choose a pattern…</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
      </label>
      {selected && (
        <div className="diet-preset-detail">
          <p>{selected.summary}</p>
          <p className="muted">
            Source:{' '}
            <a href={selected.sourceUrl} target="_blank" rel="noreferrer noopener">{selected.sourceLabel}</a>
          </p>
        </div>
      )}
      {error && <p className="notice">{error}</p>}
      <button
        type="button"
        className="primary"
        disabled={!selectedId || busy}
        onClick={() => {
          setBusy(true);
          void api<{ targets: Targets }>('/api/targets/apply-preset', {
            method: 'POST',
            body: JSON.stringify({ presetId: selectedId }),
          })
            .then((result) => onApplied(result.targets))
            .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not apply template'))
            .finally(() => setBusy(false));
        }}
      >
        Apply template to my targets
      </button>
    </section>
  );
}

function TargetForm({ targets, onSave }: { targets: Targets; onSave: (targets: Targets) => Promise<void> }) {
  const [draft, setDraft] = useState(targets);
  useEffect(() => setDraft(targets), [targets]);
  return (
    <form className="card" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
      <h2>Daily targets</h2>
      <p className="muted">Personal goals, not medical advice.</p>
      {(['calories', 'protein', 'fiber', 'fat', 'carbs'] as const).map((key) => (
        <label key={key}>
          {key}{draft.carbsIsLimit && key === 'carbs' ? ' (daily max)' : ''}
          <input value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: Number(event.target.value) })} />
        </label>
      ))}
      <label>
        {hydrationTargetLabel(draft.units)}
        <input
          type="number"
          min={0}
          step={draft.units === 'imperial' ? 1 : 50}
          value={hydrationGoalInputValue(draft.hydrationMl, draft.units)}
          onChange={(event) => {
            const raw = event.target.value === '' ? 0 : Number(event.target.value);
            setDraft({ ...draft, hydrationMl: hydrationGoalFromInput(raw, draft.units) });
          }}
        />
      </label>
      {draft.units === 'imperial' ? (
        <p className="muted">Fluid ounces; Add/remove water on Today uses 8 oz per glass.</p>
      ) : (
        <p className="muted">Milliliters; Add/remove water on Today uses one 250 ml glass.</p>
      )}
      <label>
        Sodium {draft.sodiumIsLimit ? 'limit (mg)' : 'target (mg)'}, blank to hide
        <input value={draft.sodium ?? ''} onChange={(event) => setDraft({ ...draft, sodium: event.target.value === '' ? null : Number(event.target.value) })} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={draft.sodiumIsLimit} onChange={(event) => setDraft({ ...draft, sodiumIsLimit: event.target.checked })} />
        Treat sodium as a daily limit (stay at or below)
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={draft.carbsIsLimit} onChange={(event) => setDraft({ ...draft, carbsIsLimit: event.target.checked })} />
        Treat carbs as a daily limit (stay at or below)
      </label>
      <ExtraGoalsEditor
        extras={draft.extras}
        onChange={(extras) => setDraft({ ...draft, extras })}
      />
      <button className="primary" type="submit">Save targets</button>
    </form>
  );
}

function ExtraGoalsEditor({ extras, onChange }: { extras: Targets['extras']; onChange: (extras: Targets['extras']) => void }) {
  return (
    <div className="stack">
      <h3>Extra nutrients to track</h3>
      <p className="muted">Each one gets its own card on Today when the goal is above zero.</p>
      {extras.map((extra, index) => (
        <div className="row tight" key={`${extra.key}-${index}`}>
          <label>Name<input value={extra.label} onChange={(event) => {
            const next = [...extras];
            next[index] = { ...extra, label: event.target.value, key: slug(event.target.value) };
            onChange(next);
          }} /></label>
          <label>Goal<input type="number" min={0} value={extra.amount} onChange={(event) => {
            const next = [...extras];
            next[index] = { ...extra, amount: Number(event.target.value) };
            onChange(next);
          }} /></label>
          <label>Unit<input value={extra.unit} onChange={(event) => {
            const next = [...extras];
            next[index] = { ...extra, unit: event.target.value };
            onChange(next);
          }} /></label>
          <button type="button" className="danger" onClick={() => onChange(extras.filter((_, i) => i !== index))}>Remove</button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...extras, { key: `custom-${extras.length + 1}`, label: 'Custom', amount: 0, unit: 'mg' }])}
      >
        Add nutrient
      </button>
    </div>
  );
}

function slug(label: string): string {
  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return key || 'custom';
}

function WeightSettings({ weight, onChange }: { weight: WeightStatus; onChange: (weight: WeightStatus) => void }) {
  const enabled = weight.enabled;
  return (
    <section className="card">
      <h2>Weight check-ins</h2>
      <p className="muted">Optional. Only you can see these, and they never appear on the family dashboard.</p>
      {!enabled && <button type="button" onClick={() => void api<{ weight: WeightStatus }>('/api/weight/preference', { method: 'PUT', body: JSON.stringify({ enabled: true, weekday: 1, unit: 'lb' }) }).then((result) => onChange(result.weight))}>Turn on weekly check-ins</button>}
      {enabled && (
        <div className="stack">
          <label>Reminder day
            <select value={weight.weekday} onChange={(event) => void api<{ weight: WeightStatus }>('/api/weight/preference', { method: 'PUT', body: JSON.stringify({ enabled: true, weekday: Number(event.target.value), unit: weight.unit }) }).then((result) => onChange(result.weight))}>
              {WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void api<{ weight: WeightStatus }>('/api/weight/preference', { method: 'PUT', body: JSON.stringify({ enabled: false, weekday: weight.weekday, unit: weight.unit }) }).then((result) => onChange(result.weight))}>Turn off</button>
          <button className="danger" type="button" onClick={() => void api<{ weight: WeightStatus }>('/api/weight', { method: 'DELETE' }).then((result) => onChange(result.weight))}>Delete saved weights</button>
        </div>
      )}
    </section>
  );
}

function MemberForm() {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form onSubmit={(event) => { event.preventDefault(); void api('/api/users', { method: 'POST', body: JSON.stringify({ name, password, role: 'member' }) }).then(() => { setName(''); setPassword(''); }); }}>
      <h3>Add a person</h3>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>Password<input type="password" value={password} minLength={8} onChange={(event) => setPassword(event.target.value)} required /></label>
      <button type="submit">Add person</button>
    </form>
  );
}
