import { api } from '../api/client';
import { listOutboxEntries, removeOutboxEntry } from './db';
import type { OutboxEntry } from './types';

export const SYNC_COMPLETE_EVENT = 'nutrition-sync-complete';

export async function flushOutbox(): Promise<number> {
  if (!navigator.onLine) return 0;
  const entries = await listOutboxEntries();
  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let synced = 0;
  for (const entry of sorted) {
    try {
      await replayOutboxEntry(entry);
      await removeOutboxEntry(entry.clientMutationId);
      synced += 1;
    } catch {
      break;
    }
  }
  if (synced > 0) {
    window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT));
  }
  return synced;
}

async function replayOutboxEntry(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'meal') {
    await api('/api/logs', { method: 'POST', body: JSON.stringify(entry.body) });
    return;
  }
  if (entry.kind === 'deleteMeal') {
    await api(`/api/logs/${entry.mealLogId}`, { method: 'DELETE' });
    return;
  }
  await api('/api/hydration', { method: 'POST', body: JSON.stringify(entry.body) });
}
