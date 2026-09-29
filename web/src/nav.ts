import { useEffect, useState } from 'react';

const EVENT = 'nutrition-navigate';

export function navigate(to: string): void {
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(EVENT));
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return path;
}

export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function nowLocalInput(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function formatAmount(value: number, unit: string): string {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit ? `${shown} ${unit}` : shown;
}
