import { useState } from 'react';
import { useAsyncAction } from '../lib/useAsyncAction';
import { api } from '../api/client';
import { HelixMark } from '../components/HelixMark';
import { navigate } from '../nav';
import type { Session, User } from '../types';

type SetupPageProps = { onReady: (session: Session) => void };

export function SetupPage({ onReady }: SetupPageProps) {
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAsyncAction();
  async function submit(form: FormData): Promise<void> {
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setError('Passwords do not match');
      return;
    }
    try {
      const result = await api<{ user: User }>('/api/setup', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), password, householdName: form.get('householdName'),
      }) });
      onReady({
        setupRequired: false,
        mode: 'user',
        user: result.user,
        household: {
          name: String(form.get('householdName') || 'Household'),
          timezone: 'America/Chicago',
          multiLabelImportDefault: null,
        },
      });
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup failed');
    }
  }
  return (
    <main className="app auth-screen">
      <div className="brand"><HelixMark size={56} /></div>
      <form className="card" onSubmit={(event) => {
        event.preventDefault();
        void run(() => submit(new FormData(event.currentTarget)));
      }}>
        <label>Household name<input name="householdName" required disabled={busy} /></label>
        <label>Your name<input name="name" required disabled={busy} /></label>
        <label>Password<input name="password" type="password" minLength={8} required disabled={busy} /></label>
        <label>Confirm password<input name="confirm" type="password" minLength={8} required disabled={busy} /></label>
        {error && <p className="notice" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? 'Creating…' : 'Create the household'}
        </button>
      </form>
    </main>
  );
}
