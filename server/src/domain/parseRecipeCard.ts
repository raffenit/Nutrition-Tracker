import { parseNutritionLabel } from './parseLabel.js';

export type ParsedRecipeCard = {
  title: string | null;
  brand: string | null;
  ingredientLines: string[];
  instructions: string;
  looksLikeRecipeCard: boolean;
};

const INGREDIENT_HEADING = /^(ingredients|what'?s in (the )?box|in (your|the) box|you'?ll need)\b/i;
const INSTRUCTION_HEADING = /^(cooking )?(instructions|directions|steps|method)\b/i;
const NUTRITION_HEADING = /^(nutrition values|nutrition facts|nutrition information|per meal)\b/i;
const MEAL_KIT_BRAND = /\b(green chef|hello\s*fresh|blue apron|home chef|sun basket|factor|every plate)\b/i;

export function parseRecipeCard(text: string): ParsedRecipeCard {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ingStart = findHeading(lines, INGREDIENT_HEADING);
  const dirStart = findHeading(lines, INSTRUCTION_HEADING);
  const nutStart = findHeading(lines, NUTRITION_HEADING);

  const ingredientEnd = nextSectionAfter(ingStart, dirStart, nutStart, lines.length);
  const instructionEnd = nutStart >= 0 ? nutStart : lines.length;

  const ingredientLines = ingStart >= 0
    ? sliceSection(lines, ingStart + 1, ingredientEnd).filter(isIngredientLine)
    : [];
  const instructions = dirStart >= 0
    ? sliceSection(lines, dirStart + 1, instructionEnd).join('\n').trim()
    : '';

  const nutrition = parseNutritionLabel(text);
  const title = guessTitle(lines, ingStart, dirStart, nutStart);
  const brand = guessBrand(text, lines);

  const looksLikeRecipeCard =
    (ingredientLines.length >= 2 && instructions.length >= 40)
    || (ingredientLines.length >= 2 && nutrition.looksLikeLabel)
    || (instructions.length >= 40 && nutrition.looksLikeLabel && /per meal|nutrition values/i.test(text));

  return { title, brand, ingredientLines, instructions, looksLikeRecipeCard };
}

function findHeading(lines: string[], pattern: RegExp): number {
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? '')) return index;
  }
  return -1;
}

function nextSectionAfter(from: number, ...laterHeadings: number[]): number {
  const candidates = laterHeadings.filter((value) => value > from);
  if (candidates.length === 0) return -1;
  return Math.min(...candidates);
}

function sliceSection(lines: string[], start: number, end: number): string[] {
  return lines.slice(start, Math.max(start, end));
}

function isIngredientLine(line: string): boolean {
  if (line.length < 2 || line.length > 120) return false;
  if (INGREDIENT_HEADING.test(line) || INSTRUCTION_HEADING.test(line) || NUTRITION_HEADING.test(line)) return false;
  if (/^\d+\s*$/.test(line)) return false;
  return true;
}

function guessTitle(lines: string[], ingStart: number, dirStart: number, nutStart: number): string | null {
  const headEnd = ingStart >= 0 ? ingStart : dirStart >= 0 ? dirStart : Math.min(6, lines.length);
  const head = lines.slice(0, headEnd);
  for (const line of head) {
    if (MEAL_KIT_BRAND.test(line)) continue;
    if (/^(serves|prep|cook|total time|level)\b/i.test(line)) continue;
    if (line.length >= 4 && line.length <= 80 && /[a-z]/i.test(line)) return line;
  }
  return null;
}

function guessBrand(text: string, lines: string[]): string | null {
  const match = text.match(MEAL_KIT_BRAND);
  if (match) return titleCase(match[1].replace(/\s+/g, ' '));
  const early = lines.slice(0, 4).find((line) => MEAL_KIT_BRAND.test(line));
  if (early) {
    const hit = early.match(MEAL_KIT_BRAND);
    if (hit) return titleCase(hit[1].replace(/\s+/g, ' '));
  }
  return null;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}
