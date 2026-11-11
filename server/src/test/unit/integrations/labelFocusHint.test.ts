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

test(
  'ice cream photo reads as single subject in focus',
  { skip: !existsSync(path.join(localImagesDir, 'IMG_20261106_234207.jpg')) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, 'IMG_20261106_234207.jpg'));
    const focus = await inferDepthOfFieldHint(bytes);
    assert.equal(focus.singleSubjectInFocus, true);
    assert.ok(focus.sharpFocusWidthFraction < 0.52);
    assert.ok(focus.focusRegion);
    const width = (await sharp(bytes).rotate().metadata()).width ?? 0;
    assert.ok(shouldApplyFocusCrop(focus, width));
    assert.ok(focus.focusRegion!.width < 2_000);
  },
);

test(
  'costco variety pack reads as wide in-focus table',
  { skip: !existsSync(path.join(localImagesDir, 'IMG_20261105_211226.jpg')) },
  async () => {
    const bytes = await readFile(path.join(localImagesDir, 'IMG_20261105_211226.jpg'));
    const focus = await inferDepthOfFieldHint(bytes);
    const width = (await sharp(bytes).rotate().metadata()).width ?? 0;
    assert.equal(focus.singleSubjectInFocus, false);
    assert.ok(focus.sharpFocusWidthFraction > 0.6);
    assert.equal(shouldApplyFocusCrop(focus, width), false);
    assert.equal(focus.focusRegion, null);
  },
);
