import { api } from '../api/client';
import type { GoalAlert } from '../types';

type GoalAlertBannersProps = {
  alerts: GoalAlert[];
  localDate: string;
  onDismiss: () => void;
};

export function GoalAlertBanners({ alerts, localDate, onDismiss }: GoalAlertBannersProps) {
  if (alerts.length === 0) return null;
  return (
    <div className="goal-alerts" aria-live="polite">
      {alerts.map((alert) => (
        <div className={`goal-alert goal-alert-${alert.tone}`} key={alert.id} role="status">
          <p>{alert.message}</p>
          {alert.dismissible && (
            <button
              type="button"
              className="linkish"
              onClick={() => void api('/api/alerts/dismiss', {
                method: 'POST',
                body: JSON.stringify({ alertKey: alert.id, localDate }),
              }).then(onDismiss)}
            >
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
