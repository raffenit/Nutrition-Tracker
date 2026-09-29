import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database.js';

export type SessionRecord = {
  id: string;
  userId: string | null;
  kind: 'user' | 'kiosk';
  expiresAt: string;
};

const USER_SESSION_MS = 1000 * 60 * 60 * 24 * 30;

export function createSession(db: AppDatabase, userId: string | null, kind: SessionRecord['kind']): SessionRecord {
  const session = {
    id: randomUUID(),
    userId,
    kind,
    expiresAt: new Date(Date.now() + USER_SESSION_MS).toISOString(),
  };
  db.prepare(
    `INSERT INTO sessions (id, user_id, kind, expires_at) VALUES (@id, @userId, @kind, @expiresAt)`,
  ).run(session);
  return session;
}

export function findSession(db: AppDatabase, id: string): SessionRecord | null {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  const row = db.prepare(
    'SELECT id, user_id, kind, expires_at FROM sessions WHERE id = ? AND expires_at > ?',
  ).get(id, now) as { id: string; user_id: string | null; kind: 'user' | 'kiosk'; expires_at: string } | undefined;
  if (!row) return null;
  return { id: row.id, userId: row.user_id, kind: row.kind, expiresAt: row.expires_at };
}

export function deleteSession(db: AppDatabase, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
