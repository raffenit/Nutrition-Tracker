import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type AppConfig = {
  port: number;
  dataDir: string;
  databasePath: string;
  uploadDir: string;
  tessdataDir: string;
  publicDir: string;
  usdaApiKey: string | null;
  timezone: string;
  publicUrl: string | null;
  glassMl: number;
};

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
  const uploadDir = path.join(dataDir, 'uploads');
  const tessdataDir = path.join(dataDir, 'tessdata');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(tessdataDir, { recursive: true });
  return {
    port: readPort(process.env.PORT),
    dataDir,
    databasePath: path.join(dataDir, 'nutrition.sqlite'),
    uploadDir,
    tessdataDir,
    publicDir: process.env.PUBLIC_DIR ?? path.join(process.cwd(), 'public'),
    usdaApiKey: blankToNull(process.env.USDA_API_KEY),
    timezone: process.env.TZ?.trim() || 'America/Chicago',
    publicUrl: blankToNull(process.env.PUBLIC_URL),
    glassMl: 250,
  };
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? 3010);
  if (!Number.isInteger(port) || port < 1) return 3010;
  return port;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}
