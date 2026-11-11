import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { TestImageManifest } from '../../../domain/testImageManifest.types.js';
import { detectSplitSingleLabel } from '../../../integrations/splitSingleLabel.js';
import { inferLabelLayoutHint } from '../../../integrations/imageLayoutHint.js';
import {
  detectSharedLabelValueGrid,
  runVarietyPackGridPipeline,
} from '../../../integrations/varietyPackGridPipeline.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const imageDir = path.join(repoRoot, 'local', 'test-images');
const manifestPath = path.join(imageDir, 'manifest.json');

const hasManifest = existsSync(manifestPath);

test(
  'local test-images manifest matches variety pack pipeline ground truth',
  { skip: !hasManifest },
  async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as TestImageManifest;
    const failures: string[] = [];

    for (const fx of manifest.fixtures) {
      const imagePath = path.join(imageDir, fx.file);
      if (!existsSync(imagePath)) {
        failures.push(`${fx.file}: missing file`);
        continue;
      }
      const bytes = await readFile(imagePath);
      const hint = await inferLabelLayoutHint(bytes);
      const pipelineOpts = {
        maxColumns: 14,
        layoutHint: {
          singleSubjectInFocus: hint.singleSubjectInFocus,
          sharpPeakCount: hint.sharpPeakCount,
        },
      };
      const pipeline = await runVarietyPackGridPipeline(bytes, pipelineOpts);
      const plan = await detectSharedLabelValueGrid(bytes, pipelineOpts);
      const split = await detectSplitSingleLabel(bytes, hint);
      const vp = fx.varietyPackPipeline;

      if (vp?.expectFailStep && vp.expectFailCode) {
        const step = pipeline.steps[vp.expectFailStep];
        if (step?.validation.ok) {
          failures.push(`${fx.file}: expected step ${vp.expectFailStep} to fail`);
        } else if (step?.validation.code !== vp.expectFailCode) {
          failures.push(`${fx.file}: expected ${vp.expectFailCode}, got ${step?.validation.code}`);
        }
        continue;
      }

      if (vp?.expectLastOkStep != null && pipeline.lastOkStep < vp.expectLastOkStep) {
        failures.push(`${fx.file}: lastOkStep ${pipeline.lastOkStep} < ${vp.expectLastOkStep}`);
      }
      if (vp?.forbidLayout && pipeline.steps[3].data?.layout === vp.forbidLayout) {
        failures.push(`${fx.file}: step 3 layout must not be ${vp.forbidLayout}`);
      }
      if (fx.layout === 'split_single' && pipeline.steps[3].data?.layout !== 'split_single') {
        failures.push(`${fx.file}: expected step 3 layout split_single`);
      }
      if (vp?.expectSharedRailPlan === false && plan) {
        failures.push(`${fx.file}: unexpected shared-rail plan (${plan.valueColumns.length} cols)`);
      }
      if (vp?.minValueColumns != null && (!plan || plan.valueColumns.length < vp.minValueColumns)) {
        failures.push(
          `${fx.file}: expected >= ${vp.minValueColumns} value columns, got ${plan?.valueColumns.length ?? 0}`,
        );
      }
      if (fx.splitSingleLabel?.expectDetect && !split) {
        failures.push(`${fx.file}: expected detectSplitSingleLabel`);
      }
    }

    assert.equal(failures.length, 0, failures.join('\n'));
  },
);
