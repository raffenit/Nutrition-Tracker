import type { MealLog, Nutrients, Session } from '../types';

export type OutboxMealEntry = {
  kind: 'meal';
  clientMutationId: string;
  body: Record<string, unknown>;
  createdAt: string;
};

export type OutboxHydrationEntry = {
  kind: 'hydration';
  clientMutationId: string;
  body: { amountMl: number; loggedAt: string; clientMutationId: string };
  createdAt: string;
};

export type OutboxDeleteMealEntry = {
  kind: 'deleteMeal';
  clientMutationId: string;
  mealLogId: string;
  createdAt: string;
};

export type OutboxEntry = OutboxMealEntry | OutboxHydrationEntry | OutboxDeleteMealEntry;

export type CachedDashboard = {
  key: string;
  savedAt: string;
  payload: unknown;
};

export type PendingLogPreview = {
  clientMutationId: string;
  log: MealLog;
  localDate: string;
  nutrients: Nutrients;
  hydrationMl: number;
};

export type CachedSession = Session & { cachedAt: string };
