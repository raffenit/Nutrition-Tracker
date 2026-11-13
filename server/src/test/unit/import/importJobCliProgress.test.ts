import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatImportJobSnapshotBlock } from '../../../import/importJobCliProgress.js';
import {
  clearImportJobsForTest,
  getImportJobForUser,
  reportImportJobStep,
  runWithImportJob,
} from '../../../import/importJobProgress.js';

test('formatImportJobSnapshotBlock matches import job steps', async () => {
  clearImportJobsForTest();
  const id = '00000000-0000-4000-8000-000000000001';
  await runWithImportJob(id, 'u1', 'image', async () => {
    reportImportJobStep('OCR', 'Reading shared label table…', 'Label column + 3 value columns.');
    const snapshot = getImportJobForUser(id, 'u1');
    assert.ok(snapshot);
    const block = formatImportJobSnapshotBlock(snapshot!);
    assert.match(block, /Reading shared label table/);
    assert.match(block, /Label column \+ 3 value columns/);
    assert.match(block, /→ OCR/);
  });
});
