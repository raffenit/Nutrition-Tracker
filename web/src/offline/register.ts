import { flushOutbox, SYNC_COMPLETE_EVENT } from './sync';

export { SYNC_COMPLETE_EVENT };

export function registerOfflineSupport(): void {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js');
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'FLUSH_OUTBOX') void flushOutbox();
    });
  }
  window.addEventListener('online', () => {
    void flushOutbox();
  });
}
