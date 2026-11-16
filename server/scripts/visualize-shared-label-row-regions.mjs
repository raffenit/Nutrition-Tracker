/**
 * Overlay detected row surfaces: label rail + per-column header bands + nutrient body.
 * Usage: npm run build && node scripts/visualize-shared-label-row-regions.mjs [jpg]
 *
 * Writes: local/diagnostics/row-regions/
 *   preview.html       — open in browser (photo + overlay)
 *   overlay.svg          — dashed consensus / solid per-column; gold = header zone
 *   regions.json
 *   crops/{header,body}/{consensus,per-column,label}/…
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { formatVarietyPackStepValidation, runVarietyPackGridPipeline } from '../dist/integrations/varietyPackGridPipeline.js';
import { horizontalRuleRowYsInColumn } from '../dist/integrations/ruledTableGridDetect.js';
import { nutritionTableInkSpanAnalysisX } from '../dist/domain/nutritionTableInkBounds.js';
import {
  mapAnalysisRuleYsToImage,
  clipRowRegionBoxToRect,
  rowBandSliceAxisAlignedBounds,
  rowRegionBoxesFromSlices,
  rowRegionDriftSummary,
} from '../dist/domain/sharedLabelRowRegions.js';
import { mapAnalysisXToImageBand } from '../dist/domain/sharedLabelGridLayout.js';
import { prepareVarietyPackBandContext } from '../dist/integrations/varietyPackGridPipeline.js';
import { resolveLabelProcessingImage } from '../dist/integrations/imageLayoutHint.js';
import { sharedLabelGridEnvelopeRect } from '../dist/domain/sharedLabelGridEnvelope.js';
import { DEFAULT_SHARED_LABEL_GRID_PARAMS } from '../dist/domain/sharedLabelGridParams.js';
import { valueColumnAnalysisBoundsWidthDiagnostics } from '../dist/domain/sharedLabelColumnSeparation.js';
import {
  loadGlareGroundTruthForImage,
  resolveGlareGroundTruthRowTargets,
  rowBandSliceForGlareGroundTruthTarget,
  valueColumnIndexForAnalysisSegment,
} from '../dist/domain/sharedLabelGlareGroundTruth.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const glareGroundTruthFixturesDir = path.join(repoRoot, 'server/src/test/fixtures');
const imagePath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'local/test-images/costco-candy.jpg'));
const outDir = path.join(repoRoot, 'local/diagnostics/row-regions');

/** Viz: header/body zone, label vs product column, even/odd row & column stripes — not per-row rainbow. */
function vizStyleForBox(box) {
  const isLabel = box.columnIndex < 0;
  const isHeader = box.zone === 'header';
  const rowEven = box.rowIndex >= 0 && box.rowIndex % 2 === 0;
  const colEven = box.columnIndex >= 0 && box.columnIndex % 2 === 0;
  if (isHeader) {
    const a = rowEven ? 0.36 : 0.22;
    return isLabel
      ? { fill: `rgba(255, 120, 40, ${a})`, stroke: '#ff6a1a', strokeWidth: 3 }
      : { fill: `rgba(255, 200, 60, ${a})`, stroke: '#c8a000', strokeWidth: 2 };
  }
  const rowA = rowEven ? 0.3 : 0.17;
  if (isLabel) {
    return { fill: `rgba(90, 210, 255, ${rowA})`, stroke: '#00b8e6', strokeWidth: 3 };
  }
  const a = rowA + (colEven ? 0.06 : 0);
  return colEven
    ? { fill: `rgba(70, 130, 255, ${a})`, stroke: '#4d8cff', strokeWidth: 2 }
    : { fill: `rgba(30, 95, 210, ${a})`, stroke: '#2060c8', strokeWidth: 2 };
}

function svgRect(box, { stroke, fill, dash, strokeWidth = 2 }) {
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  const sw = strokeWidth;
  return `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dashAttr}/>`;
}

function columnLabelBadgeMetrics(bandWidthPx) {
  const fontSize = Math.max(40, Math.round(bandWidthPx * 0.017));
  const height = Math.max(54, Math.round(fontSize * 1.45));
  const charWidth = Math.round(fontSize * 0.72);
  const padWidth = Math.round(fontSize * 0.65);
  const minWidth = Math.round(fontSize * 1.55);
  return {
    fontSize,
    height,
    charWidth,
    padWidth,
    minWidth,
    radius: Math.max(8, Math.round(fontSize * 0.22)),
    strokeWidth: Math.max(3, Math.round(fontSize * 0.08)),
  };
}

function columnLabelBadgeSize(number, bandWidthPx) {
  const m = columnLabelBadgeMetrics(bandWidthPx);
  const t = String(number);
  const w = Math.max(m.minWidth, m.padWidth + t.length * m.charWidth);
  return { w, h: m.height, text: t, metrics: m };
}

function columnLabelBadgeSvg(number, bandWidthPx) {
  const { w, h, text, metrics: m } = columnLabelBadgeSize(number, bandWidthPx);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${m.radius}" fill="#0a0a0c" stroke="#fff" stroke-width="${m.strokeWidth}"/><text x="${w / 2}" y="${h / 2 + 2}" fill="#fff" font-size="${m.fontSize}" font-weight="700" font-family="Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
}

/** Dark badge + text; badge stays visible when librsvg omits system fonts on the baked JPEG. */
function svgColumnNumberLabel(centerX, bandY, number, bandWidthPx) {
  const { w, h, text, metrics: m } = columnLabelBadgeSize(number, bandWidthPx);
  const x = centerX - w / 2;
  const y = bandY;
  return `<g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${m.radius}" fill="rgba(6,6,8,0.92)" stroke="#ffffff" stroke-width="${m.strokeWidth}"/>
  <text x="${centerX}" y="${y + h / 2 + 2}" fill="#ffffff" font-size="${m.fontSize}" font-weight="700" font-family="Arial, Helvetica, Liberation Sans, sans-serif" text-anchor="middle" dominant-baseline="middle">${text}</text>
</g>`;
}

async function compositeColumnLabelBadges(baseJpeg, descriptors, canvasW, canvasH) {
  const composites = [];
  for (const d of descriptors) {
    const centerX = d.centerXFrac * canvasW;
    const bandY = d.bandYFrac * canvasH;
    const { w, h } = columnLabelBadgeSize(d.valueColumnIndex, canvasW);
    const badgeSvg = Buffer.from(columnLabelBadgeSvg(d.valueColumnIndex, canvasW));
    composites.push({
      input: badgeSvg,
      left: Math.max(0, Math.round(centerX - w / 2)),
      top: Math.max(0, Math.round(bandY)),
    });
  }
  if (composites.length === 0) return baseJpeg;
  return sharp(baseJpeg).composite(composites).jpeg({ quality: 90 }).toBuffer();
}

function svgGlareGroundTruthMarker(box, highlightTopFraction) {
  let height = box.height;
  if (highlightTopFraction != null && highlightTopFraction > 0 && highlightTopFraction < 1) {
    height = Math.max(4, height * highlightTopFraction);
  }
  return svgRect(
    { ...box, height },
    {
      fill: 'rgba(255, 90, 40, 0.35)',
      stroke: '#ff5a1a',
      strokeWidth: 4,
      dash: '10 6',
    },
  );
}

function svgRowRegion(box, style) {
  const skewed = (box.topSkewPx ?? 0) !== 0 || (box.bottomSkewPx ?? 0) !== 0;
  if (!skewed) return svgRect(box, style);
  const x0 = box.left;
  const x1 = box.left + box.width;
  const topL = box.top;
  const topR = box.top + (box.topSkewPx ?? 0);
  const botL = box.top + box.height;
  const botR = botL + (box.bottomSkewPx ?? 0);
  const dashAttr = style.dash ? ` stroke-dasharray="${style.dash}"` : '';
  const sw = style.strokeWidth ?? 2;
  return `<polygon points="${x0},${topL} ${x1},${topR} ${x1},${botR} ${x0},${botL}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${sw}"${dashAttr}/>`;
}

const uploadBytes = await readFile(imagePath);
const { bytes, focusCropApplied } = await resolveLabelProcessingImage(uploadBytes);
console.log('image:', imagePath, focusCropApplied ? '(focus crop applied)' : '');

const ctx = await prepareVarietyPackBandContext(bytes, { maxColumns: 14 });
if (!ctx) {
  console.error('No variety-pack band context');
  process.exit(1);
}

const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
for (const n of [1, 2, 3, 4]) {
  console.log(formatVarietyPackStepValidation(pipeline.steps[n].validation));
  if (!pipeline.steps[n].validation.ok) process.exit(1);
}

const plan = pipeline.plan;
if (!plan) {
  console.error('No shared-rail plan');
  process.exit(1);
}

const step3 = pipeline.steps[3].data;
const { bandAnalysis, ocrBand } = ctx;
const { pixels, analysisW, analysisH } = bandAnalysis;
const geometryBand = plan.band;
const bodyTop = plan.nutrientBodyTop;
const bodyBottom = bodyTop + plan.nutrientBodyHeight;
const headerTop = geometryBand.top;

if (Math.abs(ocrBand.top - geometryBand.top) > 2 || Math.abs(ocrBand.height - geometryBand.height) > 4) {
  console.warn(
    `band mismatch (geometry vs ocr inset): geometry top=${geometryBand.top} h=${geometryBand.height}, ocr top=${ocrBand.top} h=${ocrBand.height}`,
  );
}

/** @typedef {'consensus' | 'per_column'} ShapeSource */

function boxesForColumn(columnIndex, left, width, slices, zone, source) {
  return rowRegionBoxesFromSlices(columnIndex, left, width, slices, source, zone);
}

const consensusBodyBoxes = plan.valueColumns.flatMap((col, i) =>
  boxesForColumn(i, col.left, col.width, plan.rowBandSlices, 'body', 'consensus'),
);
const consensusHeaderBoxes = plan.valueColumns.flatMap((col, i) =>
  boxesForColumn(i, col.left, col.width, plan.headerConsensusRowBandSlices, 'header', 'consensus'),
);

const perColumnSets = [];
const perColumnBoxes = [];

for (let i = 0; i < plan.valueColumns.length; i += 1) {
  const colPlan = plan.valueColumns[i];
  if (!colPlan) continue;
  const bodySlices = plan.valueRowBandSlicesPerColumn[i] ?? [];
  const headerSlices = plan.headerRowBandSlicesPerColumn[i] ?? [];
  const seg = plan.valueColumnAnalysisSegments?.[i] ?? step3.valueColumns[i];
  const rulesImage = seg
    ? mapAnalysisRuleYsToImage(
        horizontalRuleRowYsInColumn(pixels, analysisW, analysisH, seg.x0, seg.x1),
        analysisH,
        geometryBand.top,
        geometryBand.height,
      )
    : [];
  const headerRules = rulesImage.filter((y) => y > headerTop && y < bodyTop);
  const bodyRules = rulesImage.filter((y) => y >= bodyTop && y < bodyBottom);
  const regions = [
    ...boxesForColumn(i, colPlan.left, colPlan.width, headerSlices, 'header', 'per_column'),
    ...boxesForColumn(i, colPlan.left, colPlan.width, bodySlices, 'body', 'per_column'),
  ];
  const glareMask = plan.valueColumnGlareMasks?.[i];
  const valueColumnIndex = valueColumnIndexForAnalysisSegment(seg, step3.valueColumns);
  perColumnSets.push({
    columnIndex: i,
    valueColumnIndex,
    headerSliceCount: headerSlices.length,
    bodySliceCount: bodySlices.length,
    ruleYsImage: rulesImage,
    headerRulesImageY: headerRules,
    bodyRulesImageY: bodyRules,
    glareCap: glareMask?.glareCap,
    glareUntrustedBandCount: glareMask?.untrusted?.filter(Boolean).length ?? 0,
    glareBrightFraction: glareMask?.brightFraction,
    regions,
  });
  perColumnBoxes.push(...regions);
}

const labelBodyBoxes = boxesForColumn(
  -1,
  plan.labelColumn.left,
  plan.labelColumn.width,
  plan.labelRowBandSlices,
  'body',
  'per_column',
);
const labelHeaderBoxes = boxesForColumn(
  -1,
  plan.labelColumn.left,
  plan.labelColumn.width,
  plan.headerLabelRowBandSlices,
  'header',
  'per_column',
);

const driftBody = perColumnSets.map((set) => ({
  zone: 'body',
  columnIndex: set.columnIndex,
  sliceCount: set.bodySliceCount,
  rows: rowRegionDriftSummary(
    plan.rowBandSlices,
    set.regions.filter((b) => b.zone === 'body'),
    set.columnIndex,
  ),
}));
const driftHeader = perColumnSets.map((set) => ({
  zone: 'header',
  columnIndex: set.columnIndex,
  sliceCount: set.headerSliceCount,
  rows: rowRegionDriftSummary(
    plan.headerConsensusRowBandSlices,
    set.regions.filter((b) => b.zone === 'header'),
    set.columnIndex,
  ),
}));

const meta = await sharp(bytes).rotate().metadata();
const fullW = meta.width ?? 1;
const fullH = meta.height ?? 1;
const uploadMeta = focusCropApplied
  ? await sharp(uploadBytes).rotate().metadata()
  : meta;
const labelBoundaryAnalysisX = step3.labelBoundaryX ?? 0;
const inkGridCtx = bandAnalysis.inkGridCropped
  ? { inkGridCropped: bandAnalysis.inkGridCropped, analysisW }
  : undefined;
const gridSpan = nutritionTableInkSpanAnalysisX(
  pixels,
  analysisW,
  analysisH,
  labelBoundaryAnalysisX,
  {},
  inkGridCtx,
);
const lastValueCol = plan.valueColumns[plan.valueColumns.length - 1];
const tableRightImage =
  lastValueCol !== undefined ? lastValueCol.left + lastValueCol.width : geometryBand.left + geometryBand.width;
const gridBoundsImage =
  inkGridCtx?.inkGridCropped
    ? {
        left: Math.min(plan.labelColumn.left, geometryBand.left),
        right: Math.min(
          tableRightImage,
          mapAnalysisXToImageBand(gridSpan.right, analysisW, geometryBand.left, geometryBand.width),
        ),
      }
    : {
        left: mapAnalysisXToImageBand(gridSpan.left, analysisW, geometryBand.left, geometryBand.width),
        right: mapAnalysisXToImageBand(gridSpan.right, analysisW, geometryBand.left, geometryBand.width),
      };
const gridLeftAnalysis = gridSpan.left;
const gridRightAnalysis = gridSpan.right;
const gridEnvelope = sharedLabelGridEnvelopeRect(
  geometryBand,
  plan.labelColumn,
  plan.valueColumns,
  fullW,
  DEFAULT_SHARED_LABEL_GRID_PARAMS.gridEnvelopeMarginImageFraction,
  gridBoundsImage,
  fullH,
);
/** Always preview through the envelope so outer ruled top/right borders stay visible (tight ink crop is for analysis only). */
const band = gridEnvelope;
const bandW = band.width;
const bandH = band.height;
const toBand = (box) => ({
  ...box,
  left: box.left - band.left,
  top: box.top - band.top,
  columnIndex: box.columnIndex,
});
const bodyTopBand = bodyTop - band.top;

const firstInteriorRuleYImage =
  plan.labelRowBandSlices.find((s) => s.top > bodyTop + plan.rowPitchPx * 0.35)?.top ??
  plan.rowBandSlices.find((s) => s.top > bodyTop + 8)?.top ??
  bodyTop + Math.round(plan.rowPitchPx * 2.5);

const glareGroundTruth = await loadGlareGroundTruthForImage(path.basename(imagePath), glareGroundTruthFixturesDir);
const glareGroundTruthTargets = [];
const glareGroundTruthMarkerBoxes = [];

if (glareGroundTruth) {
  const valueRulesImagePerColumn = perColumnSets.map((s) => s.bodyRulesImageY ?? []);
  for (let planIdx = 0; planIdx < plan.valueColumns.length; planIdx += 1) {
    const set = perColumnSets[planIdx];
    if (set?.valueColumnIndex == null) continue;
    const targets = resolveGlareGroundTruthRowTargets({
      groundTruth: glareGroundTruth,
      step3ValueColumns: step3.valueColumns,
      planStripColumnIndex: planIdx,
      valueColumnIndex: set.valueColumnIndex,
      headerSlices: plan.headerRowBandSlicesPerColumn[planIdx] ?? [],
      bodySlices: plan.valueRowBandSlicesPerColumn[planIdx] ?? [],
      bodyTopImage: bodyTop,
      firstInteriorRuleYImage,
      rowPitchPx: plan.rowPitchPx,
      valueRulesImagePerColumn,
    });
    glareGroundTruthTargets.push(...targets);
    const colStrip = plan.valueColumns[planIdx];
    if (!colStrip) continue;
    for (const target of targets) {
      const slice = rowBandSliceForGlareGroundTruthTarget(
        target,
        plan.rowBandSlices,
        plan.valueRowBandSlicesPerColumn[planIdx] ?? [],
        plan.headerRowBandSlicesPerColumn[planIdx] ?? [],
      );
      if (!slice) continue;
      const boxes = rowRegionBoxesFromSlices(
        planIdx,
        colStrip.left,
        colStrip.width,
        [slice],
        'per_column',
        target.zone,
      );
      const match = boxes[0];
      if (!match) continue;
      glareGroundTruthMarkerBoxes.push({
        ...match,
        highlightTopFraction: target.highlightTopFraction,
      });
    }
  }
}

const mapBoxes = (boxes) =>
  boxes
    .map(toBand)
    .map((b) => clipRowRegionBoxToRect(b, 0, 0, bandW, bandH))
    .filter((b) => b !== null);

/** SVG on grid-envelope coordinates (clipped to crop). */
const svgShapeParts = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${bandW}" height="${bandH}" viewBox="0 0 ${bandW} ${bandH}">`,
  `<defs><clipPath id="grid-crop"><rect x="0" y="0" width="${bandW}" height="${bandH}"/></clipPath></defs>`,
  `<g clip-path="url(#grid-crop)">`,
  `<rect x="${gridBoundsImage.left - band.left}" y="${geometryBand.top - band.top}" width="${gridBoundsImage.right - gridBoundsImage.left}" height="${geometryBand.height}" fill="none" stroke="#111" stroke-width="4" opacity="0.55"/>`,
  `<line x1="0" y1="${bodyTopBand}" x2="${bandW}" y2="${bodyTopBand}" stroke="#e040fb" stroke-width="3" stroke-dasharray="12 8"/>`,
];

if (plan.rowSurfaceMode === 'shared') {
  const consensusOutlineBoxes = [
    ...mapBoxes(
      plan.valueColumns.flatMap((col, i) =>
        boxesForColumn(i, col.left, col.width, plan.rowBandSlices, 'body', 'consensus'),
      ),
    ),
  ];
  for (const box of consensusOutlineBoxes) {
    svgShapeParts.push(
      svgRect(box, {
        fill: 'none',
        stroke: '#ff4081',
        strokeWidth: 2,
        dash: '6 5',
      }),
    );
  }
}

const vizBoxes = [
  ...mapBoxes(labelHeaderBoxes),
  ...mapBoxes(labelBodyBoxes),
  ...mapBoxes(perColumnBoxes.filter((b) => b.zone === 'header')),
  ...mapBoxes(perColumnBoxes.filter((b) => b.zone === 'body')),
];

for (const box of vizBoxes) {
  const style = vizStyleForBox(box);
  svgShapeParts.push(svgRowRegion(box, { ...style, dash: undefined }));
}

const columnLabelBandY = Math.max(8, geometryBand.top - band.top + 14);
const columnLabelDescriptors = [];
for (let planIdx = 0; planIdx < plan.valueColumns.length; planIdx += 1) {
  const colPlan = plan.valueColumns[planIdx];
  if (!colPlan) continue;
  const number = perColumnSets[planIdx]?.valueColumnIndex;
  if (number == null) continue;
  const centerX = colPlan.left + colPlan.width / 2 - band.left;
  svgShapeParts.push(svgColumnNumberLabel(centerX, columnLabelBandY, number, bandW));
  columnLabelDescriptors.push({
    valueColumnIndex: number,
    centerXFrac: centerX / bandW,
    bandYFrac: columnLabelBandY / bandH,
  });
}

for (const marker of mapBoxes(glareGroundTruthMarkerBoxes)) {
  svgShapeParts.push(svgGlareGroundTruthMarker(marker, marker.highlightTopFraction));
}

svgShapeParts.push('</g>', '</svg>');

const svgForFile = [
  ...svgShapeParts.slice(0, 2),
  `<image href="source-geometry-band.jpg" width="${bandW}" height="${bandH}" opacity="0.45"/>`,
  ...svgShapeParts.slice(2),
];

const cropDirs = [
  'crops/body/consensus',
  'crops/body/per-column',
  'crops/header/consensus',
  'crops/header/per-column',
  'crops/label/header',
  'crops/label/body',
];
for (const d of cropDirs) {
  await mkdir(path.join(outDir, d), { recursive: true });
}

const base = sharp(bytes).rotate();
const bandJpeg = await base
  .clone()
  .extract({ left: band.left, top: band.top, width: bandW, height: bandH })
  .jpeg({ quality: 92 })
  .toBuffer();
await writeFile(path.join(outDir, 'source-geometry-band.jpg'), bandJpeg);
const extractCrop = async (box, dest) => {
  const left = Math.max(0, Math.round(box.left));
  const top = Math.max(0, Math.round(box.top));
  const width = Math.min(Math.round(box.width), Math.max(1, fullW - left));
  const height = Math.min(Math.round(box.height), Math.max(1, fullH - top));
  if (width < 2 || height < 2) return;
  const buf = await base
    .clone()
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  await writeFile(dest, buf);
};

const writeBoxCrops = async (boxes, subdir, colPrefix) => {
  for (const box of boxes) {
    const planIdx = box.columnIndex;
    const vci =
      planIdx >= 0 ? perColumnSets[planIdx]?.valueColumnIndex ?? planIdx : null;
    const col =
      box.columnIndex < 0
        ? 'label'
        : `${colPrefix}${String(vci ?? planIdx).padStart(2, '0')}`;
    const tag = `row-${String(box.rowIndex).padStart(2, '0')}`;
    const aligned = rowBandSliceAxisAlignedBounds(box);
    await extractCrop({ ...box, top: aligned.top, height: aligned.height }, path.join(outDir, subdir, `${col}-${tag}.png`));
  }
};

await writeBoxCrops(consensusBodyBoxes, 'crops/body/consensus', 'col-');
await writeBoxCrops(perColumnBoxes.filter((b) => b.zone === 'body'), 'crops/body/per-column', 'col-');
await writeBoxCrops(consensusHeaderBoxes, 'crops/header/consensus', 'col-');
await writeBoxCrops(perColumnBoxes.filter((b) => b.zone === 'header'), 'crops/header/per-column', 'col-');
await writeBoxCrops(labelHeaderBoxes, 'crops/label/header', '');
await writeBoxCrops(labelBodyBoxes, 'crops/label/body', '');

await writeFile(path.join(outDir, 'source.jpg'), await base.jpeg({ quality: 92 }).toBuffer());
await writeFile(path.join(outDir, 'overlay.svg'), svgForFile.join('\n'));

const shapesSvgBuf = Buffer.from(svgShapeParts.join('\n'));
const overlayPng = await sharp(shapesSvgBuf).png().toBuffer();
let shapesOverlayJpeg = await sharp(bandJpeg)
  .composite([{ input: overlayPng, blend: 'over' }])
  .jpeg({ quality: 90 })
  .toBuffer();

shapesOverlayJpeg = await compositeColumnLabelBadges(
  shapesOverlayJpeg,
  columnLabelDescriptors,
  bandW,
  bandH,
);
await writeFile(path.join(outDir, 'shapes-overlay.jpg'), shapesOverlayJpeg);

const previewMaxW = 1400;
const previewScale = bandW > previewMaxW ? previewMaxW / bandW : 1;
const previewW = Math.round(bandW * previewScale);
const previewH = Math.round(bandH * previewScale);
let shapesPreviewJpeg =
  previewScale < 1
    ? await sharp(shapesOverlayJpeg).resize({ width: previewW, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
    : shapesOverlayJpeg;
shapesPreviewJpeg = await compositeColumnLabelBadges(
  shapesPreviewJpeg,
  columnLabelDescriptors,
  previewW,
  previewH,
);
await writeFile(path.join(outDir, 'shapes-preview.jpg'), shapesPreviewJpeg);

const previewCacheBust = Date.now();

const previewHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Shared label row shapes</title>
<style>
  body { margin: 0; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  main { max-width: 100vw; }
  .viz-photo { display: block; width: 100%; max-width: ${previewMaxW}px; height: auto; }
  aside { padding: 1rem 1.25rem; font-size: 0.95rem; line-height: 1.5; max-width: 52rem; }
  code { color: #9cf; }
  a { color: #8cf; }
</style></head><body>
<main>
  <img class="viz-photo" src="shapes-preview.jpg?v=${previewCacheBust}" alt="Row surfaces on geometry band (column numbers baked in)" width="${previewW}">
</main>
<aside>
  <p><strong>Legend</strong> — geometry-band photo with surfaces baked in (<a href="shapes-overlay.jpg">full res</a>, <a href="source-geometry-band.jpg">band only</a>)</p>
  <ul>
    <li>Magenta dashed line — header / nutrient <strong>body</strong> boundary</li>
    <li>Pink dashed rects — <strong>consensus</strong> row mesh (same tops in every column); solid fills — <code>${plan.rowSurfaceMode}</code> slices used for crops/OCR</li>
    <li><strong>Warm (orange/gold)</strong> cells — header zone; <strong>cool (blue)</strong> — body zone</li>
    <li><strong>Cyan border</strong> — shared label rail; <strong>blue</strong> — product value columns</li>
    <li>White-on-dark <strong>column numbers</strong> (value stack index; 0 bleeds into label and is omitted) — baked on the preview JPEG at readable size</li>
    <li>Orange dashed outline — human <strong>glare ground truth</strong> bands from matching <code>*GlareGroundTruth.json</code> fixture (row refs resolved via layout + slice geometry)</li>
    <li>Lighter vs darker fill — alternating rows; two blue hues — alternating columns</li>
    <li>Frame = grid envelope crop; detection mode=<code>${plan.rowSurfaceMode}</code></li>
  </ul>
  <p>Header slices (consensus <code>${plan.headerConsensusRowBandSlices.length}</code>, label <code>${plan.headerLabelRowBandSlices.length}</code>);
     body slices (consensus <code>${plan.rowBandSlices.length}</code>, label <code>${plan.labelRowBandSlices.length}</code>)</p>
  <p>Value cols on viz: [${perColumnSets.map((s) => (s.valueColumnIndex != null ? s.valueColumnIndex : '?')).join(', ')}] — ${perColumnSets.length} plan strips / ${step3.valueColumns.length} step-3 stacks</p>
  ${glareGroundTruth ? `<p>Glare ground truth: ${glareGroundTruthTargets.length} resolved row target(s) on columns [${[...new Set(glareGroundTruthTargets.map((t) => t.valueColumnIndex))].sort((a, b) => a - b).join(', ')}]</p>` : ''}
  <p>Per-column header: [${perColumnSets.map((s) => s.headerSliceCount).join(', ')}] · body: [${perColumnSets.map((s) => s.bodySliceCount).join(', ')}]</p>
</aside>
</body></html>`;
await writeFile(path.join(outDir, 'preview.html'), previewHtml);

const valueColumnWidthDiagnostics = valueColumnAnalysisBoundsWidthDiagnostics(
  plan.valueColumnAnalysisSegments ?? [],
  DEFAULT_SHARED_LABEL_GRID_PARAMS.valueColumnAnalysisBoundsMinToMedianWidthFraction,
);
const narrowValueColumns = valueColumnWidthDiagnostics.filter((d) => d.belowConfiguredMin);
if (narrowValueColumns.length > 0) {
  console.warn(
    `value column width vs median (min ${DEFAULT_SHARED_LABEL_GRID_PARAMS.valueColumnAnalysisBoundsMinToMedianWidthFraction}):`,
    narrowValueColumns.map((d) => `c${d.index} ${(d.widthToMedian * 100).toFixed(0)}%`).join(', '),
  );
}

const report = {
  imagePath,
  focusCropApplied,
  imageSize: { width: fullW, height: fullH },
  uploadSize: focusCropApplied
    ? { width: uploadMeta.width ?? fullW, height: uploadMeta.height ?? fullH }
    : undefined,
  geometryBand,
  gridEnvelope: band,
  gridBoundsImage,
  gridBoundsAnalysis: { left: gridLeftAnalysis, right: gridRightAnalysis },
  rowSurfaceMode: plan.rowSurfaceMode,
  headerTop,
  bodyTop,
  bodyBottom,
  shapeCounts: {
    headerConsensus: plan.headerConsensusRowBandSlices.length,
    headerLabel: plan.headerLabelRowBandSlices.length,
    headerPerColumn: perColumnSets.map((s) => s.headerSliceCount),
    bodyConsensus: plan.rowBandSlices.length,
    bodyLabel: plan.labelRowBandSlices.length,
    bodyPerColumn: perColumnSets.map((s) => s.bodySliceCount),
  },
  perColumn: perColumnSets,
  columnLabels: columnLabelDescriptors,
  valueColumnGlareMasks: plan.valueColumnGlareMasks ?? [],
  valueColumnAnalysisSegments: plan.valueColumnAnalysisSegments ?? [],
  valueColumnWidthDiagnostics,
  glareGroundTruth: glareGroundTruth
    ? {
        sourceImage: glareGroundTruth.sourceImage,
        caloriesKcalPerValueColumn: glareGroundTruth.caloriesKcalPerValueColumn,
        resolvedTargets: glareGroundTruthTargets,
      }
    : undefined,
  drift: { header: driftHeader, body: driftBody },
  slices: {
    headerConsensus: plan.headerConsensusRowBandSlices,
    headerLabel: plan.headerLabelRowBandSlices,
    labelBody: plan.labelRowBandSlices,
  },
  legend: {
    preview: 'Open preview.html in a browser',
    header: 'Ruled product stack above nutrient body (e.g. 4 bands / 6 text lines)',
    body: 'Nutrient table row surfaces',
  },
};
await writeFile(path.join(outDir, 'regions.json'), JSON.stringify(report, null, 2));

console.log('Wrote', outDir);
console.log('  preview.html / shapes-preview.jpg   — row shapes on photo (use this)');
console.log('  shapes-overlay.jpg — full resolution composite');
console.log('  overlay.svg, regions.json');
console.log(
  `\nHeader bands: consensus=${plan.headerConsensusRowBandSlices.length}, label=${plan.headerLabelRowBandSlices.length}, per-col [${perColumnSets.map((s) => s.headerSliceCount).join(', ')}]`,
);
console.log(
  `Body bands:   consensus=${plan.rowBandSlices.length}, label=${plan.labelRowBandSlices.length}, per-col [${perColumnSets.map((s) => s.bodySliceCount).join(', ')}], surfaceMode=${plan.rowSurfaceMode}`,
);
console.log(
  `Glare bands (untrusted/total per value col): [${perColumnSets
    .map(
      (s) =>
        `c${s.valueColumnIndex ?? s.columnIndex} ${s.glareUntrustedBandCount}/${plan.valueColumnGlareMasks?.[s.columnIndex]?.bandCount ?? '?'}`,
    )
    .join(', ')}]`,
);
if (glareGroundTruth) {
  console.log(`Glare ground truth (${glareGroundTruth.sourceImage}): ${glareGroundTruthTargets.length} row target(s) marked on preview`);
}