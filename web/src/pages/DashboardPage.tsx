import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DateBar } from '../components/DateBar';
import { DayLog } from '../components/DayLog';
import { HydrationMeter } from '../components/HydrationMeter';
import { MacroBars } from '../components/MacroBars';
import { navigate, nowLocalInput } from '../nav';
import type { DayTotals, MealLog, Targets, WeightStatus } from '../types';

type Dashboard = {
  date: string;
  today: string;
  glassMl: number;
  totals: DayTotals;
  logs: MealLog[];
  targets: Targets;
  weight: WeightStatus;
};

export function DashboardPage() {
  const [day, setDay] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = new URLSearchParams(window.location.search).get('date');
  async function load(): Promise<void> {
    setDay(await api<Dashboard>(`/api/dashboard${date ? `?date=${date}` : ''}`));
  }
  useEffect(() => { void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load today')); }, [date]);
  if (!day) return <p>{error ?? 'Loading today…'}</p>;
  return (
    <div className="stack">
      <DateBar path="/" date={day.date} today={day.today} />
      {error && <p className="notice">{error}</p>}
      {day.weight.enabled && day.weight.reminderDue && <WeightReminder unit={day.weight.unit} today={day.today} onDone={() => void load()} />}
      <div className="grid split">
        <MacroBars totals={day.totals} targets={day.targets} />
        <HydrationMeter
          amountMl={day.totals.hydrationMl}
          targetMl={day.targets.hydrationMl}
          onAdd={() => void api('/api/hydration', { method: 'POST', body: JSON.stringify({ amountMl: day.glassMl, loggedAt: nowLocalInput() }) }).then(load)}
          onRemove={() => void api(`/api/hydration/latest-water?date=${day.date}`, { method: 'DELETE' }).then(load).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not remove water'))}
        />
      </div>
      <DayLog logs={day.logs} onRemove={(id) => void api(`/api/logs/${id}`, { method: 'DELETE' }).then(load)} />
      <button className="primary" type="button" onClick={() => navigate('/add')}>Log food or a drink</button>
    </div>
  );
}

function WeightReminder({ unit, today, onDone }: { unit: 'lb' | 'kg'; today: string; onDone: () => void }) {
  const [weight, setWeight] = useState('');
  return (
    <form className="card" onSubmit={(event) => {
      event.preventDefault();
      void api('/api/weight', { method: 'POST', body: JSON.stringify({ weight: Number(weight), unit, localDate: today }) }).then(onDone);
    }}>
      <h2>Weekly check-in</h2>
      <p className="muted">Only you can see this. It is not on the family dashboard.</p>
      <label>Weight ({unit})<input value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" required /></label>
      <div className="row">
        <button className="primary" type="submit">Save</button>
        <button type="button" onClick={() => void api('/api/weight/dismiss', { method: 'POST', body: '{}' }).then(onDone)}>Not today</button>
      </div>
    </form>
  );
}
