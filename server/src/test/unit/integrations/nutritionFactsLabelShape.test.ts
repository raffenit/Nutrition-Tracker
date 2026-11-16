import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessNutritionFactsLabelShapeFromGrey } from '../../../integrations/nutritionFactsLabelShape.js';

/** Minimal ruled panel: heading block + calories bar + body rules. */
function syntheticFullPanel(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = 245;
    }
  }
  const rule = (y0: number, y1: number) => {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = Math.round(width * 0.12); x < Math.round(width * 0.88); x += 1) {
        pixels[y * width + x] = 25;
      }
    }
  };
  for (let y = Math.round(height * 0.05); y < Math.round(height * 0.11); y += 3) {
    for (let x = Math.round(width * 0.15); x < Math.round(width * 0.85); x += 6) {
      pixels[y * width + x] = 35;
    }
  }
  rule(Math.round(height * 0.2), Math.round(height * 0.205));
  for (let i = 0; i < 5; i += 1) {
    const y = Math.round(height * (0.32 + i * 0.1));
    rule(y, y + 1);
  }
  return pixels;
}

function syntheticBodyOnly(width: number, height: number): Uint8Array {
  const pixels = syntheticFullPanel(width, height);
  for (let y = 0; y < Math.round(height * 0.22); y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = 245;
    }
  }
  return pixels;
}

test('assessNutritionFactsLabelShapeFromGrey accepts synthetic full panel', () => {
  const w = 320;
  const h = 520;
  const r = assessNutritionFactsLabelShapeFromGrey(syntheticFullPanel(w, h), w, h, {
    headerBandMinEdgeFractionOfPeak: 0.12,
  });
  assert.equal(r.looksLikePanel, true, r.reasons.join(', '));
  assert.ok(r.horizontalRuleCount >= 4);
});

test('assessNutritionFactsLabelShapeFromGrey rejects crop missing heading band', () => {
  const w = 320;
  const h = 520;
  const r = assessNutritionFactsLabelShapeFromGrey(syntheticBodyOnly(w, h), w, h);
  assert.equal(r.looksLikePanel, false);
  assert.ok(r.reasons.length > 0);
});