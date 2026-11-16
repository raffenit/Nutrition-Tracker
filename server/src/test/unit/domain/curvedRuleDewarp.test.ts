import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  curvedRuleParamsForHeight,
  curvedRuleY,
  detectCurvedRules,
  dewarpToStraightRules,
  fitQuadratic,
  maxRuleSpreadPx,
} from '../../../domain/curvedRuleDewarp.js';

/** White image with thin dark rules that sag like rows on a cylinder: y = base + k·((x − cx)/cx)². */
function curvedRulesImage(width: number, height: number, bases: number[], sag: number, halfThickness = 1): Uint8Array {
  const data = new Uint8Array(width * height).fill(235);
  const cx = width / 2;
  for (const base of bases) {
    for (let x = 0; x < width; x += 1) {
      const y = Math.round(base + sag * ((x - cx) / cx) ** 2);
      for (let dy = -halfThickness; dy <= halfThickness; dy += 1) {
        const yy = y + dy;
        if (yy >= 0 && yy < height) data[yy * width + x] = 20;
      }
    }
  }
  return data;
}

test('fitQuadratic recovers a parabola', () => {
  const pts: Array<[number, number]> = [0, 10, 20, 30, 40].map((x) => [x, 3 + 0.5 * x + 0.02 * x * x]);
  const fit = fitQuadratic(pts);
  assert.ok(Math.abs(fit.a - 3) < 1e-6);
  assert.ok(Math.abs(fit.b - 0.5) < 1e-6);
  assert.ok(Math.abs(fit.c - 0.02) < 1e-6);
});

test('detectCurvedRules traces sagging rules and dewarp straightens them', () => {
  const width = 400;
  const height = 300;
  const bases = [40, 100, 160, 220];
  const image = { data: curvedRulesImage(width, height, bases, 18), width, height };
  const rules = detectCurvedRules(image);
  assert.equal(rules.length, bases.length);
  assert.ok(maxRuleSpreadPx(rules, width) > 8);

  const flat = dewarpToStraightRules(image, rules);
  const straightened = detectCurvedRules({ data: flat, width, height });
  assert.equal(straightened.length, bases.length);
  assert.ok(maxRuleSpreadPx(straightened, width) < 4, `spread ${maxRuleSpreadPx(straightened, width)}`);
  for (const rule of straightened) {
    assert.ok(Math.abs(curvedRuleY(rule, 60) - curvedRuleY(rule, 340)) < 3);
  }
});

test('detectCurvedRules ignores thick text-like bands', () => {
  const width = 300;
  const height = 200;
  const data = new Uint8Array(width * height).fill(235);
  for (let y = 80; y < 110; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = 20;
  assert.equal(detectCurvedRules({ data, width, height }).length, 0);
});

test('straight rules report near-zero spread', () => {
  const width = 300;
  const height = 200;
  const rules = detectCurvedRules({ data: curvedRulesImage(width, height, [50, 120], 0), width, height });
  assert.equal(rules.length, 2);
  assert.ok(maxRuleSpreadPx(rules, width) < 1.5);
});

test('rule thickness limits scale with image height', () => {
  const width = 800;
  const height = 2400;
  const bases = [300, 900, 1500, 2100];
  // 17px rules: a 2.4× photo of rules that are ~7px at the reference height.
  const image = { data: curvedRulesImage(width, height, bases, 36, 8), width, height };
  assert.equal(detectCurvedRules(image).length, 0);
  assert.equal(detectCurvedRules(image, curvedRuleParamsForHeight(height)).length, bases.length);
  assert.deepEqual(curvedRuleParamsForHeight(600), curvedRuleParamsForHeight(1000));
});
