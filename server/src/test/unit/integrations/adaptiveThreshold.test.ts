import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptiveMeanThresholdForTest } from '../../../integrations/adaptiveThreshold.js';

test('adaptive mean threshold separates dark text from a gradient background', () => {
  const width = 120;
  const height = 40;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bg = 180 + Math.floor((x / width) * 60);
      const dark = x > 20 && x < 100 && y > 10 && y < 30;
      pixels[y * width + x] = dark ? 30 : bg;
    }
  }
  const out = adaptiveMeanThresholdForTest(pixels, width, height, 15, 5);
  let darkSum = 0;
  let lightSum = 0;
  let darkCount = 0;
  let lightCount = 0;
  for (let y = 12; y < 28; y += 1) {
    for (let x = 25; x < 95; x += 1) {
      darkSum += out[y * width + x]!;
      darkCount += 1;
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 15; x += 1) {
      lightSum += out[y * width + x]!;
      lightCount += 1;
    }
  }
  assert.ok(darkSum / darkCount < 128, 'dark text region should binarize darker than background');
  assert.ok(lightSum / lightCount > 128, 'gradient background corner should stay light');
});
