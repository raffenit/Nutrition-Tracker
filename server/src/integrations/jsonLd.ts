/**
 * Shared schema.org JSON-LD extraction for imported HTML pages.
 * Yields every JSON object found in `application/ld+json` script blocks,
 * flattened across arrays and `@graph` wrappers.
 */
export function jsonLdDocuments(html: string): unknown[] {
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!blocks) return [];
  const docs: unknown[] = [];
  for (const block of blocks) {
    const inner = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/, '').trim();
    try {
      docs.push(JSON.parse(inner));
    } catch {
      continue;
    }
  }
  return docs;
}

/** Depth-first walk yielding every object node (arrays, `@graph`, nested values). */
export function* collectJsonLdNodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) yield* collectJsonLdNodes(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  yield record;
  for (const child of Object.values(record)) {
    if (child && typeof child === 'object') yield* collectJsonLdNodes(child);
  }
}
