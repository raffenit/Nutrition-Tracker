import { assertSafeHostname, type UrlImportResult } from './importUrl.js';
import { HttpError } from '../http/errors.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15_000;
const MAX_CANDIDATES = 3;
const CONTEXT_RADIUS = 1200;

const LABEL_HINT = /nutrition|ingredient|label|facts/i;

/**
 * Find <img> candidates that plausibly show a nutrition label: the image's own
 * src/alt mentions label-ish terms, or nutrition/ingredient text sits near it in
 * the markup. Returns absolute https URLs, best first.
 */
export function extractLabelImageCandidates(html: string, baseUrl: string, limit = MAX_CANDIDATES): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const scored: { url: string; score: number }[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html))) {
    const tag = match[0];
    const src = readAttr(tag, 'src') ?? readAttr(tag, 'data-src') ?? readAttr(tag, 'data-lazy-src');
    if (!src || /^data:/i.test(src)) continue;
    let url: URL;
    try {
      url = new URL(src.startsWith('//') ? `https:${src}` : src, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    const absolute = url.href;
    if (seen.has(absolute)) continue;
    seen.add(absolute);

    const alt = readAttr(tag, 'alt') ?? '';
    // Visible text near the image only — strip tags so sibling alt/src attributes
    // don't pollute the context signal.
    const context = html
      .slice(Math.max(0, match.index - CONTEXT_RADIUS), match.index + tag.length + CONTEXT_RADIUS)
      .replace(/<[^>]+>/g, ' ');
    let score = 0;
    if (LABEL_HINT.test(alt) || LABEL_HINT.test(src)) score += 3;
    if (LABEL_HINT.test(context)) score += 2;
    // Vector icons/logos can't be label photos.
    if (/\.svg(\?|#|$)/i.test(url.pathname + url.search)) continue;
    if (/\.(png|jpe?g|webp|avif)(\?|#|$)/i.test(url.pathname + url.search)) score += 1;
    if (score === 0) continue;
    scored.push({ url: absolute, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.url);
}

function readAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return tag.match(re)?.[1] ?? null;
}

/** Fetch one candidate label image; returns null when it is not a usable image. */
export async function fetchLabelImage(urlString: string): Promise<Buffer | null> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  try {
    assertSafeHostname(url.hostname);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'NutritionTracker/1.0 (self-hosted household)',
      },
    });
    if (!response.ok) return null;
    const finalUrl = new URL(response.url || url.href);
    assertSafeHostname(finalUrl.hostname);
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type UrlOcrFallbackResult = {
  text: string;
  usedOcr: boolean;
  imageUrl: string | null;
};

/**
 * Text-first URL import with an OCR fallback: when the page text yields no
 * nutrition data, try reading label images embedded in the HTML through the
 * standard image OCR pipeline.
 */
export async function importNutritionFromUrlWithImageFallback(
  fetched: UrlImportResult,
  deps: {
    extractImageLabel: (bytes: Buffer, cachePath: string, options?: { easyocrModelDir?: string }) => Promise<{ text: string }>;
    tessdataDir: string;
    easyocrModelDir?: string;
    textYieldsNutrition: (text: string) => boolean;
  },
): Promise<UrlOcrFallbackResult> {
  if (fetched.kind !== 'html' || !fetched.html) {
    return { text: fetched.text, usedOcr: false, imageUrl: null };
  }
  if (deps.textYieldsNutrition(fetched.text)) {
    return { text: fetched.text, usedOcr: false, imageUrl: null };
  }
  const candidates = extractLabelImageCandidates(fetched.html, fetched.finalUrl);
  for (const imageUrl of candidates) {
    const bytes = await fetchLabelImage(imageUrl);
    if (!bytes) continue;
    try {
      const extracted = await deps.extractImageLabel(bytes, deps.tessdataDir, {
        easyocrModelDir: deps.easyocrModelDir,
      });
      if (extracted.text.trim()) {
        return { text: extracted.text, usedOcr: true, imageUrl };
      }
    } catch {
      continue;
    }
  }
  return { text: fetched.text, usedOcr: false, imageUrl: null };
}
