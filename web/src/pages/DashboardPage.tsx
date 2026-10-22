import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { DateBar } from '../components/DateBar';
import { DayLog } from '../components/DayLog';
import { HydrationMeter } from '../components/HydrationMeter';
import { GoalAlertBanners } from '../components/GoalAlertBanners';
import { MacroPieChart } from '../components/MacroPieChart';
import { TrendsPanel, type TrendDay, type TrendWeightPoint } from '../components/TrendsPanel';
import { useOfflineStatus } from '../hooks/useOfflineStatus';
import { readDashboardCache, saveDashboardCache } from '../offline/db';
import { listOutboxEntries } from '../offline/db';
import { postHydration, queueDeleteMeal, removePendingMeal } from '../offline/mutations';
import { saveTargetsCache } from '../offline/db';
import { applyPendingToTotals, pendingHydrationMl, pendingPreviewsForDate } from '../offline/pending';
import { SYNC_COMPLETE_EVENT } from '../offline/register';
import { nowLocalInput } from '../nav';
import type { DayTotals, GoalAlert, MealLog, Targets, WeightStatus } from '../types';

type Dashboard = {
  date: string;
  today: string;
  glassMl: number;
  totals: DayTotals;
  logs: MealLog[];
  targets: Targets;
  alerts: GoalAlert[];
  weight: WeightStatus;
  trends: { days: number; endDate: string; points: TrendDay[]; weight: TrendWeightPoint[] };
};

function dashboardCacheKey(date: string | null, days: number): string {
  return `dashboard:${date ?? 'today'}:d${days}`;
}

export function DashboardPage() {
  const [day, setDay] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleLabel, setStaleLabel] = useState<string | null>(null);
  const [trendDays, setTrendDays] = useState(7);
  const { offline } = useOfflineStatus();
  const date = new URLSearchParams(window.location.search).get('date');

  const applyPending = useCallback(async (payload: Dashboard): Promise<Dashboard> => {
    const previews = await pendingPreviewsForDate(payload.date);
    const outbox = await listOutboxEntries();
    const extraHydration = pendingHydrationMl(outbox, payload.date);
    return {
      ...payload,
      totals: applyPendingToTotals(payload.totals, previews, extraHydration),
      logs: [...payload.logs, ...previews.map((row) => row.log)],
    };
  }, []);

  const load = useCallback(async (days = trendDays): Promise<void> => {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    params.set('days', String(days));
    const query = params.toString();
    const cacheKey = dashboardCacheKey(date, days);
    try {
      const payload = await api<Dashboard>(`/api/dashboard${query ? `?${query}` : ''}`);
      await saveDashboardCache(cacheKey, payload);
      await saveTargetsCache(payload.targets);
      setStaleLabel(null);
      setDay(await applyPending(payload));
      setError(null);
    } catch (caught) {
      const cached = await readDashboardCache<Dashboard>(cacheKey);
      if (!cached) {
        setError(caught instanceof Error ? caught.message : 'Could not load today');
        return;
      }
      setStaleLabel(new Date(cached.savedAt).toLocaleString());
      setDay(await applyPending(cached.payload));
      setError(offline ? null : (caught instanceof Error ? caught.message : 'Could not refresh today'));
    }
  }, [applyPending, date, offline, trendDays]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onSync = () => {
      void load();
    };
    window.addEventListener(SYNC_COMPLETE_EVENT, onSync);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, onSync);
  }, [load]);

  if (!day) return <p>{error ?? 'Loading today…'}</p>;

  async function removeLog(id: string): Promise<void> {
    if (id.startsWith('pending:')) {
      await removePendingMeal(id.slice('pending:'.length));
      await load();
      return;
    }
    await queueDeleteMeal(id);
    await load();
  }

  return (
    <>
    <div className="page dashboard-page">
      <div className="page-layout-span stack">
        {staleLabel && offline && <p className="muted">Cached dashboard · {staleLabel}</p>}
        <DateBar path="/" date={day.date} today={day.today} dateFormat={day.targets.dateFormat ?? 'mdy_long'} />
        {error && <p className="notice">{error}</p>}
        {day.weight.enabled && day.weight.reminderDue && !offline && (
          <WeightReminder unit={day.weight.unit} today={day.today} onDone={() => void load()} />
        )}
        <GoalAlertBanners alerts={day.alerts ?? []} localDate={day.date} onDismiss={() => void load()} />
      </div>
      <div className="dashboard-hero">
        <MacroPieChart totals={day.totals} targets={day.targets} />
        <DayLog
          logs={day.logs}
          isToday={day.date === day.today}
          onRemove={(id) => void removeLog(id).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not remove'))}
        />
      </div>
      <HydrationMeter
        amountMl={day.totals.hydrationMl}
        targetMl={day.targets.hydrationMl}
        units={day.targets.units}
        promptAdd={day.date === day.today && day.totals.hydrationMl <= 0}
        onAdd={() => void postHydration(day.glassMl, nowLocalInput()).then(() => load())}
        onRemove={() => void api(`/api/hydration/latest-water?date=${day.date}`, { method: 'DELETE' }).then(() => load()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not remove water'))}
      />
      <TrendsPanel
        trends={day.trends}
        units={day.targets.units}
        weightEnabled={day.weight.enabled}
        onDaysChange={(days) => setTrendDays(days)}
      />
    </div>
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
      <button type="submit">Save</button>
    </form>
  );
}
