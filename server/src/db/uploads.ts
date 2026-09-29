import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database.js';

export type UploadRecord = {
  id: string;
  foodId: string | null;
  kind: 'image' | 'pdf';
  originalName: string;
  storedName: string;
  extractedText: string;
  createdBy: string | null;
};

type UploadSql = {
  id: string;
  food_id: string | null;
  kind: 'image' | 'pdf';
  original_name: string;
  stored_name: string;
  extracted_text: string | null;
  created_by: string | null;
};

export function insertUpload(
  db: AppDatabase,
  upload: Omit<UploadRecord, 'id' | 'foodId'> & { createdBy: string },
): UploadRecord {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO uploads (id, food_id, kind, original_name, stored_name, extracted_text, created_by, created_at)
     VALUES (@id, NULL, @kind, @originalName, @storedName, @extractedText, @createdBy, @createdAt)`,
  ).run({ id, ...upload, createdAt: new Date().toISOString() });
  return { id, foodId: null, ...upload };
}

export function findUpload(db: AppDatabase, id: string): UploadRecord | null {
  const row = db.prepare(
    `SELECT id, food_id, kind, original_name, stored_name, extracted_text, created_by FROM uploads WHERE id = ?`,
  ).get(id) as UploadSql | undefined;
  if (!row) return null;
  return {
    id: row.id,
    foodId: row.food_id,
    kind: row.kind,
    originalName: row.original_name,
    storedName: row.stored_name,
    extractedText: row.extracted_text ?? '',
    createdBy: row.created_by,
  };
}

export function attachUpload(db: AppDatabase, uploadId: string, foodId: string): void {
  db.prepare('UPDATE uploads SET food_id = ? WHERE id = ?').run(foodId, uploadId);
}
