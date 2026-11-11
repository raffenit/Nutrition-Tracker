import { api } from '../api/client';
import type { ImportJobSnapshot } from '../types/importJob';

const POLL_MS = 450;

export function pollImportJob(
  jobId: string,
  onUpdate: (snapshot: ImportJobSnapshot) => void,
): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const snapshot = await api<ImportJobSnapshot>(`/api/import-jobs/${jobId}`);
      onUpdate(snapshot);
      if (snapshot.done) stopped = true;
    } catch {
      // Job may not exist until the server handler starts.
    }
  };
  void tick();
  const timer = window.setInterval(() => void tick(), POLL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}
