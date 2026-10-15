import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublicOrigin } from '../config.js';

test('resolvePublicOrigin appends NUTRITION_PORT to a base URL without port', () => {
  assert.equal(resolvePublicOrigin('http://100.100.67.105', 3010), 'http://100.100.67.105:3010');
});

test('resolvePublicOrigin leaves HTTPS tailnet URLs on default 443', () => {
  assert.equal(
    resolvePublicOrigin('https://frankenstein.example.ts.net', 3010),
    'https://frankenstein.example.ts.net',
  );
});

test('resolvePublicOrigin treats bare MagicDNS ts.net hostnames as HTTPS', () => {
  assert.equal(
    resolvePublicOrigin('frankenstein.tailf6749c.ts.net', 3010),
    'https://frankenstein.tailf6749c.ts.net',
  );
});

test('resolvePublicOrigin keeps a legacy PUBLIC_URL that already includes a port', () => {
  assert.equal(resolvePublicOrigin('http://100.100.67.105:3010', 8080), 'http://100.100.67.105:3010');
});
