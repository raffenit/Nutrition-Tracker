import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeHostname } from './importUrl.js';
import { htmlToText } from './htmlText.js';

test('blocks loopback and link-local hosts', () => {
  assert.throws(() => assertSafeHostname('localhost'));
  assert.throws(() => assertSafeHostname('127.0.0.1'));
  assert.throws(() => assertSafeHostname('169.254.169.254'));
});

test('allows tailscale and home LAN hosts', () => {
  assert.doesNotThrow(() => assertSafeHostname('100.100.67.105'));
  assert.doesNotThrow(() => assertSafeHostname('192.168.1.20'));
});

test('extracts nutrition facts text from simple HTML', () => {
  const html = `<html><body><h1>Menu</h1><div>Nutrition Facts</div><div>Calories 120</div><div>Protein 2g</div></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /Nutrition Facts/i);
  assert.match(text, /Calories 120/i);
});
