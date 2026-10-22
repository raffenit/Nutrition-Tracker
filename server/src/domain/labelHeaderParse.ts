import { findEmbeddedCanonicalSpan } from './ocrConfusables.js';

/** Fuzzy “serving size” header (e.g. `Senvng size`). */
export function likelyServingSizeHeader(text: string): boolean {
  if (/serving\s+size/i.test(text)) return true;
  return /\bserv\w*\s*size\b/i.test(text)
    || /\b\w*erv\w*\s*size\b/i.test(text)
    || /\bs\w*en\w*g\s*size\b/i.test(text)
    || findEmbeddedCanonicalSpan(text.slice(0, 220), 'servingsize') != null;
}

/** Fuzzy “servings per container” (e.g. `Tsering per conlaier`). */
export function likelyServingsPerContainerHeader(text: string): boolean {
  if (/servings?\s+per\s+cont/i.test(text)) return true;
  return /\bserv\w*\s+per\s+c(?:o|a)n\w*/i.test(text)
    || /\b\w{4,12}ing\s+per\s+c(?:o|a)[a-z]{3,14}/i.test(text)
    || /\bper\s+c(?:o|a)n(?:tain\w*|laier|tainer)/i.test(text);
}

/** Normalize OCR volume token; repairs `o`→`0` and truncated hundreds on bottle sizes. */
export function normalizeOcrVolumeToken(raw: string): string {
  let token = raw.trim().toLowerCase().replace(/\s/g, '').replace(/[^0-9a-z.]/g, '');
  token = token.replace(/(\d)[oO](\d)/g, '$10$2');
  token = token.replace(/(\d)[oO](?=m[lL]|ml)/g, '$10');

  let ml: number | null = null;
  const withUnit = token.match(/^(\d+(?:\.\d+)?)(?:m[lL]|ml)$/);
  if (withUnit) ml = Number(withUnit[1]);
  else {
    const digitsOnly = token.replace(/[oO]/g, '0').match(/^(\d+(?:\.\d+)?)/);
    if (digitsOnly) ml = Number(digitsOnly[1]);
  }

  if (ml == null || !Number.isFinite(ml) || ml <= 0) return token;

  if (ml >= 10 && ml < 100) {
    const bumped = 300 + ml;
    if (bumped >= 237 && bumped <= 710) ml = bumped;
  }

  return `${ml} ml`;
}

function headerWindow(text: string): string {
  const start = text.search(/nutrition\s+facts/i);
  const from = start >= 0 ? start : 0;
  return text.slice(from, from + 220);
}

export function parseServingsPerContainerVariant(text: string): number | null {
  const flat = text.replace(/\s+/g, ' ');

  const strict = flat.match(/(\d+(?:\.\d+)?)\s*servings?\s+per\s+cont\w+/i);
  if (strict) {
    const value = Number(strict[1]);
    if (value > 0 && value <= 999) return value;
  }

  const fuzzyCountFirst = flat.match(/(\d+(?:\.\d+)?)\s*serv\w*\s+per\s+c[a-z]{4,14}/i);
  if (fuzzyCountFirst) {
    const value = Number(fuzzyCountFirst[1]);
    if (value > 0 && value <= 999) return value;
  }

  const fuzzyPhrase =
    flat.match(/\bserv\w*\s+per\s+c(?:o|a)n[a-z]{3,14}/i)
    ?? flat.match(/\b\w{4,12}ing\s+per\s+c(?:o|a)[a-z]{3,14}/i);
  if (!fuzzyPhrase) return null;

  const idx = fuzzyPhrase.index ?? 0;
  const before = flat.slice(Math.max(0, idx - 16), idx);
  const lead = before.match(/(\d+(?:\.\d+)?)\s*$/);
  if (lead) {
    const value = Number(lead[1]);
    if (value > 0 && value <= 999) return value;
  }

  const after = flat.slice(idx, idx + 90);
  const oneBeforeServingSize = after.match(/\b(\d+)\s+serv\w*\s*size\b/i);
  if (oneBeforeServingSize) {
    const value = Number(oneBeforeServingSize[1]);
    if (value > 0 && value <= 99) return value;
  }

  const nearDigit = after.match(/\b(\d{1,2})\b/);
  if (nearDigit) {
    const value = Number(nearDigit[1]);
    if (value > 0 && value <= 99) return value;
  }

  if (/\bbottles?\b/i.test(after)) return 1;

  return 1;
}

export function parseServingSizeVariant(text: string): string | null {
  const head = headerWindow(text.replace(/\r/g, '\n'));
  const flat = head.replace(/\s+/g, ' ');

  const bottle = flat.match(/\b(\d+)?\s*bottles?\s*[\[(]?\s*(\d+[a-z0-9.]*)\s*m?[lL]/i);
  if (bottle) {
    const count = bottle[1] ? Number(bottle[1]) : 1;
    const volume = normalizeOcrVolumeToken(bottle[2] ?? '');
    if (volume) {
      const unit = count === 1 ? 'bottle' : 'bottles';
      return `${count} ${unit} (${volume})`.slice(0, 80);
    }
  }

  const headerMatch = flat.match(/\bserv\w*\s*size\s*:?\s*(.{4,70}?)(?=\s+serv\w*\s+per|\s+calories\b|\s+anunt\s+calories)/i);
  if (headerMatch) {
    const body = headerMatch[1]!.replace(/\s+/g, ' ').trim();
    if (body.length >= 3) return body.slice(0, 80);
  }

  const embedded = flat.match(/\b(\d+)\s*(?:bottles?|can|cups?)\s*[\[(]?\s*([^)\]]{2,18})/i);
  if (embedded) {
    const volume = normalizeOcrVolumeToken(embedded[2] ?? '');
    if (volume) {
      return `${embedded[1]} bottle (${volume})`.slice(0, 80);
    }
  }

  return null;
}
