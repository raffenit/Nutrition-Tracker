import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http/errors.js';

export function assertPassword(password: string): string {
  if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters');
  return password;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensMatch(token: string, hash: string): boolean {
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(hash);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
