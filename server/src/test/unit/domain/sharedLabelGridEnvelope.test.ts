import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharedLabelGridEnvelopeRect } from '../../../domain/sharedLabelGridEnvelope.js';

test('sharedLabelGridEnvelopeRect uses ink bounds without expanding to column strip right', () => {
  const band = { top: 100, height: 800 };
  const label = { left: 0, width: 200 };
  const values = [{ left: 200, width: 3800 }];
  const env = sharedLabelGridEnvelopeRect(
    band,
    label,
    values,
    4000,
    20 / 640,
    { left: 113, right: 3500 },
  );
  assert.ok(env.left >= 99 && env.left <= 113);
  assert.ok(env.left + env.width >= 3520 && env.left + env.width <= 3540);
  assert.ok(env.top < 100);
  assert.ok(env.width < 3600);
});

test('sharedLabelGridEnvelopeRect falls back to column strips without ink bounds', () => {
  const band = { top: 100, height: 800 };
  const label = { left: 0, width: 200 };
  const values = [{ left: 200, width: 3800 }];
  const env = sharedLabelGridEnvelopeRect(band, label, values, 4000, 20 / 640);
  assert.ok(env.width > 3500);
});