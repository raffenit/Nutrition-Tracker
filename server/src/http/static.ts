import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function serveStatic(res: ServerResponse, publicDir: string, pathname: string): boolean {
  const filePath = safeFile(publicDir, pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const stat = statSync(filePath);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Security-Policy': 'frame-ancestors *',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

export function serveApp(res: ServerResponse, publicDir: string): void {
  const indexPath = path.join(publicDir, 'index.html');
  if (!existsSync(indexPath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Web app has not been built');
    return;
  }
  serveStatic(res, publicDir, '/index.html');
}

function safeFile(publicDir: string, pathname: string): string | null {
  const root = path.resolve(publicDir);
  const relative = pathname.replace(/^\/+/, '');
  if (!relative || relative.includes('\0')) return null;
  const filePath = path.resolve(root, relative);
  const inside = filePath === root || filePath.startsWith(`${root}${path.sep}`);
  return inside ? filePath : null;
}
