import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { groundTruthCompareHtmlDirs } from './groundTruthComparePaths.js';

export async function writeGroundTruthCompareHtmlFiles(
  repoRoot: string,
  imageBasename: string,
  html: string,
): Promise<string> {
  const base = imageBasename.replace(/\.[a-z]+$/i, '') + '.html';
  let primaryPath = '';
  for (const dir of groundTruthCompareHtmlDirs(repoRoot)) {
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, base);
    await writeFile(filePath, html, 'utf8');
    primaryPath = filePath;
  }
  return primaryPath;
}

export type OcrPerformanceReportIndexEntry = {
  fileName: string;
  runtimeSeconds?: number;
  percentOk?: number;
};

export async function writeGroundTruthCompareIndex(
  repoRoot: string,
  entries: string[] | OcrPerformanceReportIndexEntry[],
): Promise<void> {
  const normalized: OcrPerformanceReportIndexEntry[] = entries.map((entry) =>
    typeof entry === 'string' ? { fileName: entry } : entry,
  );

  const links = normalized
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
    .map((entry) => {
      const label = entry.fileName.replace(/\.html$/i, '');
      const bits: string[] = [];
      if (entry.runtimeSeconds != null && Number.isFinite(entry.runtimeSeconds)) {
        bits.push(`${entry.runtimeSeconds.toFixed(1)}s`);
      }
      if (entry.percentOk != null && Number.isFinite(entry.percentOk)) {
        bits.push(`${entry.percentOk}% ok`);
      }
      const detail = bits.length ? ` <span style="color:#a8a8a8">(${bits.join(' · ')})</span>` : '';
      return `<li><a href="./${entry.fileName}">${label}</a>${detail}</li>`;
    })
    .join('\n');
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="color-scheme" content="dark" />
  <title>OCR Performance Reports — local test images</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #121212; color: #e8e8e8; margin: 1.5rem; }
    a { color: #90caf9; }
  </style>
</head>
<body>
  <h1>OCR Performance Reports</h1>
  <p>Nutrient compare vs fixtures (green / yellow / red). Regenerate: <code>npm --prefix server run ocr:local-test-images</code></p>
  <ul>
${links}
  </ul>
</body>
</html>`;

  for (const dir of groundTruthCompareHtmlDirs(repoRoot)) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), indexHtml, 'utf8');
  }
}