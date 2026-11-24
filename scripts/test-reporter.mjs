// Custom `node --test` reporter: one colored line per test file instead of
// the TAP/spec wall of text, with failure details collected under each file.
// Emits TAP-style `# tests/pass/fail/skipped` lines at the end so
// scripts/run-tests*.sh summaries keep working.
//
// Wired via: node --test --test-reporter=../scripts/test-reporter.mjs <files>

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const c = {
  green: useColor ? '\x1b[32m' : '',
  red: useColor ? '\x1b[31m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  dim: useColor ? '\x1b[2m' : '',
  bold: useColor ? '\x1b[1m' : '',
  reset: useColor ? '\x1b[0m' : '',
};

const check = `${c.green}✔${c.reset}`;
const cross = `${c.red}✖${c.reset}`;

function shortFile(file) {
  if (typeof file !== 'string') return 'unknown';
  const marker = 'dist-test/';
  const idx = file.indexOf(marker);
  return idx >= 0 ? file.slice(idx + marker.length) : file;
}

function errorText(details) {
  const err = details?.error;
  if (!err) return '';
  const message = typeof err === 'string' ? err : (err.message ?? String(err));
  const stack = typeof err === 'object' && typeof err.stack === 'string' ? err.stack : '';
  const frames = stack
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, 4);
  return [message, ...frames].join('\n');
}

const failuresByFile = new Map(); // file -> [{ name, text }]

export default async function* reporter(source) {
  for await (const ev of source) {
    const data = ev.data ?? {};
    switch (ev.type) {
      case 'test:fail': {
        const file = data.file ?? '';
        if (!failuresByFile.has(file)) failuresByFile.set(file, []);
        failuresByFile.get(file).push({ name: data.name ?? '(unnamed)', text: errorText(data.details) });
        break;
      }
      case 'test:summary': {
        if (data.file) {
          // Per-file summary — the live progress line.
          const counts = data.counts ?? {};
          const failed = counts.failed ?? 0;
          const skipped = counts.skipped ?? 0;
          const parts = [`${counts.tests ?? 0} tests`];
          if (skipped > 0) parts.push(`${skipped} skipped`);
          parts.push(`${((data.duration_ms ?? 0) / 1000).toFixed(1)}s`);
          const mark = failed > 0 ? cross : check;
          const color = failed > 0 ? c.red : c.green;
          console.log(`${color}${mark} ${shortFile(data.file)}${c.reset} ${c.dim}— ${parts.join(' · ')}${c.reset}`);
          for (const failure of failuresByFile.get(data.file) ?? []) {
            console.log(`  ${c.red}✗ ${failure.name}${c.reset}`);
            for (const line of failure.text.split('\n')) {
              console.log(`    ${c.dim}${line}${c.reset}`);
            }
          }
          failuresByFile.delete(data.file);
        } else {
          // Final overall summary — TAP-compatible counts for run-tests*.sh.
          const counts = data.counts ?? {};
          console.log(`# tests ${counts.tests ?? 0}`);
          console.log(`# pass ${counts.passed ?? 0}`);
          console.log(`# fail ${counts.failed ?? 0}`);
          console.log(`# cancelled ${counts.cancelled ?? 0}`);
          console.log(`# skipped ${counts.skipped ?? 0}`);
          console.log(`# todo ${counts.todo ?? 0}`);
          const failed = counts.failed ?? 0;
          const line = `Tests: ${counts.passed ?? 0} passed, ${failed} failed, ${counts.skipped ?? 0} skipped (${((data.duration_ms ?? 0) / 1000).toFixed(1)}s)`;
          console.log(failed > 0 ? `${c.red}${c.bold}${line}${c.reset}` : `${c.green}${c.bold}${line}${c.reset}`);
        }
        break;
      }
      case 'test:stdout':
      case 'test:stderr':
        for (const line of String(data.message ?? '').split('\n')) {
          if (line) console.log(`${c.dim}  │ ${line}${c.reset}`);
        }
        break;
      case 'test:diagnostic':
        if (data.message) console.log(`${c.dim}  ${data.message}${c.reset}`);
        break;
      default:
        break;
    }
  }
}
