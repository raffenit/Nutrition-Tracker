import type { Food, Targets } from '../types';
import type { CachedSession, OutboxEntry } from './types';

const DB_NAME = 'nutrition-offline';
const DB_VERSION = 2;

function ensureDashboardsStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains('dashboards')) db.deleteObjectStore('dashboards');
  db.createObjectStore('dashboards', { keyPath: 'key' });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const fromVersion = event.oldVersion;
      if (fromVersion < 1) {
        db.createObjectStore('meta');
        db.createObjectStore('foods', { keyPath: 'id' });
        ensureDashboardsStore(db);
        db.createObjectStore('outbox', { keyPath: 'clientMutationId' });
        return;
      }
      if (fromVersion < 2) {
        ensureDashboardsStore(db);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const result = run(store);
        if (result) {
          result.onsuccess = () => resolve(result.result as T);
          result.onerror = () => reject(result.error ?? new Error('IndexedDB request failed'));
        } else {
          transaction.oncomplete = () => resolve(undefined);
          transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        }
      }),
  );
}

export async function saveSessionCache(session: CachedSession): Promise<void> {
  await tx('meta', 'readwrite', (store) => store.put(session, 'session'));
}

export async function readSessionCache(): Promise<CachedSession | null> {
  const row = await tx<CachedSession>('meta', 'readonly', (store) => store.get('session'));
  return row ?? null;
}

export async function saveDashboardCache(key: string, payload: unknown): Promise<void> {
  const row = { key, savedAt: new Date().toISOString(), payload };
  await tx('dashboards', 'readwrite', (store) => store.put(row));
}

export async function readDashboardCache<T>(key: string): Promise<{ savedAt: string; payload: T } | null> {
  const row = await tx<{ key: string; savedAt: string; payload: T }>('dashboards', 'readonly', (store) =>
    store.get(key),
  );
  if (!row) return null;
  return { savedAt: row.savedAt, payload: row.payload };
}

export async function mergeFoodsCache(foods: Food[]): Promise<void> {
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('foods', 'readwrite');
        const store = transaction.objectStore('foods');
        for (const food of foods) store.put(food);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Food cache failed'));
      }),
  );
}

export async function listCachedFoods(): Promise<Food[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction('foods', 'readonly');
        const store = transaction.objectStore('foods');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result as Food[]);
        request.onerror = () => reject(request.error ?? new Error('Food cache read failed'));
      }),
  );
}

export async function addOutboxEntry(entry: OutboxEntry): Promise<void> {
  await tx('outbox', 'readwrite', (store) => store.put(entry));
}

export async function listOutboxEntries(): Promise<OutboxEntry[]> {
  const rows = await tx<OutboxEntry[]>('outbox', 'readonly', (store) => store.getAll());
  return rows ?? [];
}

export async function removeOutboxEntry(clientMutationId: string): Promise<void> {
  await tx('outbox', 'readwrite', (store) => store.delete(clientMutationId));
}

export async function outboxCount(): Promise<number> {
  const entries = await listOutboxEntries();
  return entries.length;
}

export async function readPinnedFoodIds(): Promise<string[]> {
  const ids = await tx<string[]>('meta', 'readonly', (store) => store.get('pinnedFoodIds'));
  return ids ?? [];
}

export async function writePinnedFoodIds(ids: string[]): Promise<void> {
  await tx('meta', 'readwrite', (store) => store.put(ids, 'pinnedFoodIds'));
}

export async function togglePinnedFoodId(foodId: string): Promise<boolean> {
  const ids = await readPinnedFoodIds();
  const set = new Set(ids);
  if (set.has(foodId)) set.delete(foodId);
  else set.add(foodId);
  await writePinnedFoodIds([...set]);
  return set.has(foodId);
}

export async function saveTargetsCache(targets: Targets): Promise<void> {
  await tx('meta', 'readwrite', (store) => store.put({ targets, savedAt: new Date().toISOString() }, 'targets'));
}

export async function readTargetsCache(): Promise<Targets | null> {
  const row = await tx<{ targets: Targets }>('meta', 'readonly', (store) => store.get('targets'));
  return row?.targets ?? null;
}

export async function clearOfflineData(): Promise<void> {
  await openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const names = ['meta', 'foods', 'dashboards', 'outbox'] as const;
        const transaction = db.transaction(names, 'readwrite');
        for (const name of names) transaction.objectStore(name).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Clear offline data failed'));
      }),
  );
}
