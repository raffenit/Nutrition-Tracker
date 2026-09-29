import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './errors.js';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': 'frame-ancestors *',
  'X-Content-Type-Options': 'nosniff',
};

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...HEADERS, 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.status, { error: error.message });
    return;
  }
  console.error(error);
  sendJson(res, 500, { error: 'Something went wrong' });
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new HttpError(413, 'Request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'Request body must be JSON');
  }
}
