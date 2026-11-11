import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inferDepthOfFieldHint, shouldApplyFocusCrop } from '../../../integrations/labelFocusHint.js';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const localImagesDir = path.join(repoRoot, 'local', 'test-images');

const FIXTURES = {
  portrait: 'IMG_20261022_120045.jpg',
  varietyPack: 'IMG_20261105_211226.jpg',
  incidentalBlur: 'IMG_20261106_234207.jpg',
} as const;

async function fullWidth(bytes: Buffer): Promise<number> {
  const meta = await sharp(bytes).rotate().metadata();
  return meta.width ?? 0;
}

test(
  'local focus fixture matrix: incidental blur crops, variety pack does not',
  { skip: !existsSync(path.join(localImagesDir, FIXTURES.incidentalBlur)) },
  async () => {
    for (const [label, file] of Object.entries(FIXTURES)) {
      const filePath = path.join(localImagesDir, file);
      if (!existsSync(filePath)) continue;
      const bytes = await readFile(filePath);
      const focus = await inferDepthOfFieldHint(bytes);
      const width = await fullWidth(bytes);
      const apply = shouldApplyFocusCrop(focus, width);

      if (label === 'incidentalBlur') {
        assert.equal(focus.singleSubjectInFocus, true);
        assert.ok(focus.sharpFocusWidthFraction < 0.52);
        assert.ok(apply, 'expected focus crop on incidental blur photo');
        assert.ok(focus.focusRegion);
      } else if (label === 'varietyPack') {
        assert.equal(focus.singleSubjectInFocus, false);
        assert.ok(focus.sharpFocusWidthFraction > 0.6);
        assert.equal(apply, false, 'variety pack should keep full width');
        assert.equal(focus.focusRegion, null);
      } else if (label === 'portrait') {
        assert.equal(apply, false, 'portrait single label should not crop');
      }
    }
  },
);
