import { emptyNutrients } from './nutrients.js';
import { parseAmount, type MenuItemDraft, type NutrientKey } from './menuTableSchema.js';

/**
 * Sectioned PDF nutrition guides: a nutrient header (one line or stacked lines), optional
 * per-nutrient variant codes (sizes / breads / portions), then rows of "name + values".
 * Values may be laid out on the row line or one per line; variant values are nutrient-major.
 */

type HeaderRole = NutrientKey | 'skip';

const HEADER_PHRASES: Array<{ role: HeaderRole; pattern: string }> = [
  { role: 'skip', pattern: 'calories\\s+from\\s+fat' },
  { role: 'calories', pattern: 'total\\s+calories' },
  { role: 'saturatedFat', pattern: 'saturated\\s+fat|sat\\.?\\s*fat' },
  { role: 'skip', pattern: 'trans\\s+fat' },
  { role: 'fat', pattern: 'total\\s+fat' },
  { role: 'carbs', pattern: 'total\\s+carb(?:ohydrates?|s|\\.)?|carbohydrates?|carbs?' },
  { role: 'skip', pattern: 'added\\s+sugars?' },
  { role: 'sugar', pattern: '(?:total\\s+)?sugars?' },
  { role: 'fiber', pattern: '(?:dietary\\s+)?fib(?:er|re)' },
  { role: 'calories', pattern: 'calories' },
  { role: 'fat', pattern: 'fat' },
  { role: 'cholesterol', pattern: 'cholesterol' },
  { role: 'sodium', pattern: 'sodium' },
  { role: 'protein', pattern: 'prot[ie]{2}n' },
];

const HEADER_REGEX = new RegExp(HEADER_PHRASES.map((p) => `\\b(${p.pattern})\\b`).join('|'), 'gi');
const NUMERIC_TOKEN = /^<?\d*\.?\d+(?:\/<?\d*\.?\d+)+$|^<?\d*\.?\d+$/;
const VARIANT_FILLER = /^(portion|size|serving|item|ingredient)s?$/i;
const MAX_NAME_LINES = 2;
const MAX_KEPT_NAME_LINES = 3;
const DANGLING_WORD = /^(the|on|of|for|with|and|to|in)$/i;
const MAX_LEADING_NAME_NUMBERS = 2;
const MAX_VARIANT_PERIOD = 6;

type Token = { text: string; line: number; cell: number };
type RawRecord = { nameLines: string[][]; servingLabel: string | null; values: string[] };

function headerRoles(line: string): HeaderRole[] {
  const stripped = line.replace(/\([^)]*\)/g, ' ');
  const roles: HeaderRole[] = [];
  for (const match of stripped.matchAll(HEADER_REGEX)) {
    const index = match.slice(1).findIndex((group) => group !== undefined);
    if (index >= 0) roles.push(HEADER_PHRASES[index]!.role);
  }
  return roles;
}

function isParentheticalOnly(line: string): boolean {
  return /^\(?[^()]*\)\s*$/.test(line.trim()) && !/\d{2,}/.test(line);
}

function tokenizeLine(line: string, lineIndex: number): Token[] {
  const tokens: Token[] = [];
  line
    .replace(/[”“″]/g, '"')
    .replace(/<\s+(?=\d)/g, '<')
    .split('\t')
    .forEach((cell, cellIndex) => {
      for (const text of cell.trim().split(/\s+/)) if (text) tokens.push({ text, line: lineIndex, cell: cellIndex });
    });
  return tokens;
}

function isNumeric(token: string): boolean {
  return NUMERIC_TOKEN.test(token.replace(/,/g, ''));
}

/** "30/32 OUNCES" sub-headings name the sizes of the slash-separated values below them. */
const SIZE_HEADING = /^(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)+)\s+([A-Za-z.]+)\s*$/;

function isNoiseLine(line: string): boolean {
  return SIZE_HEADING.test(line) || /^--\s*\d+\s+of\s+\d+\s*--$/i.test(line) || (line.includes('=') && line.includes('|'));
}

/** "U = WRAP | 8F = 8” FRENCH" legends anywhere in the document. */
function variantLegend(lines: string[]): Map<string, string> {
  const legend = new Map<string, string>();
  for (const line of lines) {
    if (!line.includes('=') || !line.includes('|')) continue;
    for (const part of line.split('|')) {
      const match = part.match(/^\s*(\S+)\s*=\s*(.+?)\s*$/);
      if (match) legend.set(match[1]!, match[2]!);
    }
  }
  return legend;
}

/** Smallest repeating period of variant codes, e.g. [U 8F SW 16F] × 11 nutrients. */
function variantPeriod(tokens: string[], headerSize: number): string[] | null {
  for (let k = 1; k <= MAX_VARIANT_PERIOD; k += 1) {
    if (tokens.length !== k * headerSize || k === 1) continue;
    if (tokens.every((t, i) => t === tokens[i % k])) return tokens.slice(0, k);
  }
  return null;
}

type Section = {
  roles: HeaderRole[];
  variants: string[] | null;
  variantLines: Set<number>;
  startLine: number;
  endLine: number;
  hasServingColumn: boolean;
};

function findSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let i = 0;
  while (i < lines.length) {
    const roles = headerRoles(lines[i]!);
    if (roles.length === 0) {
      i += 1;
      continue;
    }
    const headerStart = i;
    const collected = [...roles];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j]!.trim();
      if (!line || isParentheticalOnly(line)) {
        j += 1;
        continue;
      }
      const more = headerRoles(line);
      if (more.length === 0 || tokenizeLine(line, j).some((t) => isNumeric(t.text))) break;
      collected.push(...more);
      j += 1;
    }
    if (collected.length < 4 || !collected.includes('calories')) {
      i = j;
      continue;
    }
    const headerText = lines.slice(headerStart, j).join(' ');
    let variants: string[] | null = null;
    const variantLines = new Set<number>();
    let codes: string[] = [];
    let codeLines: number[] = [];
    for (let k = j; k < lines.length; k += 1) {
      const tokens = tokenizeLine(lines[k]!, k)
        .map((t) => t.text)
        .filter((t) => !VARIANT_FILLER.test(t));
      if (tokens.length === 0) continue;
      if (tokens.some((t) => isNumeric(t)) || headerRoles(lines[k]!).length > 0) break;
      codes = [...codes, ...tokens];
      codeLines = [...codeLines, k];
      const ownPeriod = variantPeriod(tokens, collected.length);
      const runPeriod = variantPeriod(codes, collected.length);
      if (ownPeriod || runPeriod) {
        variants = ownPeriod ?? runPeriod;
        for (const line of ownPeriod ? [k] : codeLines) variantLines.add(line);
        break;
      }
    }
    if (sections.length > 0) sections[sections.length - 1]!.endLine = headerStart;
    sections.push({
      roles: collected,
      variants,
      variantLines,
      startLine: j,
      endLine: lines.length,
      hasServingColumn: /\b(portion|serving|size)\b/i.test(headerText),
    });
    i = j;
  }
  return sections;
}

function sectionRecords(lines: string[], section: Section): RawRecord[] {
  const h = section.roles.length;
  const v = section.variants?.length ?? 1;
  const records: RawRecord[] = [];
  let text: Token[] = [];
  let numbers: Token[] = [];

  const flush = () => {
    if (numbers.length === 0) return;
    const fits = [h * v, h].filter((n) => numbers.length >= n && numbers.length - n <= MAX_LEADING_NAME_NUMBERS);
    if (numbers.length < h) {
      text.push(...numbers);
      numbers = [];
      return;
    }
    const expected = fits[0];
    if (expected !== undefined) {
      const lead = numbers.length - expected;
      const nameTokens = [...text, ...numbers.slice(0, lead)];
      const values = numbers.slice(lead).map((t) => t.text);
      const record = toRecord(nameTokens, values, section.hasServingColumn);
      if (record) records.push(record);
    }
    text = [];
    numbers = [];
  };

  for (let li = section.startLine; li < section.endLine; li += 1) {
    const line = lines[li]!.trim();
    if (!line || isNoiseLine(line) || section.variantLines.has(li)) continue;
    const tokens = tokenizeLine(line, li);
    const lastText = tokens.map((t) => isNumeric(t.text)).lastIndexOf(false);
    tokens.forEach((token, index) => {
      if (isNumeric(token.text) && index > lastText) numbers.push(token);
      else {
        flush();
        text.push(token);
      }
    });
  }
  flush();
  return records;
}

function toRecord(nameTokens: Token[], values: string[], hasServingColumn: boolean): RawRecord | null {
  const byLine = new Map<number, Token[]>();
  for (const token of nameTokens) byLine.set(token.line, [...(byLine.get(token.line) ?? []), token]);
  const lineTokens = [...byLine.values()].slice(-MAX_KEPT_NAME_LINES);
  if (lineTokens.length === 0) return null;
  let servingLabel: string | null = null;
  const last = lineTokens[lineTokens.length - 1]!;
  const lastCell = last[last.length - 1]!.cell;
  if (hasServingColumn && last.some((t) => t.cell !== lastCell) && last.filter((t) => t.cell === lastCell).length === 1) {
    servingLabel = last[last.length - 1]!.text;
    lineTokens[lineTokens.length - 1] = last.slice(0, -1);
  }
  const nameLines = lineTokens.map((tokens) => tokens.map((t) => t.text)).filter((l) => l.length > 0);
  if (nameLines.length === 0) return null;
  return { nameLines, servingLabel, values };
}

/** Short codes (EZ / REG / XTRA) that head several rows in a section mark portions of the item above. */
function portionCodes(records: RawRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const flat = record.nameLines.flat();
    const lastWord = flat[flat.length - 1]!;
    if (/^[A-Z]{1,5}$/.test(lastWord)) counts.set(lastWord, (counts.get(lastWord) ?? 0) + 1);
  }
  const standaloneRecords = records.filter((r) => {
    const flat = r.nameLines.flat();
    return flat.length === 1 && counts.has(flat[0]!);
  });
  const standalone = new Set(standaloneRecords.length >= 2 ? standaloneRecords.map((r) => r.nameLines[0]![0]!) : []);
  const codes = new Set(standalone);
  records.forEach((record, index) => {
    const next = records[index + 1]?.nameLines.flat();
    const flat = record.nameLines.flat();
    const lastWord = flat[flat.length - 1]!;
    if (next?.length === 1 && standalone.has(next[0]!) && flat.length > 1 && /^[A-Z]{1,5}$/.test(lastWord)) codes.add(lastWord);
  });
  const hasParentRow = records.some((record) => {
    const flat = record.nameLines.flat();
    return flat.length > 1 && codes.has(flat[flat.length - 1]!);
  });
  return hasParentRow ? codes : new Set();
}

function slashVariantLabels(lines: string[], section: Section): string[] {
  for (const line of lines.slice(section.startLine, section.endLine)) {
    const size = line.trim().match(SIZE_HEADING);
    if (size) return size[1]!.split('/').map((n) => `${n.trim()} ${size[2]!.toLowerCase()}`);
  }
  for (const line of lines.slice(Math.max(0, section.startLine - 8), section.endLine)) {
    const match = line.match(/\bvalues?\s+for\s+(\S+(?:\s*\/\s*\S+)+)/i);
    if (match) return match[1]!.split('/').map((s) => s.trim());
  }
  return [];
}

function nutrientsFrom(roles: HeaderRole[], values: string[]) {
  const nutrients = emptyNutrients();
  const extras: Record<string, number> = {};
  roles.forEach((role, index) => {
    if (role === 'skip') return;
    const amount = parseAmount(values[index] ?? '');
    if (role === 'saturatedFat' || role === 'sugar' || role === 'cholesterol') {
      if (extras[role] === undefined) extras[role] = amount;
    } else if (nutrients[role] === 0) nutrients[role] = amount;
  });
  if (extras.saturatedFat) nutrients.extras.push({ key: 'saturated_fat', label: 'Saturated fat', amount: extras.saturatedFat, unit: 'g' });
  if (extras.sugar) nutrients.extras.push({ key: 'sugar', label: 'Total sugars', amount: extras.sugar, unit: 'g' });
  if (extras.cholesterol) nutrients.extras.push({ key: 'cholesterol', label: 'Cholesterol', amount: extras.cholesterol, unit: 'mg' });
  return nutrients;
}

/** Last name lines, dropping "AVAILABLE ONLY ON THE / <other item>" style note phrases. */
function nameWords(nameLines: string[][]): string[] {
  const kept: string[][] = [];
  for (let i = 0; i < nameLines.length; i += 1) {
    const line = nameLines[i]!;
    if (DANGLING_WORD.test(line[line.length - 1]!) && i + 1 < nameLines.length - 1) {
      i += 1;
      continue;
    }
    kept.push(line);
  }
  return kept.slice(-MAX_NAME_LINES).flat();
}

export function parseMenuTextSections(text: string): MenuItemDraft[] {
  const lines = text.split('\n');
  const legend = variantLegend(lines);
  const items: MenuItemDraft[] = [];
  for (const section of findSections(lines)) {
    const records = sectionRecords(lines, section);
    const codes = portionCodes(records);
    const slashLabels = slashVariantLabels(lines, section);
    let parent: string | null = null;
    for (const record of records) {
      const all = record.nameLines.flat();
      const lastWord = all[all.length - 1]!;
      const isPortion = codes.has(lastWord);
      const kept = isPortion
        ? [...record.nameLines.slice(0, -1), record.nameLines[record.nameLines.length - 1]!.slice(0, -1)].filter((l) => l.length > 0)
        : record.nameLines;
      const words = nameWords(kept);
      let name = words.join(' ');
      if (isPortion) {
        if (words.length > 0) parent = name;
        name = parent ? `${parent} (${lastWord})` : nameWords(record.nameLines).join(' ');
      } else parent = null;
      const h = section.roles.length;
      const variantCount = record.values.length / h;
      const servingLabel = record.servingLabel ?? '1 serving';
      if (variantCount > 1) {
        const labels = section.variants ?? [];
        for (let vi = 0; vi < variantCount; vi += 1) {
          const values = section.roles.map((_, ri) => record.values[ri * variantCount + vi]!);
          const code = labels[vi] ?? `size ${vi + 1}`;
          items.push({ name: `${name}, ${legend.get(code) ?? code}`, servingLabel, nutrients: nutrientsFrom(section.roles, values) });
        }
        continue;
      }
      const slashParts = Math.max(...record.values.map((value) => value.split('/').length));
      if (slashParts > 1) {
        for (let vi = 0; vi < slashParts; vi += 1) {
          const values = record.values.map((value) => {
            const parts = value.split('/');
            return parts[Math.min(vi, parts.length - 1)]!;
          });
          items.push({ name: `${name}, ${slashLabels[vi] ?? `size ${vi + 1}`}`, servingLabel, nutrients: nutrientsFrom(section.roles, values) });
        }
        continue;
      }
      items.push({ name, servingLabel, nutrients: nutrientsFrom(section.roles, record.values) });
    }
  }
  return items.filter((item) => item.nutrients.calories > 0 || item.nutrients.protein > 0 || item.nutrients.fat > 0 || item.nutrients.sodium > 0);
}
