import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inferLabelLayoutHint } from '../../../integrations/imageLayoutHint.js';
import {
  applyGatedPortraitPanelCrop,
  shouldTryPortraitPanelCrop,
} from '../../../integrations/portraitLabelPanelCrop.js';
import { LOCAL_SINGLE_PANEL_JPG } from '../../fixtures/localTestImageNames.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const tessCache = path.join(repoRoot, 'data', 'tesseract-cache');
const imagePath = path.join(repoRoot, 'local', 'test-images', LOCAL_SINGLE_PANEL_JPG);

test(
  'gated portrait crop keeps full Nutrition Facts on protein-shake',
  { skip: !existsSync(imagePath) },
  async () => {
    const bytes = await readFile(imagePath);
    const hint = await inferLabelLayoutHint(bytes);
    assert.ok(shouldTryPortraitPanelCrop(hint));
    const result = await applyGatedPortraitPanelCrop(bytes, tessCache, hint);
    assert.equal(result.applied, true);
    assert.ok(result.strategy === 'ink_envelope' || result.strategy === 'center_band');
    assert.ok(result.shape?.looksLikePanel);
  },
);