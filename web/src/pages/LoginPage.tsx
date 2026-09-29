import { useState } from 'react';
import { api, clearKioskToken } from '../api/client';
import { HelixMark } from '../components/HelixMark';
import { navigate } from '../nav';
import type { Session, User } from '../types';

type LoginPageProps = { onReady: (session: Session) => void };

export function LoginPage({ onReady }: LoginPageProps) {
  const [error, setError] = useState<string | null>(null);
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
    <main className="app">
      <div className="brand"><HelixMark size={48} /><h1>Nutrition</h1></div>
      <form className="card" onSubmit={(event) => { event.preventDefault(); void submit(new FormData(event.currentTarget)); }}>
        <label>Name<input name="name" required /></label>
        <label>Password<input name="password" type="password" required /></label>
        {error && <p className="notice">{error}</p>}
        <button className="primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}
