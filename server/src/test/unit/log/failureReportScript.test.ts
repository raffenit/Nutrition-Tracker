import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/** Walk up from the compiled test to the repo root (dist-test layout differs from src). */
function findHelper(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'scripts', 'lib-failure-report.sh');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('scripts/lib-failure-report.sh not found');
}

const HELPER = findHelper();

function runBash(body: string): { status: number | null; stdout: string; stderr: string } {
  const script = `set -euo pipefail\nFAILURE_REPORT_NAME=DEPLOY\nsource ${JSON.stringify(HELPER)}\n${body}\n`;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('failure report stays quiet on success', () => {
  const run = runBash('failure_report_step "[3/6] Building"\necho ok');
  assert.equal(run.status, 0);
  assert.doesNotMatch(run.stderr, /FAILED/);
});

test('failure report names the step and command when set -e aborts inside a function', () => {
  const run = runBash('build() { false; echo after; }\nfailure_report_step "[3/6] Building"\nbuild');
  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stdout, /after/);
  assert.match(run.stderr, /DEPLOY FAILED \(exit 1\)/);
  assert.match(run.stderr, /Step: +\[3\/6\] Building/);
  assert.match(run.stderr, /Command: +false/);
});

test('failure report fires on a no-match grep in a summary (the silent PR #6 regression)', () => {
  const run = runBash(`failure_report_step "Summary"\nx="$(grep -oE '^# skipped [0-9]+' /dev/null | tail -1)"\necho never`);
  assert.equal(run.status, 1);
  assert.doesNotMatch(run.stdout, /never/);
  assert.match(run.stderr, /Step: +Summary/);
  assert.match(run.stderr, /grep -oE/);
});

test('failure report fires on an explicit exit after the script printed its own error', () => {
  const run = runBash('failure_report_step "[5/6] Health check..."\necho "API health: not ready"\nexit 3');
  assert.equal(run.status, 3);
  assert.match(run.stderr, /DEPLOY FAILED \(exit 3\)/);
  assert.match(run.stderr, /Health check/);
});
