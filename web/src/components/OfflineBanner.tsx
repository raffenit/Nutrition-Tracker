type OfflineBannerProps = {
  offline: boolean;
  pendingCount: number;
  staleLabel?: string | null;
};

export function OfflineBanner({ offline, pendingCount, staleLabel }: OfflineBannerProps) {
  if (!offline && pendingCount === 0 && !staleLabel) return null;
  return (
    <div className="offline-banner" role="status">
      {offline && <p><strong>Offline.</strong> Showing saved data; new logs sync when you reconnect.</p>}
      {!offline && pendingCount > 0 && (
        <p><strong>{pendingCount} pending</strong> — syncing to the server…</p>
      )}
      {staleLabel && <p className="muted">Last updated {staleLabel}</p>}
    </div>
  );
}
