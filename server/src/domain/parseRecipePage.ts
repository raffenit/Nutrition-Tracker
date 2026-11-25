import { parseNutritionLabel } from './parseLabel.js';
import type { RecipeCardImportDraft } from './nutritionImport.js';

/**
 * Fallback for recipe web pages without schema.org Recipe JSON-LD:
 * detect "Ingredients" / "Instructions" (or Directions/Method/Steps)
 * sections in flattened page text and pull the lists out.
 */

const INGREDIENT_HEADING = /^ingredients\b/i;
const INSTRUCTION_HEADING = /^(cooking\s+)?(instructions|directions|method|steps|preparation)\b/i;
/** Lines that end the ingredient list or the instructions block. */
const SECTION_BOUNDARY =
  /^(instructions|directions|method|steps|preparation|nutrition|nutrition facts|reviews?|ratings?|notes?|tips|servings?|prep\s|cook\s|total\s|ready in|course|cuisine|author|source|print|save|jump to|related|you may also|more from)/i;
const META_LINE =
  /^(prep|cook|total|ready in|serves|yield|ratings?|reviews?|print|save|jump to|course|cuisine|author|source|equipment|store|notes?)/i;

const MIN_INGREDIENT_LINES = 3;
const MIN_INSTRUCTION_CHARS = 40;

type Section = { start: number; end: number };

export function recipeCardFromPageText(
  text: string,
  pageTitle: string | null = null,
): RecipeCardImportDraft | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 8) return null;

  const ingredients = findSection(lines, INGREDIENT_HEADING);
  if (!ingredients) return null;
  const instructions = findSection(lines, INSTRUCTION_HEADING);
  if (!instructions || instructions.start <= ingredients.start) return null;

  const ingredientLines = sliceLines(lines, ingredients.start + 1, ingredients.end)
    .map(stripListMarker)
    .filter(isIngredientLine);
  if (ingredientLines.length < MIN_INGREDIENT_LINES) return null;

  const instructionLines = sliceLines(lines, instructions.start + 1, instructions.end);
  const numberedSteps = instructionLines
    .filter((line) => /^\d{1,2}[.)]\s+\S/.test(line)).length >= 2;
  const instructionText = instructionLines
    .map(stripListMarker)
    .join('\n')
    .trim();
  if (instructionText.length < MIN_INSTRUCTION_CHARS) return null;

  // Product pages also carry "Ingredients" + "Directions" — require recipe
  // structure (quantified ingredient lines, numbered steps, or a serves count)
  // before calling it a recipe.
  const quantified = ingredientLines.filter((line) => /\d/.test(line)).length;
  const servings = guessServings(text);
  if (quantified / ingredientLines.length < 0.4 && !numberedSteps && servings === 1) return null;

  const name = pageTitle?.trim() || guessTitle(lines, ingredients.start) || 'Imported recipe';
  const nutrition = parseNutritionLabel(text);

  return {
    name,
    brand: null,
    makesServings: servings,
    servingLabel: '1 serving',
    nutrients: nutrition.nutrients,
    ingredients: ingredientLines.map((line) => ({ name: line, servings: 1 })),
    instructions: instructionText,
  };
}

function findSection(lines: string[], heading: RegExp): Section | null {
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (SECTION_BOUNDARY.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function sliceLines(lines: string[], start: number, end: number): string[] {
  return lines.slice(start, Math.max(start, end));
}

function stripListMarker(line: string): string {
  return line
    .replace(/^[\s•*\-–—◦]+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .trim();
}

function isIngredientLine(line: string): boolean {
  if (line.length < 2 || line.length > 160) return false;
  if (INGREDIENT_HEADING.test(line) || INSTRUCTION_HEADING.test(line) || SECTION_BOUNDARY.test(line)) return false;
  if (/^\d+\s*$/.test(line)) return false;
  return true;
}

function guessTitle(lines: string[], ingredientsStart: number): string | null {
  const head = lines.slice(0, ingredientsStart);
  // Recipe titles usually sit near the top; scan the last plausible line
  // before the Ingredients heading first (intro/meta lines come after it).
  for (let index = head.length - 1; index >= 0; index -= 1) {
    const line = head[index] ?? '';
    if (line.length < 4 || line.length > 90 || !/[a-z]/i.test(line)) continue;
    if (META_LINE.test(line)) continue;
    if (/\d+\s*(stars?|reviews?)/i.test(line)) continue;
    return line;
  }
  return null;
}

function guessServings(text: string): number {
  const match = text.match(/\bserves?\s+(\d{1,2})\b/i)
    ?? text.match(/\byield\s*[:\-–]?\s*(\d{1,2})\b/i);
  return match ? Math.max(1, Number(match[1])) : 1;
}
