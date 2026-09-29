import { HttpError } from './errors.js';
import type { Auth } from './router.js';
import type { UserRecord } from '../db/users.js';
import { tokensMatch } from '../auth/passwords.js';
import { findSession } from '../db/sessions.js';
import { findUserById, getHousehold } from '../db/users.js';
import { bearerToken, readCookie, SESSION_COOKIE } from './cookies.js';
import type { IncomingMessage } from 'node:http';
import type { AppDatabase } from '../db/database.js';

export function loadAuth(db: AppDatabase, req: IncomingMessage): Auth {
  const sessionAuth = authFromSession(db, readCookie(req, SESSION_COOKIE));
  if (sessionAuth.kind !== 'none') return sessionAuth;
  return authFromKioskToken(db, bearerToken(req));
}

export function requireUser(auth: Auth): UserRecord {
  if (auth.kind !== 'user') throw new HttpError(401, 'Sign in required');
  return auth.user;
}

export function requireAdmin(auth: Auth): UserRecord {
  const user = requireUser(auth);
  if (user.role !== 'admin') throw new HttpError(403, 'An admin has to do that');
  return user;
}

export function requireReader(auth: Auth): void {
  if (auth.kind === 'none') throw new HttpError(401, 'Sign in required');
}

function authFromSession(db: AppDatabase, sessionId: string | null): Auth {
  if (!sessionId) return { kind: 'none' };
  const session = findSession(db, sessionId);
  if (!session) return { kind: 'none' };
  if (session.kind === 'kiosk') return { kind: 'kiosk' };
  if (!session.userId) return { kind: 'none' };
  const user = findUserById(db, session.userId);
  return user ? { kind: 'user', user } : { kind: 'none' };
}

function authFromKioskToken(db: AppDatabase, token: string | null): Auth {
  if (!token) return { kind: 'none' };
  const household = getHousehold(db);
  if (!household?.kioskTokenHash || !tokensMatch(token, household.kioskTokenHash)) return { kind: 'none' };
  return { kind: 'kiosk' };
}
