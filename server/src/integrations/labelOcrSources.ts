import type { LabelLayoutHint } from '../domain/labelLayout.js';
import { appendImportJobDebug } from '../import/importJobProgress.js';
import {
  inferLabelLayoutHint,
  type LabelProcessingImage,
} from './imageLayoutHint.js';
import {
  applyGatedPortraitPanelCrop,
  type PortraitPanelCropResult,
} from './portraitLabelPanelCrop.js';

/**
 * Unified full-page OCR input: geometry (variety pack, strips) vs panel bytes (Tess + Easy).
 * Policy C — when the shape gate passes, both engines use the gated panel crop; otherwise the full frame.
 */
export type LabelOcrSources = {
  /** Oriented image for layout geometry (focus-trimmed upload, never portrait panel extract). */
  geometryBytes: Buffer;
  /** Source for full-page Tess/Easy variant generation. */
  pageOcrBytes: Buffer;
  hint: LabelLayoutHint;
  panelCrop: PortraitPanelCropResult;
};

export async function resolveLabelOcrSources(
  resolved: LabelProcessingImage,
  cachePath: string,
): Promise<LabelOcrSources> {
  const geometryBytes = resolved.bytes;
  const panelCrop = await applyGatedPortraitPanelCrop(geometryBytes, cachePath, resolved.hint);

  if (panelCrop.applied) {
    const hint = await inferLabelLayoutHint(panelCrop.bytes);
    appendImportJobDebug(
      `label ocr: panel crop for page OCR (${panelCrop.strategy}) ${hint.width}×${hint.height}px`,
    );
    return {
      geometryBytes,
      pageOcrBytes: panelCrop.bytes,
      hint,
      panelCrop,
    };
  }

  appendImportJobDebug('label ocr: full geometry frame for page OCR');
  return {
    geometryBytes,
    pageOcrBytes: geometryBytes,
    hint: resolved.hint,
    panelCrop,
  };
}