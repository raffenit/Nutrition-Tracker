import {
  inferSchemaFromRows,
  isNutritionHeaderRow,
  type MenuItemDraft,
  rowToMenuItem,
  schemaFromHeader,
} from './menuTableSchema.js';

export type { MenuItemDraft } from './menuTableSchema.js';

const MAX_ITEMS = 250;

export function parseMenuFromSource(text: string, html: string | null): MenuItemDraft[] {
  const items: MenuItemDraft[] = [];
  if (html) items.push(...parseHtmlTables(html));
  items.push(...parseDelimitedTables(text));
  return capItems(items);
}

/** @deprecated Use parseMenuFromSource; kept for tests and Nutritionix-shaped HTML snippets. */
export function parseNutritionixHtml(html: string): MenuItemDraft[] {
  return parseHtmlTables(html);
}

/** @deprecated Use parseMenuFromSource; kept for tests. */
export function parsePipeTableText(text: string): MenuItemDraft[] {
  return parseDelimitedTables(text);
}

function parseDelimitedTables(text: string): MenuItemDraft[] {
  const items: MenuItemDraft[] = [];
  let block: string[][] = [];

  const flush = () => {
    items.push(...parseTableRows(block));
    block = [];
  };

  for (const line of text.split('\n')) {
    if (!line.includes('|')) {
      if (block.length > 0) flush();
      continue;
    }
    const cells = splitPipeCells(line);
    if (cells.length < 4) continue;
    if (cells.every((c) => /^-+$/.test(c.replace(/\s/g, '')))) continue;
    block.push(cells);
  }
  if (block.length > 0) flush();

  return items;
}

function parseHtmlTables(html: string): MenuItemDraft[] {
  const items: MenuItemDraft[] = [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [html];

  for (const table of tables) {
    const rows: string[][] = [];
    for (const match of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = match[1] ?? '';
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        cell[1] ?? '',
      );
      if (cells.length >= 4) rows.push(cells);
    }
    items.push(...parseTableRows(rows));
  }

  // Single-row exports (no <table> wrapper) — common on nutrition microsites
  if (items.length === 0) {
    for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const rowHtml = match[1] ?? '';
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        cell[1] ?? '',
      );
      if (cells.length >= 4) items.push(...parseTableRows([cells]));
    }
  }

  return items;
}

function parseTableRows(rows: string[][]): MenuItemDraft[] {
  if (rows.length === 0) return [];

  let headerIdx = rows.findIndex((cells) => isNutritionHeaderRow(cells));
  let schema = headerIdx >= 0 ? schemaFromHeader(rows[headerIdx]) : null;
  const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

  if (!schema && dataRows.length > 0) {
    schema = inferSchemaFromRows(dataRows.slice(0, Math.min(8, dataRows.length)));
  }
  if (!schema) return [];

  const items: MenuItemDraft[] = [];
  for (const cells of dataRows) {
    const item = rowToMenuItem(cells, schema);
    if (item) items.push(item);
  }
  return items;
}

function splitPipeCells(line: string): string[] {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

function capItems(items: MenuItemDraft[]): MenuItemDraft[] {
  const seen = new Set<string>();
  const unique: MenuItemDraft[] = [];
  for (const item of items) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= MAX_ITEMS) break;
  }
  return unique;
}
