export type ImportProgressState = {
  phase: 'upload' | 'process';
  percent: number | null;
  message: string;
};

type ImportProgressProps = {
  progress: ImportProgressState;
};

export function ImportProgress({ progress }: ImportProgressProps) {
  const { phase, percent, message } = progress;
  return (
    <div className="import-progress" aria-busy="true">
      <p className="import-progress-label">{message}</p>
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
      {phase === 'process' && (
        <p className="muted import-progress-note">OCR and PDF parsing can take up to a minute on the server.</p>
      )}
    </div>
  );
}
