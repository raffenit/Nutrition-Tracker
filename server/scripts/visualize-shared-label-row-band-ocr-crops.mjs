/**
 * Export row-band OCR crops (same slices as extractSharedLabelColumnPngsByRowBands).
 * Usage: npm run build && node scripts/visualize-shared-label-row-band-ocr-crops.mjs [jpg]
 * Writes: local/diagnostics/row-band-ocr-crops/
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVarietyPackGridPipeline } from '../dist/integrations/varietyPackGridPipeline.js';
import {
  extractSharedLabelColumnPngsByRowBands,
  rowBandMinExtractSize,
  useRowBandSliceOcrForPlan,
} from '../dist/integrations/sharedLabelValueGrid.js';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultImage = path.join(repoRoot, 'local/test-images/costco-candy.jpg');
const imagePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultImage;
const outDir = path.join(repoRoot, 'local/diagnostics/row-band-ocr-crops');

const bytes = await readFile(imagePath);
const pipeline = await runVarietyPackGridPipeline(bytes, { maxColumns: 14 });
if (pipeline.lastOkStep < 4 || !pipeline.plan) {
  console.error('Pipeline did not reach step 4 shared-rail plan');
  process.exit(1);
}
const plan = pipeline.plan;
const meta = await sharp(bytes).rotate().metadata();
const fullW = meta.width ?? 0;
const minSize = rowBandMinExtractSize(plan, plan.labelColumn.width, fullW);

await mkdir(outDir, { recursive: true });

const rowBandOcr = useRowBandSliceOcrForPlan(plan);
const manifest = {
  sourceImage: path.basename(imagePath),
  rowBandOcr,
  rowSurfaceMode: plan.rowSurfaceMode,
  valueColumnCount: plan.valueColumns.length,
  rowPitchPx: plan.rowPitchPx,
  columns: [],
};

async function writeColumnCrops(name, column, slices) {
  const sub = path.join(outDir, name);
  await mkdir(sub, { recursive: true });
  const pngs = await extractSharedLabelColumnPngsByRowBands(bytes, column, slices, minSize);
  const rows = [];
  for (let i = 0; i < pngs.length; i += 1) {
    const file = `row-${String(i).padStart(2, '0')}.png`;
    await writeFile(path.join(sub, file), pngs[i]);
    const s = slices[i];
    rows.push({
      rowIndex: i,
      file,
      top: s?.top,
      height: s?.height,
      topSkewPx: s?.topSkewPx ?? 0,
      bottomSkewPx: s?.bottomSkewPx ?? 0,
    });
  }
  return { name, sliceCount: pngs.length, rows };
}

manifest.columns.push(
  await writeColumnCrops('label', plan.labelColumn, plan.labelRowBandSlices ?? plan.rowBandSlices),
);
for (let c = 0; c < plan.valueColumns.length; c += 1) {
  const slices =
    plan.valueRowBandSlicesPerColumn?.[c]?.length
      ? plan.valueRowBandSlicesPerColumn[c]
      : plan.rowBandSlices;
  manifest.columns.push(await writeColumnCrops(`value-col-${String(c + 1).padStart(2, '0')}`, plan.valueColumns[c], slices));
}

await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const colsHtml = manifest.columns
  .map(
    (col) => `<section><h2>${col.name} (${col.sliceCount} rows)</h2><div class="grid">${col.rows
      .map((r) => `<figure><img src="${col.name}/${r.file}" alt="row ${r.rowIndex}"/><figcaption>r${r.rowIndex} h=${r.height?.toFixed?.(1) ?? r.height}</figcaption></figure>`)
      .join('')}</div></section>`,
  )
  .join('\n');

const previewHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Row-band OCR crops</title>
<style>
  body { margin: 0; background: #111; color: #eee; font-family: system-ui, sans-serif; padding: 1rem; }
  h1 { font-size: 1.1rem; font-weight: 600; }
  h2 { font-size: 1rem; margin: 1.5rem 0 0.5rem; color: #9cf; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.5rem; }
  figure { margin: 0; }
  img { width: 100%; height: auto; background: #222; border: 1px solid #333; }
  figcaption { font-size: 0.75rem; color: #aaa; }
  code { color: #9cf; }
</style></head><body>
<h1>Row-band OCR crops — ${manifest.sourceImage}</h1>
<p>rowOcr=${rowBandOcr}, mode=<code>${plan.rowSurfaceMode}</code>, pitch=${plan.rowPitchPx}px</p>
${colsHtml}
</body></html>`;
await writeFile(path.join(outDir, 'preview.html'), previewHtml);

console.log('wrote', outDir);
console.log('open', path.join(outDir, 'preview.html'));