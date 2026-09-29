const KIOSK_KEY = 'nutrition_kiosk_token';

export class ApiError extends Error {}

export function captureKioskToken(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('kiosk');
  if (!token) return;
  sessionStorage.setItem(KIOSK_KEY, token);
  url.searchParams.delete('kiosk');
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
}

export function clearKioskToken(): void {
  sessionStorage.removeItem(KIOSK_KEY);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = sessionStorage.getItem(KIOSK_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? 'Request failed');
  return body as T;
}
