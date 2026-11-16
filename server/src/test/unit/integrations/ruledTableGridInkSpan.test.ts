import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  sectionDividerBoundaryYsFromRuns,
  type HorizontalRuleInkRun,
} from '../../../integrations/ruledTableGridDetect.js';

test('sectionDividerBoundaryYsFromRuns ignores thick low-peak glyph runs', () => {
  const runs: HorizontalRuleInkRun[] = [
    { startY: 40, endY: 40, thickness: 1, peakY: 40, boundaryY: 42, peakFraction: 0.86 },
    { startY: 82, endY: 82, thickness: 1, peakY: 82, boundaryY: 84, peakFraction: 0.9 },
    { startY: 110, endY: 133, thickness: 24, peakY: 121, boundaryY: 136, peakFraction: 0.22 },
    { startY: 124, endY: 168, thickness: 45, peakY: 146, boundaryY: 172, peakFraction: 0.91 },
    { startY: 200, endY: 200, thickness: 1, peakY: 200, boundaryY: 202, peakFraction: 0.87 },
  ];
  const dividers = sectionDividerBoundaryYsFromRuns(runs, 30);
  assert.deepEqual(dividers, [172]);
  assert.ok(!dividers.includes(136));
});