import { useCallback, useState } from 'react';

export function useAsyncAction(): {
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }, [busy]);
  return { busy, run };
}
