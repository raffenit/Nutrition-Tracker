import type { DragEvent, ReactNode, RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';
import { ImportProgress, type ImportProgressState } from './ImportProgress';
import { LabelCaptureHints } from './LabelCaptureHints';

export type FoodImportStatus =
  | { kind: 'ok'; text: string }
  | { kind: 'warn'; text: string }
  | { kind: 'err'; text: string };

type FoodImportPanelProps = {
  nativeLabelCamera: boolean;
  importBusy: boolean;
  importUrl: string;
  onImportUrlChange: (value: string) => void;
  onImportLink: () => void;
  onUploadFile: (file: File) => void;
  onImportStatus: (status: FoodImportStatus | null) => void;
  importProgress: ImportProgressState | null;
  importStatus: FoodImportStatus | null;
  cameraInputRef: RefObject<HTMLInputElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  children?: ReactNode;
};

function acceptImportFile(file: File): boolean {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return true;
  if (file.type.startsWith('image/')) return true;
  const lower = file.name.toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/.test(lower);
}

function IconCamera() {
  return (
    <svg className="import-tile-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.5 5.5 8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-1.5-1.5H9.5ZM12 17a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"
      />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg className="import-tile-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5a2 2 0 0 1 2-2h4.5l2 2H18a2 2 0 0 1 2 2v1H4V5Zm0 4h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z"
      />
    </svg>
  );
}

export function FoodImportPanel({
  nativeLabelCamera,
  importBusy,
  importUrl,
  onImportUrlChange,
  onImportLink,
  onUploadFile,
  onImportStatus,
  importProgress,
  importStatus,
  cameraInputRef,
  fileInputRef,
  children,
}: FoodImportPanelProps) {
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const handleFile = useCallback(
    (file: File) => {
      if (!acceptImportFile(file)) {
        onImportStatus({ kind: 'warn', text: 'Use a photo (JPEG, PNG, …) or a PDF.' });
        return;
      }
      onImportStatus(null);
      onUploadFile(file);
    },
    [onImportStatus, onUploadFile],
  );

  function onDragEnter(event: DragEvent): void {
    event.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }

  function onDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (importBusy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <section className="card form-section import-panel" aria-labelledby="food-import-heading">
      <h2 id="food-import-heading" className="form-section-title">Import from photo, PDF, or link</h2>
      <p className="muted import-hint">Optional. For labels, a sharp photo beats a PDF link.</p>
      <LabelCaptureHints />

      <div
        className={`import-dropzone${dragOver ? ' is-dragover' : ''}`}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className={`import-tiles${nativeLabelCamera ? '' : ' import-tiles-single'}`}>
          {nativeLabelCamera ? (
            <button
              type="button"
              className="import-tile import-tile-primary"
              disabled={importBusy}
              onClick={() => cameraInputRef.current?.click()}
            >
              <IconCamera />
              <span className="import-tile-title">Take label photo</span>
              <span className="import-tile-desc">Uses your device camera with the rear lens when available.</span>
            </button>
          ) : (
            <p className="import-desktop-note" role="note">
              <strong>Take label photo</strong> works on phones and tablets. On desktop, choose a file or drag it here
              — or open this page on your phone for the built-in camera.
            </p>
          )}
          <button
            type="button"
            className={`import-tile${nativeLabelCamera ? '' : ' import-tile-primary'}`}
            disabled={importBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <IconFolder />
            <span className="import-tile-title">Choose photo or PDF</span>
            <span className="import-tile-desc">JPEG, PNG, HEIC, or a menu PDF from your files.</span>
          </button>
        </div>
        <p className="import-drop-hint">or drag a photo or PDF into this area</p>
      </div>

      {nativeLabelCamera && (
        <input
          ref={cameraInputRef}
          className="import-file-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) handleFile(file);
          }}
        />
      )}
      <input
        ref={fileInputRef}
        className="import-file-input"
        type="file"
        accept="image/*,.pdf,application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) handleFile(file);
        }}
      />

      <div className="import-url-block">
        <span className="import-url-label muted">Or paste a link</span>
        <div className="import-url-row">
          <input
            value={importUrl}
            disabled={importBusy}
            onChange={(event) => onImportUrlChange(event.target.value)}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            aria-label="Product or menu URL"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onImportLink();
              }
            }}
          />
          <button
            type="button"
            className="primary import-url-btn"
            disabled={importBusy || !importUrl.trim()}
            onClick={() => onImportLink()}
          >
            {importBusy ? '…' : 'Import'}
          </button>
        </div>
      </div>

      {importProgress && <ImportProgress progress={importProgress} />}
      {importStatus && (
        <p
          className={`import-status import-status-${importStatus.kind}`}
          role={importStatus.kind === 'err' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {importStatus.text}
        </p>
      )}

      {children}
    </section>
  );
}
