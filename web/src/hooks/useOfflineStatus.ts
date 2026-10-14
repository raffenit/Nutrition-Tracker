import { useEffect, useState } from 'react';
import { outboxCount } from '../offline/db';
import { SYNC_COMPLETE_EVENT } from '../offline/register';

export function useOfflineStatus(): { offline: boolean; pendingCount: number } {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const refreshPending = () => {
      void outboxCount().then(setPendingCount).catch(() => setPendingCount(0));
    };
    const onOnline = () => {
      setOffline(false);
      refreshPending();
    };
    const onOffline = () => {
      setOffline(true);
      refreshPending();
    };
    refreshPending();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener(SYNC_COMPLETE_EVENT, refreshPending);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener(SYNC_COMPLETE_EVENT, refreshPending);
    };
  }, []);

  return { offline, pendingCount };
}
