import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trimTrailingIrregularValueColumns } from '../../../integrations/uniformColumnGeometry.js';

test('trimTrailingIrregularValueColumns drops unruled wide trailing strip', () => {
  const segments = [
    { x0: 0, x1: 40 },
    { x0: 40, x1: 80 },
    { x0: 80, x1: 160 },
  ];
  const meta = [{ horizontalRuleCount: 10 }, { horizontalRuleCount: 12 }, { horizontalRuleCount: 0 }];
  const { segments: out } = trimTrailingIrregularValueColumns(segments, meta);
  assert.equal(out.length, 2);
  assert.equal(out[1]!.x1, 80);
});