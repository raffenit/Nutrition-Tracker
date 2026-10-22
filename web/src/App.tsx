import { useEffect, useState } from 'react';
import { api } from './api/client';
import { AppShell } from './components/AppShell';
import { usePath } from './nav';
import { AddLogPage } from './pages/AddLogPage';
import { DashboardPage } from './pages/DashboardPage';
import { FamilyPage } from './pages/FamilyPage';
import { FoodPage } from './pages/FoodPage';
import { LibraryPage } from './pages/LibraryPage';
import { PlanPage } from './pages/PlanPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { WeightPage } from './pages/WeightPage';
import { SetupPage } from './pages/SetupPage';
import type { Session } from './types';

export function App() {
  const href = usePath();
  const path = href.split('?')[0] ?? '/';
  const editId = new URLSearchParams(href.includes('?') ? href.split('?')[1] : '').get('id');
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void api<Session>('/api/session')
      .then(async (value) => {
        const { saveSessionCache } = await import('./offline/db');
        await saveSessionCache({ ...value, cachedAt: new Date().toISOString() });
        setSession(value);
      })
      .catch(async () => {
        if (navigator.onLine) {
          setSession(null);
          return;
        }
        const { readSessionCache } = await import('./offline/db');
        const cached = await readSessionCache();
        setSession(cached);
      });
  }, [path]);
  if (!session) return <p className="app">Loading…</p>;
  if (session.setupRequired && path !== '/setup') return <SetupPage onReady={setSession} />;
  if (session.mode === 'none' && path !== '/login' && path !== '/setup') return <LoginPage onReady={setSession} />;
  if (session.mode === 'kiosk' && path !== '/family' && path !== '/login') {
    return <AppShell path="/family" kiosk><FamilyPage kiosk /></AppShell>;
  }
  return (
    <AppShell path={path} kiosk={session.mode === 'kiosk'}>
      {path === '/family' && <FamilyPage kiosk={session.mode === 'kiosk'} />}
      {path === '/add' && <AddLogPage />}
      {path === '/plan' && <PlanPage />}
      {path === '/library' && <LibraryPage />}
      {path === '/settings' && session.user && (
        <SettingsPage user={session.user} household={session.household} onSessionChange={setSession} />
      )}
      {path === '/weight' && <WeightPage />}
      {(path === '/foods/new' || path === '/foods/edit') && <FoodPage editId={path === '/foods/edit' ? editId : null} />}
      {(path === '/recipes/new' || path === '/recipes/edit') && <FoodPage custom editId={path === '/recipes/edit' ? editId : null} />}
      {path === '/' && <DashboardPage />}
      {path === '/login' && <LoginPage onReady={setSession} />}
    </AppShell>
  );
}
