import type { IncomingMessage } from 'node:http';

export const SESSION_COOKIE = 'nutrition_session';
const MAX_AGE = 60 * 60 * 24 * 30;

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}
