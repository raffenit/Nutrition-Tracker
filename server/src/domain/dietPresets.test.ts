import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDietPreset, dietPresetById, listDietPresetsPublic } from './dietPresets.js';
import { DEFAULT_TARGETS } from './nutrients.js';

test('diet presets are documented and unique', () => {
  const presets = listDietPresetsPublic();
  assert.ok(presets.length >= 8);
  assert.equal(new Set(presets.map((preset) => preset.id)).size, presets.length);
  for (const preset of presets) {
    assert.match(preset.sourceUrl, /^https:\/\//);
    assert.ok(preset.summary.length > 10);
  }
});

test('applyDietPreset keeps display preferences', () => {
  const base = { ...DEFAULT_TARGETS, units: 'metric' as const, dateFormat: 'iso' as const };
  const dash = dietPresetById('dash');
  assert.ok(dash);
  const next = applyDietPreset(base, dash);
  assert.equal(next.units, 'metric');
  assert.equal(next.dateFormat, 'iso');
  assert.equal(next.sodiumIsLimit, true);
  assert.equal(next.protein, dash.patch.protein);
});

test('low-sodium and diabetic presets use limit flags', () => {
  const lowNa = dietPresetById('low-sodium');
  const diabetic = dietPresetById('diabetic-friendly');
  assert.ok(lowNa && diabetic);
  assert.equal(applyDietPreset(DEFAULT_TARGETS, lowNa).sodium, 1500);
  assert.equal(applyDietPreset(DEFAULT_TARGETS, diabetic).carbsIsLimit, true);
});
