import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveCenterBandCropFractions } from '../../../domain/labelImageCropPolicy.js';
import { shouldTryPortraitPanelCrop } from '../../../integrations/portraitLabelPanelCrop.js';
import {
  assessNutritionFactsLabelShapeFromGrey,
} from '../../../integrations/nutritionFactsLabelShape.js';

test('shouldTryPortraitPanelCrop: wide labels skip portrait gate', () => {
  assert.equal(
    shouldTryPortraitPanelCrop({ widePanel: true, width: 4000, height: 1800 }),
    false,
  );
  assert.equal(
    shouldTryPortraitPanelCrop({ widePanel: false, width: 1800, height: 4000 }),
    true,
  );
});

test('resolveCenterBandCropFractions: portrait vs default center band', () => {
  const portrait = resolveCenterBandCropFractions({ widePanel: false, width: 1800, height: 4000 });
  const wide = resolveCenterBandCropFractions({ widePanel: true, width: 4000, height: 1800 });
  assert.ok(portrait.heightFraction < wide.heightFraction);
  assert.ok(portrait.heightFraction >= 0.5 && portrait.heightFraction <= 0.65);
});

/** Mimics wide-table ink envelope: rules only in lower band → shape gate rejects. */
function syntheticWideTableBand(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = 245;
  const rule = (y: number) => {
    for (let x = Math.round(width * 0.1); x < Math.round(width * 0.9); x += 1) {
      pixels[y * width + x] = 30;
    }
  };
  for (let i = 0; i < 2; i += 1) rule(Math.round(height * (0.72 + i * 0.04)));
  return pixels;
}

test('assessNutritionFactsLabelShapeFromGrey rejects wide lower-band-only envelope pattern', () => {
  const w = 640;
  const h = 360;
  const r = assessNutritionFactsLabelShapeFromGrey(syntheticWideTableBand(w, h), w, h);
  assert.equal(r.looksLikePanel, false);
  assert.ok(
    r.reasons.some((x) => x.startsWith('horizontal_rules') || x.startsWith('first_rule') || x === 'no_first_rule'),
  );
});