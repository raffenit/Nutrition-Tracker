/**
 * Multi-recipe PDF booklets (scanned meal-kit cards): one recipe per card, each
 * card printed front (title + ingredient table) and back (numbered steps).
 * Pages are grouped into cards by layout — a page with an ingredient table or
 * INGREDIENTS heading starts a card, following pages without one are its back.
 */
import { detectMealKitBrand, parseRecipeCard } from './parseRecipeCard.js';
import type { RecipePageLayout } from './recipeCardLayout.js';
import { emptyNutrients } from './nutrients.js';
import type { Nutrients } from '../types.js';

export type RecipeBookletCard = {
  /** 0-based indexes into the booklet's page list. */
  pages: number[];
  front: string;
  back: string;
  layout: RecipePageLayout | null;
};

export type RecipeBookletDraft = {
  name: string;
  brand: string | null;
  makesServings: number;
  servingLabel: string;
  nutrients: Nutrients;
  ingredients: Array<{ name: string; servings: number }>;
  instructions: string;
};

const INGREDIENT_HEADING_LINE = /^\s*(ingredients|what'?s in (the )?box|in (your|the) box)\b/im;
/** Table header printed inline: "2 SERVINGS | 4 SERVINGS INGREDIENTS". */
const SERVINGS_TABLE_HEADER = /\bservings?\b.{0,40}\bINGREDIENTS\b|\b\d+\s+SERVINGS\b/;

/** Print furniture on meal-kit backs (support QR box, customize notice) — not recipe steps. */
const BOILERPLATE_SEGMENT = [
  /if you modified your meal/i,
  /card and use them as a guide/i,
  /any issues with/i,
  /your ?order\?/i,
  /we'?d ?be/i,
  /simmering like stew/i,
  /over ?there ?too/i,
  /here to get help/i,
  /scan (here|the qr)/i,
  /©\s*\d{4}/,
  /\bcorporation\b/i,
];

function pageIsCardFront(text: string, layout: RecipePageLayout | null): boolean {
  if (layout && layout.ingredients.length >= 2) return true;
  if (SERVINGS_TABLE_HEADER.test(text) && /\bINGREDIENTS\b/.test(text)) return true;
  const match = INGREDIENT_HEADING_LINE.exec(text);
  if (!match) return false;
  const after = text.slice(match.index).split(/\r?\n/).filter((line) => line.trim()).length;
  return after >= 3;
}

export function groupRecipeBookletCards(
  pageTexts: string[],
  layouts: Array<RecipePageLayout | null> | null,
): RecipeBookletCard[] {
  const cards: RecipeBookletCard[] = [];
  pageTexts.forEach((text, index) => {
    const layout = layouts?.[index] ?? null;
    if (pageIsCardFront(text, layout)) {
      cards.push({ pages: [index], front: text, back: '', layout });
      return;
    }
    const current = cards[cards.length - 1];
    if (!current) return; // cover / intro page before the first card
    current.pages.push(index);
    current.back = current.back ? `${current.back}\n\n${text}` : text;
  });
  return cards;
}

/** Booklet path applies when the pages read as recipe cards (one table card, or several cards). */
export function looksLikeRecipeBooklet(cards: RecipeBookletCard[]): boolean {
  if (cards.length >= 2) return true;
  const only = cards[0];
  return Boolean(only && only.layout && only.layout.ingredients.length >= 2);
}

/** Fix common OCR glyph confusions in kit quantities ("5o0z" → "5 oz", "¥2 cup" → "½ cup"). */
export function normalizeKitQuantity(raw: string): string {
  return raw
    .replace(/^["“”]2\b/, '½')
    .replace(/(^|\s|\()[¥YV]2(?=\s|[a-z]|$)/g, '$1½')
    .replace(/(^|\s|\()l(?=\s*(?:[o0]z|ea)\b)/g, '$11')
    .replace(/^T(?=whole\b)/, '1')
    .replace(/(\d|½)\s*[o0]?[o0]z\b/gi, '$1 oz')
    .replace(/(\d|½)\s*[o0]?[o0]2\)/g, '$1 oz)')
    .replace(/(\d|½)(cups?|whole|tsp|tbsp|units?|oz|ea)\b/gi, '$1 $2')
    .replace(/(\d)\(/g, '$1 (')
    .replace(/\s+/g, ' ')
    .trim();
}

const CLEAN_KIT_QTY = /^(\d+)?\s*([½¼¾])?\s*(oz|cups?|tsp|tbsp|whole|units?|ea)$/i;
const FRACTION_VALUE: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

function cleanQuantityValue(qty: string): { value: number; unit: string } | null {
  const match = CLEAN_KIT_QTY.exec(qty);
  if (!match || (!match[1] && !match[2])) return null;
  return { value: Number(match[1] ?? 0) + (match[2] ? FRACTION_VALUE[match[2]]! : 0), unit: match[3]! };
}

function formatQuantityValue(value: number): string | null {
  const whole = Math.floor(value);
  const rest = value - whole;
  const glyph = Object.entries(FRACTION_VALUE).find(([, fraction]) => Math.abs(fraction - rest) < 0.01)?.[0];
  if (rest < 0.01) return whole > 0 ? String(whole) : null;
  if (!glyph) return null;
  return whole > 0 ? `${whole}${glyph}` : glyph;
}

/**
 * Quantity for the first serving column. OCR often garbles small fractions
 * ("Ya oz", "1% tsp"); when another column reads cleanly, scale it by the
 * serving ratio instead (4-serving "1 cup" → 2-serving "½ cup").
 */
export function kitQuantityForFirstColumn(quantities: string[], servings: number[]): string {
  const first = normalizeKitQuantity(quantities[0] ?? '');
  if (cleanQuantityValue(first) || servings.length < 2) return first;
  for (let column = 1; column < Math.min(quantities.length, servings.length); column += 1) {
    const other = cleanQuantityValue(normalizeKitQuantity(quantities[column] ?? ''));
    if (!other || !servings[column]) continue;
    const value = (other.value * servings[0]!) / servings[column]!;
    // The garbled reading still shows its whole number ("3%2 oz" → 3½); a mismatch means the
    // other column is misread too ("1½" read as "12").
    const garbledWhole = Number(/^(\d+)/.exec(first)?.[1] ?? 0);
    if (Math.floor(value + 0.001) !== garbledWhole) continue;
    const scaled = formatQuantityValue(value);
    if (scaled) return `${scaled} ${other.unit.replace(/^units?$/i, 'unit').replace(/^cups$/i, 'cup')}`;
  }
  return first;
}

function titleCaseHeading(text: string): string {
  const lower = text.toLowerCase();
  return lower.replace(/(^|[\s(&-])([a-z])/g, (_match, lead: string, char: string) => `${lead}${char.toUpperCase()}`);
}

function isBoilerplate(segment: string): boolean {
  return BOILERPLATE_SEGMENT.some((pattern) => pattern.test(segment));
}

function letterCount(text: string): number {
  return text.replace(/[^A-Za-z]/g, '').length;
}

/** Uppercase step heading ("SEASON & COOK CHICKEN"), optionally led by an OCR'd step number/glyph. */
function stepHeading(line: string): string | null {
  const stripped = line
    .replace(/^[\s\d|)\]\[R®©.:-]{0,4}(?=[A-Z])/, '')
    .replace(/^[A-Z]\s+(?=[A-Z]{2})/, '') // stray glyph from the step-number graphic ("T PREP")
    .trim();
  const letters = stripped.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || stripped.split(/\s+/).length > 7) return null;
  if (letters !== letters.toUpperCase()) return null;
  return stripped.replace(/[^A-Za-z&'\s-]+$/, '').trim();
}

const BULLET = /^(?:[O0o©°•●▪\-–]|\(\))\s+(?=\S)/;

/**
 * Turn an OCR'd card back into numbered steps: uppercase headings start steps,
 * bullet glyphs ("O", "©") start bullet lines, other lines continue the bullet.
 */
export function cleanRecipeStepText(text: string): string {
  type Step = { heading: string | null; bullets: string[] };
  const steps: Step[] = [];
  const current = (): Step => {
    if (steps.length === 0) steps.push({ heading: null, bullets: [] });
    return steps[steps.length - 1]!;
  };
  for (const rawLine of text.split(/\r?\n/)) {
    const segments = rawLine.split(/\s+\|\s+/).map((segment) => segment.trim()).filter(Boolean);
    const kept = segments.filter((segment) => !isBoilerplate(segment));
    if (kept.length === 0) continue;
    const line = kept.join(' ').replace(/\s*[=\[\]|]+\s*$/g, '').trim();
    if (letterCount(line) < 3) continue;
    const heading = stepHeading(line);
    if (heading && !BULLET.test(line)) {
      steps.push({ heading: titleCaseHeading(heading), bullets: [] });
      continue;
    }
    const step = current();
    if (BULLET.test(line)) {
      step.bullets.push(line.replace(BULLET, ''));
    } else if (/^[*“"]/.test(line) || step.bullets.length === 0) {
      step.bullets.push(line);
    } else {
      step.bullets[step.bullets.length - 1] = `${step.bullets[step.bullets.length - 1]} ${line}`;
    }
  }
  const kept = steps.filter((step) => step.bullets.length > 0);
  const numbered = kept.some((step) => step.heading);
  return kept
    .map((step, index) => {
      const bullets = step.bullets.map((bullet) => `- ${fixStepOcr(bullet)}`).join('\n');
      if (!numbered) return bullets;
      // A first step whose heading was lost to the big step-number graphic still gets its number.
      return `${index + 1}.${step.heading ? ` ${step.heading}` : ''}\n${bullets}`;
    })
    .join('\n\n')
    .trim();
}

function fixStepOcr(text: string): string {
  return text
    .replace(/\bfo\b/g, 'to')
    .replace(/(^|\s|\()[¥YV]2(?=[\s-])/g, '$1½')
    .replace(/\s+/g, ' ')
    .trim();
}

function caloriesPerServing(text: string): number {
  const match = text.match(/calories\s+per\s+serving\s*[:\-]?\s*(\d{2,4})/i)
    ?? text.match(/(\d{2,4})\s*(?:k?cal|calories)\s+per\s+serving/i);
  return match ? Number(match[1]) : 0;
}

/** First all-caps multi-word line that is not card furniture (text fallback when no geometry title). */
function textTitle(front: string): string | null {
  for (const raw of front.split(/\r?\n/)) {
    const line = raw.replace(/^[|\s]+/, '').trim();
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length < 10 || letters !== letters.toUpperCase() || line.split(/\s+/).length < 2) continue;
    if (/servings?|ingredients|what you'?ll need|allergens|cook time|calories|customize|green chef is/i.test(line)) continue;
    return line;
  }
  return null;
}

export function buildRecipeBookletDraft(card: RecipeBookletCard): RecipeBookletDraft {
  const fullText = `${card.front}\n\n${card.back}`;
  const parsed = parseRecipeCard(card.front);
  const layout = card.layout;
  const rawTitle = layout?.title ?? textTitle(card.front) ?? parsed.title;
  const servesMatch = fullText.match(/\bserves?\s+(\d+)\b/i);
  const makesServings = layout && layout.servings.length > 0
    ? layout.servings[0]!
    : servesMatch ? Math.max(1, Number(servesMatch[1])) : 1;
  const ingredientNames = layout && layout.ingredients.length > 0
    ? layout.ingredients.map((row) => {
        const qty = kitQuantityForFirstColumn(row.quantities, layout.servings);
        const name = row.name.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
        return qty ? `${qty} ${name}` : name;
      })
    : parsed.ingredientLines;
  const instructions = card.back.trim() ? cleanRecipeStepText(card.back) : parsed.instructions;
  const nutrients = emptyNutrients();
  nutrients.calories = caloriesPerServing(fullText);
  return {
    name: rawTitle ? titleCaseHeading(rawTitle) : 'Imported recipe',
    brand: detectMealKitBrand(fullText),
    makesServings,
    servingLabel: '1 serving',
    nutrients,
    ingredients: ingredientNames.map((name) => ({ name, servings: 1 })),
    instructions,
  };
}
