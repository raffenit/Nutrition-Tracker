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
  /** Recent humanized pipeline activity from the server (OCR routing, columns, stitch). */
  activity?: string[];
  /** Timed OCR pipeline stages when the server reports them. */
  pipelineStages?: Array<{ id: string; label: string; durationMs: number; detail?: string }>;
};

type ImportProgressProps = {
  progress: ImportProgressState;
};

export function ImportProgress({ progress }: ImportProgressProps) {
  const { phase, percent, message, detail, steps, elapsedSec, activity, pipelineStages } = progress;
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
      {activity && activity.length > 0 && (
        <ul className="import-progress-activity" aria-label="Current pipeline activity">
          {activity.slice(-4).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {pipelineStages && pipelineStages.length > 0 && (
        <ul className="import-progress-stages" aria-label="OCR stage timings">
          {pipelineStages
            .filter((s) => s.id !== 'total')
            .slice(-8)
            .map((stage) => (
              <li key={stage.id}>
                {stage.label}: {(stage.durationMs / 1000).toFixed(1)}s
                {stage.detail ? ` (${stage.detail})` : ''}
              </li>
            ))}
        </ul>
      )}
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
