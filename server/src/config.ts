import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type AppConfig = {
  port: number;
  dataDir: string;
  databasePath: string;
  uploadDir: string;
  tessdataDir: string;
  publicDir: string;
  usdaApiKey: string | null;
  timezone: string;
  /** Tailscale server URL (`TAILSCALE_SERVER_URL` or legacy `PUBLIC_URL`). */
  publicUrl: string | null;
  /** Host port on the tailnet for HTTP access (`NUTRITION_PORT`, default 3010). */
  publishedPort: number;
  /** Full origin for kiosk links (Tailscale URL + port when needed). */
  publicOrigin: string | null;
  glassMl: number;
  vapid: VapidConfig | null;
};

export function loadConfig(): AppConfig {
  const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
  const uploadDir = path.join(dataDir, 'uploads');
  const tessdataDir = path.join(dataDir, 'tessdata');
  mkdirSync(uploadDir, { recursive: true });
  mkdirSync(tessdataDir, { recursive: true });
  const publicUrl =
    blankToNull(process.env.TAILSCALE_SERVER_URL) ?? blankToNull(process.env.PUBLIC_URL);
  const publishedPort = readPort(process.env.NUTRITION_PORT ?? process.env.PUBLIC_PORT);
  return {
    port: readPort(process.env.PORT),
    dataDir,
    databasePath: path.join(dataDir, 'nutrition.sqlite'),
    uploadDir,
    tessdataDir,
    publicDir: process.env.PUBLIC_DIR ?? path.join(process.cwd(), 'public'),
    usdaApiKey: blankToNull(process.env.USDA_API_KEY),
    timezone: process.env.TZ?.trim() || 'America/Chicago',
    publicUrl,
    publishedPort,
    publicOrigin: resolvePublicOrigin(publicUrl, publishedPort),
    glassMl: 250,
    vapid: loadVapid(),
  };
}

/** Combine Tailscale server URL with `NUTRITION_PORT` when the base has no port (legacy URLs with `:port` still work). */
export function resolvePublicOrigin(publicUrl: string | null, publishedPort: number): string | null {
  if (!publicUrl) return null;
  const trimmed = publicUrl.trim().replace(/\/$/, '');
  if (!trimmed) return null;
  try {
    const withScheme = trimmed.includes('://')
      ? trimmed
      : /\.ts\.net$/i.test(trimmed)
        ? `https://${trimmed}`
        : `http://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.port) return parsed.origin;
    // HTTPS kiosk links use the reverse proxy (443); host NUTRITION_PORT is not in the URL.
    if (parsed.protocol === 'https:') return parsed.origin;
    const port = publishedPort > 0 ? publishedPort : 80;
    if (port === 80) return parsed.origin;
    parsed.port = String(port);
    return parsed.origin;
  } catch {
    return trimmed;
  }
}

function loadVapid(): VapidConfig | null {
  const publicKey = blankToNull(process.env.VAPID_PUBLIC_KEY);
  const privateKey = blankToNull(process.env.VAPID_PRIVATE_KEY);
  if (!publicKey || !privateKey) return null;
  const subject = blankToNull(process.env.VAPID_SUBJECT) ?? 'mailto:nutrition@localhost';
  return { publicKey, privateKey, subject };
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
