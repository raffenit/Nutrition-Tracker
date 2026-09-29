import { useEffect, useState } from 'react';
import { api } from './api/client';
import { AppShell } from './components/AppShell';
import { usePath } from './nav';
import { AddLogPage } from './pages/AddLogPage';
import { DashboardPage } from './pages/DashboardPage';
import { FamilyPage } from './pages/FamilyPage';
import { FoodPage } from './pages/FoodPage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupPage } from './pages/SetupPage';
import type { Session } from './types';

export function App() {
  const href = usePath();
  const path = href.split('?')[0] ?? '/';
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void api<Session>('/api/session').then(setSession).catch(() => setSession(null));
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
      {path === '/library' && <LibraryPage />}
      {path === '/settings' && session.user && <SettingsPage user={session.user} household={session.household} />}
      {(path === '/foods/new' || path === '/foods/custom') && <FoodPage custom={path === '/foods/custom'} />}
      {path === '/' && <DashboardPage />}
      {path === '/login' && <LoginPage onReady={setSession} />}
    </AppShell>
  );
}
