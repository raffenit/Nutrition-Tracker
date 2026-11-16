/**
 * @deprecated Use compare-label-nutrient-ground-truth.mjs (same CLI).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'compare-label-nutrient-ground-truth.mjs');
const r = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);