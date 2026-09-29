import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import type { UserRecord } from '../db/users.js';

export type Auth =
  | { kind: 'user'; user: UserRecord }
  | { kind: 'kiosk' }
  | { kind: 'none' };

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  auth: Auth;
  config: AppConfig;
  db: AppDatabase;
};

export type Handler = (ctx: Ctx) => Promise<void>;

export type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
};

export function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const source = path.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
}

export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? '')]));
    return { route, params };
  }
  return null;
}
