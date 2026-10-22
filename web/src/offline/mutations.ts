import { api, ApiError } from '../api/client';
import { randomUUID } from '../uuid';
import { addOutboxEntry } from './db';
import type { OutboxDeleteMealEntry, OutboxHydrationEntry, OutboxMealEntry } from './types';

async function scheduleOutboxSync(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration || !('sync' in registration)) return;
  try {
    await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(
      'nutrition-outbox',
    );
  } catch {
    // Background Sync unsupported or denied
  }
}

function newMutationId(): string {
  return randomUUID();
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof ApiError) return false;
  return !navigator.onLine;
}

export async function postMealLog(body: Record<string, unknown>): Promise<{ queued: boolean; clientMutationId: string }> {
  const clientMutationId = newMutationId();
  const payload = { ...body, clientMutationId };
  try {
    await api('/api/logs', { method: 'POST', body: JSON.stringify(payload) });
    return { queued: false, clientMutationId };
  } catch (error) {
    if (!isNetworkFailure(error) && navigator.onLine) throw error;
    const entry: OutboxMealEntry = {
      kind: 'meal',
      clientMutationId,
      body: payload,
      createdAt: new Date().toISOString(),
    };
    await addOutboxEntry(entry);
    await scheduleOutboxSync();
    return { queued: true, clientMutationId };
  }
}

export async function postHydration(amountMl: number, loggedAt: string): Promise<{ queued: boolean }> {
  const clientMutationId = newMutationId();
  const body = { amountMl, loggedAt, clientMutationId };
  try {
    await api('/api/hydration', { method: 'POST', body: JSON.stringify(body) });
    return { queued: false };
  } catch (error) {
    if (!isNetworkFailure(error) && navigator.onLine) throw error;
    const entry: OutboxHydrationEntry = {
      kind: 'hydration',
      clientMutationId,
      body,
      createdAt: new Date().toISOString(),
    };
    await addOutboxEntry(entry);
    await scheduleOutboxSync();
    return { queued: true };
  }
}

export async function queueDeleteMeal(mealLogId: string): Promise<{ queued: boolean }> {
  const clientMutationId = newMutationId();
  try {
    await api(`/api/logs/${mealLogId}`, { method: 'DELETE' });
    return { queued: false };
  } catch (error) {
    if (!isNetworkFailure(error) && navigator.onLine) throw error;
    const entry: OutboxDeleteMealEntry = {
      kind: 'deleteMeal',
      clientMutationId,
      mealLogId,
      createdAt: new Date().toISOString(),
    };
    await addOutboxEntry(entry);
    await scheduleOutboxSync();
    return { queued: true };
  }
}

export async function removePendingMeal(clientMutationId: string): Promise<void> {
  const { removeOutboxEntry } = await import('./db');
  await removeOutboxEntry(clientMutationId);
}

export async function queueDeleteHydration(hydrationId: string): Promise<void> {
  if (hydrationId.startsWith('pending:')) {
    await removePendingMeal(hydrationId.slice('pending:'.length));
    return;
  }
  await api(`/api/hydration/${hydrationId}`, { method: 'DELETE' });
}
