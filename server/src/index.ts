import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { loadAuth } from './http/access.js';
import { HttpError } from './http/errors.js';
import { sendError } from './http/respond.js';
import { matchRoute } from './http/router.js';
import { serveApp, serveStatic } from './http/static.js';
import { authRoutes } from './routes/authRoutes.js';
import { boardRoutes } from './routes/boardRoutes.js';
import { foodRoutes } from './routes/foodRoutes.js';
import { logRoutes } from './routes/logRoutes.js';
import { weightRoutes } from './routes/weightRoutes.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const routes = [...authRoutes(), ...boardRoutes(), ...foodRoutes(), ...logRoutes(), ...weightRoutes()];

const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => sendError(res, error));
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Nutrition Tracker listening on ${config.port}`);
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
