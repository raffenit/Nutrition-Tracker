export type ImportProgressStepStatus = 'done' | 'active' | 'pending';

export type ImportProgressStep = {
  label: string;
  status: ImportProgressStepStatus;
};

export type ImportProgressState = {
  phase: 'upload' | 'process';
  percent: number | null;
  message: string;
  detail?: string;
  steps?: ImportProgressStep[];
  elapsedSec?: number;
};

type ImportProgressProps = {
  progress: ImportProgressState;
};

export function ImportProgress({ progress }: ImportProgressProps) {
  const { phase, percent, message, detail, steps, elapsedSec } = progress;
  return (
    <div className="import-progress" aria-busy="true">
      <div className="import-progress-head">
        <p className="import-progress-label">{message}</p>
        {phase === 'process' && elapsedSec != null && elapsedSec > 0 && (
          <span className="import-progress-elapsed" aria-hidden="true">
            {elapsedSec}s
          </span>
        )}
      </div>
      {detail && <p className="muted import-progress-detail">{detail}</p>}
      {steps && steps.length > 0 && (
        <ol className="import-progress-steps" aria-label="Import steps">
          {steps.map((step) => (
            <li
              key={step.label}
              className={`import-progress-step import-progress-step-${step.status}`}
              aria-current={step.status === 'active' ? 'step' : undefined}
            >
              <span className="import-progress-step-marker" aria-hidden="true" />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
      <div
        className={`import-progress-track${percent === null ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label={phase === 'upload' ? 'Upload progress' : 'Processing import'}
      >
        {percent !== null ? (
          <span className="import-progress-fill" style={{ width: `${percent}%` }} />
        ) : (
          <span className="import-progress-fill import-progress-fill-indeterminate" />
        )}
      </div>
    </div>
  );
}
