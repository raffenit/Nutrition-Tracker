import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPortraitSingleOcrHint,
  portraitSingleOcrEnabled,
  PORTRAIT_SINGLE_OCR_TARGET_WIDTH,
  PORTRAIT_SINGLE_TESS_VARIANT_CAP,
} from '../../../domain/portraitSingleOcrParams.js';

describe('portraitSingleOcrParams', () => {
  it('enables portrait-single on tall non-wide hints', () => {
    assert.equal(isPortraitSingleOcrHint({ widePanel: false, width: 400, height: 900 }), true);
    assert.equal(isPortraitSingleOcrHint({ widePanel: false, width: 900, height: 400 }), false);
    assert.equal(isPortraitSingleOcrHint({ widePanel: true, width: 400, height: 900 }), false);
  });

  it('exposes sane caps for portrait single OCR', () => {
    assert.ok(PORTRAIT_SINGLE_OCR_TARGET_WIDTH < 2200);
    assert.ok(PORTRAIT_SINGLE_TESS_VARIANT_CAP >= 3 && PORTRAIT_SINGLE_TESS_VARIANT_CAP <= 8);
  });

  it('honours OCR_PORTRAIT_SINGLE=0 kill switch', () => {
    assert.equal(portraitSingleOcrEnabled({}), true);
    assert.equal(portraitSingleOcrEnabled({ OCR_PORTRAIT_SINGLE: '0' }), false);
  });
});
