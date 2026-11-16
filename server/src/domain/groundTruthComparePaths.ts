import path from 'node:path';

/** Gitignored host output (photos, large diagnostics). */
export function groundTruthCompareHtmlDirGitignored(repoRoot: string): string {
  return path.join(repoRoot, 'local/diagnostics/ground-truth-compare');
}

/** Visible under `server/` so IDE and browser can open reports (`local/` is gitignored). */
export function groundTruthCompareHtmlDirWorkspace(repoRoot: string): string {
  return path.join(repoRoot, 'server/diagnostics/ground-truth-compare');
}

export function groundTruthCompareHtmlDirs(repoRoot: string): string[] {
  return [
    groundTruthCompareHtmlDirGitignored(repoRoot),
    groundTruthCompareHtmlDirWorkspace(repoRoot),
  ];
}