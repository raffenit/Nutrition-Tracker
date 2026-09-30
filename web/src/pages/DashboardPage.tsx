import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DateBar } from '../components/DateBar';
import { DayLog } from '../components/DayLog';
import { HydrationMeter } from '../components/HydrationMeter';
import { GoalCards } from '../components/GoalCards';
import { MacroPieChart } from '../components/MacroPieChart';
import { LogFab } from '../components/LogFab';
import { TrendsPanel, type TrendDay, type TrendWeightPoint } from '../components/TrendsPanel';
import { nowLocalInput } from '../nav';
import type { DayTotals, MealLog, Targets, WeightStatus } from '../types';

type Dashboard = {
  date: string;
  today: string;
  glassMl: number;
  totals: DayTotals;
  logs: MealLog[];
  targets: Targets;
  weight: WeightStatus;
  trends: { days: number; endDate: string; points: TrendDay[]; weight: TrendWeightPoint[] };
};

export function DashboardPage() {
  const [day, setDay] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trendDays, setTrendDays] = useState(7);
  const date = new URLSearchParams(window.location.search).get('date');
  async function load(days = trendDays): Promise<void> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    params.set('days', String(days));
    const query = params.toString();
    setDay(await api<Dashboard>(`/api/dashboard${query ? `?${query}` : ''}`));
  }
  useEffect(() => { void load().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not load today')); }, [date, trendDays]);
  if (!day) return <p>{error ?? 'Loading today…'}</p>;
  return (
    <>
    <div className="page">
    <div className="stack">
      <DateBar path="/" date={day.date} today={day.today} dateFormat={day.targets.dateFormat ?? 'mdy_long'} />
      {error && <p className="notice">{error}</p>}
      {day.weight.enabled && day.weight.reminderDue && <WeightReminder unit={day.weight.unit} today={day.today} onDone={() => void load()} />}
      <MacroPieChart totals={day.totals} />
      <GoalCards totals={day.totals} targets={day.targets} />
      <HydrationMeter
        amountMl={day.totals.hydrationMl}
        targetMl={day.targets.hydrationMl}
        units={day.targets.units}
        onAdd={() => void api('/api/hydration', { method: 'POST', body: JSON.stringify({ amountMl: day.glassMl, loggedAt: nowLocalInput() }) }).then(() => load())}
        onRemove={() => void api(`/api/hydration/latest-water?date=${day.date}`, { method: 'DELETE' }).then(() => load()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not remove water'))}
      />
      <DayLog
        logs={day.logs}
        isToday={day.date === day.today}
        onRemove={(id) => void api(`/api/logs/${id}`, { method: 'DELETE' }).then(() => load())}
      />
      <TrendsPanel
        trends={day.trends}
        units={day.targets.units}
        weightEnabled={day.weight.enabled}
        onDaysChange={(days) => setTrendDays(days)}
      />
    </div>
    </div>
    <LogFab />
    </>
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
