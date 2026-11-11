import { useState } from 'react';
import { useAsyncAction } from '../lib/useAsyncAction';
import { api, clearKioskToken } from '../api/client';
import { HelixMark } from '../components/HelixMark';
import { navigate } from '../nav';
import type { Session, User } from '../types';

type LoginPageProps = { onReady: (session: Session) => void };

export function LoginPage({ onReady }: LoginPageProps) {
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAsyncAction();
  async function submit(form: FormData): Promise<void> {
    try {
      clearKioskToken();
      const result = await api<{ user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), password: form.get('password'),
      }) });
      const session = await api<Session>('/api/session');
      onReady({ ...session, user: result.user, mode: 'user' });
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed');
    }
  }
  return (
    <main className="app auth-screen">
      <div className="brand"><HelixMark size={56} /></div>
      <form className="card" onSubmit={(event) => {
        event.preventDefault();
        void run(() => submit(new FormData(event.currentTarget)));
      }}>
        <label>Name<input name="name" required autoComplete="username" disabled={busy} /></label>
        <label>Password<input name="password" type="password" required autoComplete="current-password" disabled={busy} /></label>
        {error && <p className="notice" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
