import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION,
  FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION,
  MULTI_COLUMN_FOCUS_MIN_PEAKS,
} from '../../../domain/labelFocusParams.js';
import { shouldApplyFocusCrop } from '../../../integrations/labelFocusHint.js';

test('shouldApplyFocusCrop rejects near-full variety-pack sharpness', () => {
  const region = { left: 100, top: 0, width: 2800, height: 900 };
  assert.equal(
    shouldApplyFocusCrop(
      {
        sharpFocusWidthFraction: 0.88,
        sharpPeakCount: MULTI_COLUMN_FOCUS_MIN_PEAKS,
        singleSubjectInFocus: false,
        focusRegion: region,
      },
      3200,
    ),
    false,
  );
});

test('shouldApplyFocusCrop accepts incidental blur with few peaks', () => {
  const region = { left: 400, top: 0, width: 1100, height: 1200 };
  assert.equal(
    shouldApplyFocusCrop(
      {
        sharpFocusWidthFraction: 0.35,
        sharpPeakCount: 6,
        singleSubjectInFocus: true,
        focusRegion: region,
      },
      3000,
    ),
    true,
  );
});

test('shouldApplyFocusCrop refuses over-aggressive crop', () => {
  const region = { left: 0, top: 0, width: 200, height: 800 };
  assert.equal(
    shouldApplyFocusCrop(
      {
        sharpFocusWidthFraction: 0.2,
        sharpPeakCount: 2,
        singleSubjectInFocus: true,
        focusRegion: region,
      },
      2000,
    ),
    false,
  );
  assert.ok(200 / 2000 < FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION);
});

test('focus crop tunables are ratio-based not photo-specific', () => {
  assert.ok(FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION > 0.8 && FOCUS_CROP_MAX_SHARP_WIDTH_FRACTION < 1);
  assert.ok(FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION > 0.1 && FOCUS_CROP_MIN_RETAINED_WIDTH_FRACTION < 0.35);
  assert.ok(MULTI_COLUMN_FOCUS_MIN_PEAKS >= 10);
});
