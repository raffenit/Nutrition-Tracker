import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  retainNutrientRowRuleRuns,
  sectionDividerBoundaryYsFromRuns,
  splitHeaderBodyFromRuleInkRuns,
  type HorizontalRuleInkRun,
} from '../../../integrations/ruledTableGridDetect.js';

test('splitHeaderBodyFromRuleInkRuns places body below thick header section rules', () => {
  const runs: HorizontalRuleInkRun[] = [
    { startY: 20, endY: 24, thickness: 5, peakY: 22, boundaryY: 28, peakFraction: 0.9 },
    { startY: 55, endY: 60, thickness: 6, peakY: 58, boundaryY: 66, peakFraction: 0.92 },
    { startY: 90, endY: 91, thickness: 2, peakY: 90, boundaryY: 93, peakFraction: 0.88 },
    { startY: 120, endY: 121, thickness: 2, peakY: 120, boundaryY: 123, peakFraction: 0.9 },
  ];
  const split = splitHeaderBodyFromRuleInkRuns(runs, 400);
  assert.ok(split.bodyTopY >= 58);
  assert.ok(split.bodyBoundaryYs.length >= 2);
  assert.ok(split.bodyBoundaryYs.every((y) => y >= split.bodyTopY));
});

test('retainNutrientRowRuleRuns drops body ink thicker than half row pitch', () => {
  const runs: HorizontalRuleInkRun[] = [
    { startY: 50, endY: 50, thickness: 1, peakY: 50, boundaryY: 52, peakFraction: 0.9 },
    { startY: 90, endY: 90, thickness: 1, peakY: 90, boundaryY: 92, peakFraction: 0.9 },
    { startY: 130, endY: 152, thickness: 23, peakY: 141, boundaryY: 155, peakFraction: 0.92 },
    { startY: 172, endY: 172, thickness: 1, peakY: 172, boundaryY: 174, peakFraction: 0.88 },
  ];
  const kept = retainNutrientRowRuleRuns(runs);
  assert.ok(!kept.some((r) => r.startY === 130));
  assert.equal(kept.length, 3);
});

test('sectionDividerBoundaryYsFromRuns marks thick solid bars below body top', () => {
  const runs: HorizontalRuleInkRun[] = [
    { startY: 40, endY: 40, thickness: 1, peakY: 40, boundaryY: 42, peakFraction: 0.86 },
    { startY: 82, endY: 82, thickness: 1, peakY: 82, boundaryY: 84, peakFraction: 0.9 },
    { startY: 124, endY: 168, thickness: 45, peakY: 146, boundaryY: 172, peakFraction: 0.91 },
    { startY: 200, endY: 200, thickness: 1, peakY: 200, boundaryY: 202, peakFraction: 0.87 },
  ];
  const dividers = sectionDividerBoundaryYsFromRuns(runs, 30);
  assert.deepEqual(dividers, [172]);
  const split = splitHeaderBodyFromRuleInkRuns(runs, 200);
  assert.ok(!split.bodyBoundaryYs.includes(94));
});