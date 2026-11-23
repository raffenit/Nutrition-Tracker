import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { resolveLabelProcessingImage } from '../../../integrations/imageLayoutHint.js';
import { resolveLabelOcrSources } from '../../../integrations/labelOcrSources.js';
import {
  LOCAL_SHARED_LABEL_MULTI_VALUE_JPG,
  LOCAL_SINGLE_PANEL_JPG,
} from '../../fixtures/localTestImageNames.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const tessCache = path.join(repoRoot, 'data', 'tesseract-cache');
const imagesDir = path.join(repoRoot, 'local', 'test-images');

test(
  'resolveLabelOcrSources: portrait uses panel bytes, wide keeps geometry',
  { skip: !existsSync(path.join(imagesDir, LOCAL_SINGLE_PANEL_JPG)) && 'missing local/test-images photo fixture (host-specific, gitignored)' },
  async () => {
    const portrait = await readFile(path.join(imagesDir, LOCAL_SINGLE_PANEL_JPG));
    const resolvedP = await resolveLabelProcessingImage(portrait);
    const srcP = await resolveLabelOcrSources(resolvedP, tessCache);
    assert.equal(srcP.geometryBytes.length, resolvedP.bytes.length);
    assert.ok(srcP.panelCrop.applied);
    assert.notEqual(srcP.pageOcrBytes.length, srcP.geometryBytes.length);
    assert.ok(srcP.hint.height < resolvedP.hint.height);

    if (!existsSync(path.join(imagesDir, LOCAL_SHARED_LABEL_MULTI_VALUE_JPG))) return;
    const wide = await readFile(path.join(imagesDir, LOCAL_SHARED_LABEL_MULTI_VALUE_JPG));
    const resolvedW = await resolveLabelProcessingImage(wide);
    const srcW = await resolveLabelOcrSources(resolvedW, tessCache);
    assert.equal(srcW.panelCrop.applied, false);
    assert.equal(srcW.pageOcrBytes, srcW.geometryBytes);
  },
);