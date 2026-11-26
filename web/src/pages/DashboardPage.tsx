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
import { postHydration, queueDeleteHydration, queueDeleteMeal, removePendingMeal } from '../offline/mutations';
import { saveTargetsCache } from '../offline/db';
import { applyPendingToTotals, pendingHydrationEntries, pendingHydrationMl, pendingPreviewsForDate } from '../offline/pending';
import { SYNC_COMPLETE_EVENT } from '../offline/register';
import { useAsyncAction } from '../lib/useAsyncAction';
import { IconGroup, IconPerson } from '../components/NavIcons';
import { FamilyBoard } from './FamilyPage';
import { navigate, nowLocalInput } from '../nav';
import type { DayTotals, GoalAlert, HydrationEntry, MealLog, Targets, WeightStatus } from '../types';

type Dashboard = {
  date: string;
  today: string;
  glassMl: number;
  totals: DayTotals;
  logs: MealLog[];
  hydration: HydrationEntry[];
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
  const search = new URLSearchParams(window.location.search);
  const date = search.get('date');
  const view = search.get('view') === 'family' ? 'family' : 'me';

  const applyPending = useCallback(async (payload: Dashboard): Promise<Dashboard> => {
    const previews = await pendingPreviewsForDate(payload.date);
    const outbox = await listOutboxEntries();
    const extraHydration = pendingHydrationMl(outbox, payload.date);
    return {
      ...payload,
      totals: applyPendingToTotals(payload.totals, previews, extraHydration),
      logs: [...payload.logs, ...previews.map((row) => row.log)],
      hydration: [...(payload.hydration ?? []), ...pendingHydrationEntries(outbox, payload.date)],
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

  if (view === 'family') {
    return (
      <div className="page family-page home-page">
        <FamilyBoard kiosk={false} datePath="/" query="view=family" leading={<HomeViewToggle view="family" />} />
      </div>
    );
  }

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

  async function removeHydration(id: string): Promise<void> {
    await queueDeleteHydration(id);
    await load();
  }

  return (
    <>
    <div className="page dashboard-page home-page">
      <div className="page-layout-span stack">
        {staleLabel && offline && <p className="muted">Cached dashboard · {staleLabel}</p>}
        <DateBar
          path="/"
          date={day.date}
          today={day.today}
          dateFormat={day.targets.dateFormat ?? 'mdy_long'}
          leading={<HomeViewToggle view="me" />}
        />
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
        <HydrationMeter
          entries={day.hydration}
          amountMl={day.totals.hydrationMl}
          targetMl={day.targets.hydrationMl}
          units={day.targets.units}
          defaultAmountMl={day.glassMl}
          isToday={day.date === day.today}
          promptAdd={day.date === day.today && day.hydration.length === 0}
          onAdd={(amountMl) => void postHydration(amountMl, nowLocalInput()).then(() => load())}
          onRemove={(id) => void removeHydration(id).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'Could not remove'))}
        />
      </div>
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

function HomeViewToggle({ view }: { view: 'me' | 'family' }) {
  const options = [
    { value: 'me' as const, label: 'My log', Icon: IconPerson, href: '/' },
    { value: 'family' as const, label: 'Family view', Icon: IconGroup, href: '/?view=family' },
  ];
  return (
    <div className="home-view-toggle" role="group" aria-label="Home view">
      {options.map(({ value, label, Icon, href }) => (
        <button
          key={value}
          type="button"
          className={view === value ? 'home-view-btn is-active' : 'home-view-btn'}
          aria-label={label}
          aria-pressed={view === value}
          title={label}
          onClick={() => navigate(href)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}

function WeightReminder({ unit, today, onDone }: { unit: 'lb' | 'kg'; today: string; onDone: () => void }) {
  const [weight, setWeight] = useState('');
  const { busy, run } = useAsyncAction();
  return (
    <form className="card" onSubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        await api('/api/weight', { method: 'POST', body: JSON.stringify({ weight: Number(weight), unit, localDate: today }) });
        onDone();
      });
    }}>
      <h2>Weekly check-in</h2>
      <p className="muted">Only you can see this. It is not on the family dashboard.</p>
      <label>Weight ({unit})<input value={weight} onChange={(event) => setWeight(event.target.value)} inputMode="decimal" required disabled={busy} /></label>
      <button type="submit" className="primary" disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
