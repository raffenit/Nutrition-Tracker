import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendImportJobDebug,
  beginImportJob,
  clearImportJobsForTest,
  finishImportJob,
  getImportJobForUser,
  isImportJobId,
  reportImportJobStep,
  runWithImportJob,
} from '../../../import/importJobProgress.js';

test('import job reports steps and finishes for image flow', async () => {
  clearImportJobsForTest();
  const id = '11111111-1111-4111-8111-111111111111';
  assert.ok(isImportJobId(id));
  await runWithImportJob(id, 'user-1', 'image', async () => {
    reportImportJobStep('OCR', 'Reading label…', 'Tesseract');
    finishImportJob(id);
  });
  const snapshot = getImportJobForUser(id, 'user-1');
  assert.ok(snapshot);
  assert.equal(snapshot?.done, true);
  assert.equal(snapshot?.flow, 'image');
  assert.ok(snapshot?.steps.some((step) => step.short === 'OCR' && step.status === 'done'));
});

test('import job collects debug log lines during OCR', async () => {
  clearImportJobsForTest();
  const id = '33333333-3333-4333-8333-333333333333';
  await runWithImportJob(id, 'user-1', 'image', async () => {
    appendImportJobDebug('tesseract native: Image too small to scale');
    appendImportJobDebug('column-strip: stitch OK — 3 products');
    finishImportJob(id);
  });
  const snapshot = getImportJobForUser(id, 'user-1');
  assert.equal(snapshot?.debugLog.length, 2);
  assert.match(snapshot?.debugLog[0] ?? '', /too small/i);
});

test('import job telegraphs humanized activity to UI poll snapshot', async () => {
  clearImportJobsForTest();
  const id = '44444444-4444-4444-8444-444444444444';
  await runWithImportJob(id, 'user-1', 'image', async () => {
    reportImportJobStep('OCR', 'Reading shared label table…', 'Starting…');
    appendImportJobDebug('geometry: shared-rail plan (10 value cols) — skip full-page OCR');
    appendImportJobDebug('shared-label grid value 2/10');
    finishImportJob(id);
  });
  const snapshot = getImportJobForUser(id, 'user-1');
  assert.ok(snapshot?.activityLog.length);
  assert.ok(snapshot?.activityLog.some((l) => /shared label table/i.test(l)));
  assert.ok(snapshot?.activityLog.some((l) => /product column 2 of 10/i.test(l)));
});

test('import job is isolated per user', () => {
  clearImportJobsForTest();
  const id = '22222222-2222-4222-8222-222222222222';
  beginImportJob(id, 'owner', 'url');
  assert.equal(getImportJobForUser(id, 'other'), null);
  assert.ok(getImportJobForUser(id, 'owner'));
});
