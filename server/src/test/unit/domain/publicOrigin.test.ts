import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePublicOrigin } from '../../../config.js';

test('resolvePublicOrigin appends NUTRITION_PORT to a base URL without port', () => {
  assert.equal(resolvePublicOrigin('http://100.64.0.10', 3010), 'http://100.64.0.10:3010');
});

test('resolvePublicOrigin leaves HTTPS tailnet URLs on default 443', () => {
  assert.equal(
    resolvePublicOrigin('https://nutrition.example.ts.net', 3010),
    'https://nutrition.example.ts.net',
  );
});

test('resolvePublicOrigin treats bare MagicDNS ts.net hostnames as HTTPS', () => {
  assert.equal(
    resolvePublicOrigin('server.tailnet.ts.net', 3010),
    'https://server.tailnet.ts.net',
  );
});

test('resolvePublicOrigin strips :3010 from mistaken https URLs', () => {
  assert.equal(
    resolvePublicOrigin('https://server.tailnet.ts.net:3010', 3010),
    'https://server.tailnet.ts.net',
  );
});

test('resolvePublicOrigin keeps a legacy PUBLIC_URL that already includes a port', () => {
  assert.equal(resolvePublicOrigin('http://100.64.0.10:3010', 8080), 'http://100.64.0.10:3010');
});
