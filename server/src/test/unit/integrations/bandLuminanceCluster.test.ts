import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyBandLuminance,
  verticalRuledGutterBrightnessLevel,
} from '../../../integrations/bandLuminanceCluster.js';

function fillRegion(
  pixels: Uint8Array,
  width: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  value: number,
): void {
  for (let x = x0; x < x1; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      pixels[y * width + x] = value;
    }
  }
}

test('classifyBandLuminance separates paper and ink (two groups)', () => {
  const width = 400;
  const height = 100;
  const pixels = new Uint8Array(width * height);
  fillRegion(pixels, width, 0, width, 10, 90, 210);
  for (let y = 25; y < 75; y += 1) {
    for (let x = 40; x < 360; x += 6) {
      pixels[y * width + x] = 38;
    }
  }

  const roles = classifyBandLuminance(pixels, width, height, 0, width, 10, 90);
  assert.ok(roles.background >= 180 && roles.background <= 230);
  assert.ok(roles.ink <= 60);
  assert.ok(roles.background > roles.ink + 80);
});

test('classifyBandLuminance supports light text on dark background', () => {
  const width = 400;
  const height = 100;
  const pixels = new Uint8Array(width * height);
  pixels.fill(42);
  for (let y = 15; y < 85; y += 1) {
    for (let x = 50; x < 350; x += 5) {
      pixels[y * width + x] = 228;
    }
  }

  const roles = classifyBandLuminance(pixels, width, height, 0, width, 10, 90);
  assert.equal(roles.polarity, 'light_on_dark');
  assert.ok(roles.background < 80);
  assert.ok(roles.ink > 180);
});

test('classifyBandLuminance treats sparse near-white peak as glare', () => {
  const width = 400;
  const height = 100;
  const pixels = new Uint8Array(width * height);
  pixels.fill(205);
  for (let i = 0; i < 4000; i += 1) pixels[i * 2] = 32;
  for (let y = 10; y < 90; y += 1) {
    pixels[y * width + 50] = 255;
    pixels[y * width + 51] = 255;
  }

  const roles = classifyBandLuminance(pixels, width, height, 0, width, 10, 90);
  assert.ok(roles.background < 245);
  assert.ok(roles.ink < 80);
  assert.ok(roles.glareCap < 255);
});

test('verticalRuledGutterBrightnessLevel uses bright paper gaps when dark cells dominate', () => {
  const width = 640;
  const height = 200;
  const pixels = new Uint8Array(width * height);
  pixels.fill(245);
  const labelW = 120;
  const valueW = width - labelW;
  const gutter = Math.round(valueW * 0.02);
  const colW = Math.round((valueW - gutter * 4) / 5);
  let x = labelW;
  for (let c = 0; c < 5; c += 1) {
    for (let y = 30; y < 180; y += 1) {
      for (let cx = x; cx < x + colW; cx += 1) pixels[y * width + cx] = 28;
    }
    x += colW + gutter;
  }
  const roles = classifyBandLuminance(pixels, width, height, labelW, width, 24, 180);
  assert.equal(roles.polarity, 'light_on_dark');
  const level = verticalRuledGutterBrightnessLevel(roles, 0.88);
  let brightGutterCols = 0;
  let inkCols = 0;
  for (let lx = 0; lx < valueW; lx += 1) {
    let sum = 0;
    for (let y = 24; y < 180; y += 1) sum += pixels[y * width + labelW + lx]!;
    const mean = sum / (180 - 24);
    if (mean >= level) brightGutterCols += 1;
    else inkCols += 1;
  }
  assert.ok(brightGutterCols > 0 && inkCols > 0);
  assert.ok(brightGutterCols < valueW / 4, 'gutters should be narrow bright runs, not most of the band');
});
