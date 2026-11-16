export type ImportDebugAudience = 'ui' | 'cli';

export type HumanizeImportDebugOptions = {
  audience?: ImportDebugAudience;
  verbose?: boolean;
};

/**
 * Turn pipeline debug into user-visible activity (in-app poll) or CLI lines.
 * Returns null to suppress noise (per-run Tesseract on UI, variant counts, etc.).
 */
export function humanizeImportDebugLine(
  raw: string,
  options: HumanizeImportDebugOptions = {},
): string | null {
  const audience = options.audience ?? 'cli';
  const verbose = options.verbose === true;

  if (audience === 'ui' && !verbose) {
    if (/^ocr (columnStrip|rowBand|wideTable|per_strip|full):/i.test(raw)) return null;
    if (/^ocr .+: \d+ variant/i.test(raw)) return null;
    if (/^Tesseract run \d+:/i.test(raw)) return null;
    if (/^tesseract native /i.test(raw)) return null;
    if (/^EasyOCR run \d+:/i.test(raw)) return null;
    if (/^label row-band: min extract/i.test(raw)) return null;
    if (/ slice \d+: \d+×\d+px/i.test(raw)) return null;
  }

  if (audience === 'cli' && !verbose) {
    if (/^ocr (columnStrip|rowBand|wideTable|per_strip):/i.test(raw)) return null;
    if (/^ocr .+: \d+ variant/i.test(raw)) return null;
  }

  if (/^geometry preflight: (.+)$/i.test(raw)) {
    const summary = raw.replace(/^geometry preflight:\s*/i, '');
    const step = summary.match(/^step (\d) (ok|fail): (.+?)(?:\s*\(|$)/i);
    if (step) {
      const labels = ['', 'Detect columns', 'Find header', 'Classify layout', 'Align rows'];
      const title = labels[Number(step[1])] ?? `Step ${step[1]}`;
      const status = step[2]!.toLowerCase() === 'ok' ? 'OK' : 'failed';
      return `${title}: ${status} — ${step[3]}`;
    }
    return `Layout check: ${summary}`;
  }

  if (raw.startsWith('geometry: shared-rail plan')) {
    return 'Route: shared label table (skipping full-page OCR)';
  }
  if (raw.startsWith('geometry: skip wideTableRetry')) return null;

  const stitchPad = raw.match(/^geometry: (shared-rail|per-column) stitch unavailable — import will pad (\d+) placeholder/i);
  if (stitchPad) {
    const kind = stitchPad[1] === 'shared-rail' ? 'shared table' : 'per-column';
    return `Stitch incomplete (${kind}) — ${stitchPad[2]} placeholder panel(s)`;
  }

  if (raw.startsWith('shared-label grid: batched row-band OCR')) {
    return 'Reading the table row by row (one OCR pass per band)…';
  }
  if (raw.startsWith('shared-label grid: row-band yielded no macro columns')) {
    return 'Row bands weak — retrying with full-column OCR…';
  }
  if (raw.startsWith('shared-label grid: row-band weak macros')) {
    if (raw.includes('calories_row_cells_not_numeric')) {
      return 'Calories row unreliable — retrying full-column OCR…';
    }
    return 'Row-band OCR weak — retrying full-column OCR…';
  }
  const sharedCols = raw.match(
    /^shared-label grid: label \d+px, (\d+) value columns \(ruled-grid detect\)$/,
  );
  if (sharedCols) {
    return `Detected shared label table (${sharedCols[1]} product columns)`;
  }
  if (raw.startsWith('shared-label grid: body-column OCR')) {
    return 'Reading full product columns (slower pass)…';
  }
  if (raw.startsWith('shared-label grid: stitch used row-band slice alignment')) {
    return 'Aligning nutrient rows by horizontal band…';
  }

  const bodyPlan = raw.match(
    /^shared-label grid: body (\d+)px @ y=\d+, row slices=(\d+), rowPitch=(\d+)px, rowOcr=(\w+)$/,
  );
  if (bodyPlan) {
    const mode = bodyPlan[4] === 'true' ? 'row-by-row OCR' : 'full-column OCR';
    return `Nutrient table: ${bodyPlan[2]} bands, ${mode}`;
  }

  const valueIdx = raw.match(/^shared-label grid value (\d+)\/(\d+)$/);
  if (valueIdx) return `__VALUE_PROGRESS__:${valueIdx[1]}/${valueIdx[2]}`;

  if (raw.startsWith('shared-label grid: reading header stacks')) {
    const n = raw.match(/\((\d+) product columns\)/)?.[1];
    return n ? `Reading product header stacks (${n} columns)…` : 'Reading product header stacks…';
  }
  const headerIdx = raw.match(/^shared-label grid: header column (\d+)\/(\d+) OCR/i);
  if (headerIdx) return `__HEADER_PROGRESS__:${headerIdx[1]}/${headerIdx[2]}`;

  const dropped = raw.match(/dropped value column OCR at index \[([^\]]+)\]/);
  if (dropped) return `Removed label bleed from product column ${dropped[1]}`;

  if (raw.startsWith('shared-label grid: stitch failed')) {
    return `Stitch failed (${raw.split('—').pop()?.trim() ?? 'see log'})`;
  }
  if (raw.startsWith('shared-label grid: stitch did not parse as multi-product')) {
    const n = raw.match(/\((\d+) columns\)/)?.[1];
    return n ? `Stitch OK but only ${n} product column(s) parsed` : 'Stitch OK but multi-product parse failed';
  }
  if (raw.startsWith('shared-label grid: stitch structurally OK; parse saw')) {
    const n = raw.match(/parse saw (\d+) columns/)?.[1];
    return n ? `Table stitched — merging ${n} column(s)…` : 'Table stitched — merging columns…';
  }
  const stitchOk = raw.match(/^shared-label grid: stitch OK — (\d+) products \((\d+) with macros\)/);
  if (stitchOk) return `Stitched ${stitchOk[1]} products (${stitchOk[2]} with macros)`;
  const stripStitchOk = raw.match(/^(.+): stitch OK — (\d+) products$/);
  if (stripStitchOk) return `Stitched ${stripStitchOk[2]} product column(s)`;
  const stripStitchFail = raw.match(/^(.+): stitch did not parse as multi-product/);
  if (stripStitchFail) return 'Column stitch did not parse as multi-product';
  if (raw.startsWith('shared-label grid: body-column fallback')) {
    const macros = raw.match(/macroColumns=(\d+)/);
    return `Retrying full-column OCR (${macros?.[1] ?? '?'} macro columns)`;
  }

  if (/^variety grid /i.test(raw) || /^variety pack:/i.test(raw) || /^per-column variety pack:/i.test(raw)) {
    return raw
      .replace(/^per-column variety pack:\s*/i, 'Variety pack: ')
      .replace(/^variety (?:grid|pack):?\s*/i, 'Variety pack: ');
  }
  if (raw.startsWith('column-strip: only')) {
    return 'Not enough product columns detected — using full-page OCR';
  }
  if (raw.startsWith('column-strip: detect returned null')) {
    return 'Could not detect product columns — using full-page OCR';
  }
  if (/^split-single-label:/i.test(raw) || /^column-strip:/i.test(raw)) {
    return raw.replace(/^split-single-label:\s*/i, 'Split label: ');
  }

  if (raw.startsWith('focus:')) return raw.replace(/^focus:\s*/i, 'Focus: ');

  if (raw.startsWith('ocr stage:')) {
    return raw.replace(/^ocr stage:\s*/i, '');
  }
  if (raw.startsWith('ocr progressive: skip Easy')) {
    return 'Core nutrients found — skipping slower neural OCR';
  }
  if (raw.startsWith('ocr progressive: Easy for missing')) {
    const miss = raw.match(/missing (.+)$/);
    return miss ? `Filling gaps with neural OCR (${miss[1]})` : 'Filling nutrient gaps with neural OCR…';
  }

  const pdfPage = raw.match(/^pdf ocr: page (\d+)\/(\d+)$/);
  if (pdfPage) return `Scanning PDF page ${pdfPage[1]} of ${pdfPage[2]}…`;

  if (raw.startsWith('readExtractedText:')) {
    const fail = raw.match(/^readExtractedText:(?:image|pdf): failed \((.+)\)$/);
    if (fail) return `Could not read file (${fail[1].slice(0, 120)})`;
  }
  if (raw.startsWith('easyocr subprocess: failed')) {
    const reason = raw.match(/\((.+)\)$/)?.[1];
    return reason ? `Neural OCR unavailable (${reason.slice(0, 80)})` : 'Neural OCR unavailable — using Tesseract';
  }
  if (raw.startsWith('ocr preprocess: variant build failed')) {
    const reason = raw.replace(/^ocr preprocess: variant build failed —\s*/i, '');
    return `Image prep issue — ${reason.slice(0, 100)}`;
  }
  if (raw.startsWith('inferDepthOfFieldHint: fallback')) {
    const reason = raw.match(/\((.+)\)$/)?.[1];
    return reason ? `Focus hint: ${reason.slice(0, 80)}` : 'Estimating label focus…';
  }
  if (raw.startsWith('inferLabelLayoutHint: fallback')) {
    const reason = raw.match(/\((.+)\)$/)?.[1];
    return reason ? `Layout hint: ${reason.slice(0, 80)}` : 'Estimating label layout…';
  }

  if (audience === 'cli' || verbose) {
    const tessStart = raw.match(/^Tesseract run (\d+): start — (.+)$/);
    if (tessStart) return `Tesseract run ${tessStart[1]}: ${tessStart[2]}`;
    const tessDone = raw.match(/^Tesseract run (\d+): done — (\d+) characters$/);
    if (tessDone) return `Tesseract run ${tessDone[1]}: finished (${tessDone[2]} characters)`;
    if (/^tesseract native /i.test(raw)) return raw;
  }

  if (/^tesseract native/i.test(raw) && audience === 'ui') {
    return 'OCR warning — checking smaller crops…';
  }

  const easyPhase = raw.match(/^EasyOCR run (\d+): phase (\d+) — (.+)$/);
  if (easyPhase && (audience === 'cli' || verbose)) {
    return `EasyOCR run ${easyPhase[1]}, phase ${easyPhase[2]}: ${easyPhase[3]}`;
  }

  return null;
}