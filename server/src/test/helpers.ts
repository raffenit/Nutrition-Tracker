import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { AppConfig } from '../config.js';
import { createNutritionApp } from '../server.js';

export function testConfig(): AppConfig {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'nutrition-test-'));
  const uploadDir = path.join(dataDir, 'uploads');
  const tessdataDir = path.join(dataDir, 'tessdata');
  const publicDir = path.join(dataDir, 'public');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(tessdataDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });
  return {
    port: 0,
    dataDir,
    databasePath: path.join(dataDir, 'nutrition.sqlite'),
    uploadDir,
    tessdataDir,
    publicDir,
    usdaApiKey: null,
    timezone: 'America/Chicago',
    publicUrl: null,
    glassMl: 250,
  };
}

export async function withTestServer(run: (ctx: TestServer) => Promise<void>): Promise<void> {
  const config = testConfig();
  const app = createNutritionApp(config);
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', () => resolve()));
  const address = app.server.address() as AddressInfo;
  try {
    await run({ port: address.port, config, cookie: '' });
  } finally {
    await new Promise<void>((resolve, reject) => app.server.close((error) => (error ? reject(error) : resolve())));
    rmSync(config.dataDir, { recursive: true, force: true });
  }
}

export type TestServer = {
  port: number;
  config: AppConfig;
  cookie: string;
};

export async function api<T>(
  port: number,
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string },
): Promise<{ status: number; body: T; cookie: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.cookie ? { Cookie: init.cookie } : {}),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as T : {} as T;
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((line) => line.startsWith('nutrition_session='));
  const cookie = session ? session.split(';')[0] ?? init?.cookie ?? '' : init?.cookie ?? '';
  return { status: response.status, body, cookie };
}
