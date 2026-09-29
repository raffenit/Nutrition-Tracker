import { HttpError } from '../http/errors.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function requiredNumber(value: unknown, label: string): number {
  const number = finiteNumber(value);
  if (number === null) throw new HttpError(400, `${label} must be a number`);
  return number;
}

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${label} is required`);
  }
  return value.trim();
}

export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

export function nonNegative(value: number, label: string): number {
  if (value < 0) throw new HttpError(400, `${label} cannot be negative`);
  return value;
}
