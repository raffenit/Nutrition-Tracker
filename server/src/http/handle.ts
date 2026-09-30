import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { loadAuth } from './access.js';
import { HttpError } from './errors.js';
import { sendError } from './respond.js';
import { matchRoute, type Route } from './router.js';
import { serveApp, serveStatic } from './static.js';

type HandleDeps = {
  config: AppConfig;
  db: AppDatabase;
  routes: Route[];
};

export async function handleHttpRequest(req: IncomingMessage, res: ServerResponse, deps: HandleDeps): Promise<void> {
  const { config, db, routes } = deps;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'GET' && !url.pathname.startsWith('/api/') && serveStatic(res, config.publicDir, url.pathname)) return;
  const matched = matchRoute(routes, req.method ?? 'GET', url.pathname);
  if (!matched) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      serveApp(res, config.publicDir);
      return;
    }
    throw new HttpError(404, 'Not found');
  }
  await matched.route.handler({
    req,
    res,
    url,
    params: matched.params,
    auth: loadAuth(db, req),
    config,
    db,
  });
}

export { sendError };
