import { extractPdfText } from './extractText.js';
import { htmlToText } from './htmlText.js';
import { HttpError } from '../http/errors.js';

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type UrlImportResult = {
  text: string;
  html: string | null;
  kind: 'pdf' | 'html';
  finalUrl: string;
};

export async function importNutritionFromUrl(urlString: string): Promise<UrlImportResult> {
  const startUrl = parseHttpUrl(urlString);
  assertSafeHostname(startUrl.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(startUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/pdf,*/*;q=0.8',
        'User-Agent': 'NutritionTracker/1.0 (self-hosted household)',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(400, 'Timed out fetching that URL');
    }
    throw new HttpError(400, 'Could not fetch that URL');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new HttpError(400, `Could not fetch URL (HTTP ${response.status})`);
  }

  const finalUrl = new URL(response.url || startUrl.href);
  assertSafeHostname(finalUrl.hostname);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, 'URL returned an empty response');
  if (bytes.length > MAX_BYTES) throw new HttpError(400, 'Linked file is too large (max 8 MB)');

  const kind = detectKind(finalUrl.href, response.headers.get('content-type'), bytes);
  const html = kind === 'html' ? bytes.toString('utf8') : null;
  const text = kind === 'pdf' ? await extractPdfText(bytes) : htmlToText(html ?? '');
  if (!text.trim() && !html?.includes('nmItem')) {
    throw new HttpError(400, 'No readable text at that link. Try a direct PDF or a page with Nutrition Facts in the HTML.');
  }

  return { text, html, kind, finalUrl: finalUrl.href };
}

export function assertSafeHostname(hostname: string): void {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new HttpError(400, 'That URL host is not allowed');
  }
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]') {
    throw new HttpError(400, 'That URL host is not allowed');
  }
  if (/^127\./.test(host) || host.startsWith('169.254.') || host.startsWith('metadata.')) {
    throw new HttpError(400, 'That URL host is not allowed');
  }
}

function parseHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, 'Enter a valid http or https URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Only http and https links are supported');
  }
  if (!url.hostname) throw new HttpError(400, 'Enter a valid URL');
  return url;
}

function detectKind(url: string, contentType: string | null, bytes: Buffer): 'pdf' | 'html' {
  const type = (contentType ?? '').toLowerCase();
  if (type.includes('application/pdf') || url.toLowerCase().includes('.pdf')) return 'pdf';
  if (bytes.slice(0, 5).toString('utf8') === '%PDF-') return 'pdf';
  return 'html';
}
