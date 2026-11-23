import assert from 'node:assert/strict';
import test from 'node:test';
import { fitColumnSlicesToLocalRules } from '../../../domain/sharedLabelRowRegions.js';

const slicesFromTops = (tops: number[], bottom: number) =>
  tops.map((top, rowIndex) => ({ rowIndex, top, height: (tops[rowIndex + 1] ?? bottom) - top }));

test('fitted column rows keep the bottom anchor when rules crowd the table edge', () => {
  const mesh = slicesFromTops([100, 140, 180, 220, 260, 300], 330);
  const fitted = fitColumnSlicesToLocalRules(mesh, [150, 190, 230, 270, 328], 8, 40);
  const last = fitted[fitted.length - 1]!;
  assert.equal(last.top + last.height, 330);
  assert.equal(fitted[0]!.top, 100);
  for (let i = 1; i < fitted.length; i += 1) assert.ok(fitted[i]!.top > fitted[i - 1]!.top);
});
