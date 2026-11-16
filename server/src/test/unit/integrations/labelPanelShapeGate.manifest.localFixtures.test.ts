import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { TestImageManifest } from '../../../domain/testImageManifest.types.js';
import { inferLabelLayoutHint, resolveLabelProcessingImage } from '../../../integrations/imageLayoutHint.js';
import { resolveLabelOcrSources } from '../../../integrations/labelOcrSources.js';
import { assessNutritionFactsLabelShape } from '../../../integrations/nutritionFactsLabelShape.js';
import { shouldTryPortraitPanelCrop } from '../../../integrations/portraitLabelPanelCrop.js';
import { wideBandInkEnvelopeCropRect } from '../../../integrations/labelWideBandCropRect.js';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const imageDir = path.join(repoRoot, 'local', 'test-images');
const manifestPath = path.join(imageDir, 'manifest.json');
const tessCache = path.join(repoRoot, 'data', 'tesseract-cache');

test(
  'manifest panelShapeGate expectations match local test images',
  { skip: !existsSync(manifestPath) },
  async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as TestImageManifest;
    const failures: string[] = [];

    for (const fx of manifest.fixtures) {
      const spec = fx.panelShapeGate;
      if (!spec) {
        failures.push(`${fx.file}: missing panelShapeGate in manifest`);
        continue;
      }
      const imagePath = path.join(imageDir, fx.file);
      if (!existsSync(imagePath)) {
        failures.push(`${fx.file}: missing image file`);
        continue;
      }
      const bytes = await readFile(imagePath);
      const hint = await inferLabelLayoutHint(bytes);
      const tryPortrait = shouldTryPortraitPanelCrop(hint);
      if (tryPortrait !== spec.expectPortraitCropEligible) {
        failures.push(
          `${fx.file}: expectPortraitCropEligible ${spec.expectPortraitCropEligible}, got ${tryPortrait}`,
        );
      }

      const envelopeRect = await wideBandInkEnvelopeCropRect(bytes);
      let inkShapeOk = false;
      let rejectReasons: string[] = [];
      if (envelopeRect) {
        const cropPng = await sharp(bytes).rotate().extract(envelopeRect).png().toBuffer();
        const shape = await assessNutritionFactsLabelShape(cropPng);
        inkShapeOk = shape.looksLikePanel;
        rejectReasons = shape.reasons;
      }
      if (inkShapeOk !== spec.expectInkEnvelopeShapeOk) {
        failures.push(
          `${fx.file}: expectInkEnvelopeShapeOk ${spec.expectInkEnvelopeShapeOk}, got ${inkShapeOk} (${rejectReasons.join(', ')})`,
        );
      }
      if (!spec.expectInkEnvelopeShapeOk && spec.expectInkEnvelopeRejectSubstrings?.length) {
        const joined = rejectReasons.join(' ');
        for (const sub of spec.expectInkEnvelopeRejectSubstrings) {
          if (!joined.includes(sub)) {
            failures.push(`${fx.file}: expected ink reject substring "${sub}" in ${rejectReasons.join(', ')}`);
          }
        }
      }

      const resolved = await resolveLabelProcessingImage(bytes);
      const sources = await resolveLabelOcrSources(resolved, tessCache);
      if (sources.panelCrop.applied !== spec.expectGatedPanelCrop) {
        failures.push(
          `${fx.file}: expectGatedPanelCrop ${spec.expectGatedPanelCrop}, got ${sources.panelCrop.applied}`,
        );
      }
      if (spec.expectGatedStrategy && sources.panelCrop.strategy !== spec.expectGatedStrategy) {
        failures.push(
          `${fx.file}: expectGatedStrategy ${spec.expectGatedStrategy}, got ${sources.panelCrop.strategy ?? '—'}`,
        );
      }
    }

    assert.deepEqual(failures, []);
  },
);