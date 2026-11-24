import type { GroceryLineItem } from '../domain/groceryList.js';
import type { AppDatabase } from './database.js';

export function getStoredGroceryList(db: AppDatabase, weekStart: string): GroceryLineItem[] | null {
  const row = db.prepare('SELECT items FROM grocery_lists WHERE week_start = ?').get(weekStart) as { items: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.items) as unknown;
    return Array.isArray(parsed) ? (parsed as GroceryLineItem[]) : null;
  } catch {
    return null;
  }
}

export function putStoredGroceryList(db: AppDatabase, weekStart: string, items: GroceryLineItem[]): void {
  db.prepare(
    `INSERT INTO grocery_lists (week_start, items, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
  ).run(weekStart, JSON.stringify(items), new Date().toISOString());
}

export function deleteStoredGroceryList(db: AppDatabase, weekStart: string): void {
  db.prepare('DELETE FROM grocery_lists WHERE week_start = ?').run(weekStart);
}
