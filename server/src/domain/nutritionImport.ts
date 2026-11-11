import { assessLabelFieldReview, type LabelFieldReviewMap } from './labelFieldReview.js';
import { blocksLookLikeSeparateLabels, splitNutritionLabelTexts } from './labelTextBlocks.js';
import { menuCandidates, parseNutritionLabel } from './parseLabel.js';
import { parseRecipeCard } from './parseRecipeCard.js';
import { parseMenuFromSource, type MenuItemDraft } from './parseMenuTable.js';
import type { Nutrients } from '../types.js';

export type RecipeCardImportDraft = {
  name: string;
  brand: string | null;
  makesServings: number;
  servingLabel: string;
  nutrients: Nutrients;
  ingredients: Array<{ name: string; servings: number }>;
  instructions: string;
};

export type LabelPanelImport = {
  index: number;
  preview: string;
  draft: NutritionImportDraftBody;
  fieldReview: LabelFieldReviewMap;
  warning: string | null;
};

export type NutritionImportDraftBody = {
  name: string;
  brand: string | null;
  kind: 'packaged' | 'restaurant';
  servingLabel: string;
  servingsPerContainer: number | null;
  nutrients: Nutrients;
  isDrink: boolean;
  drinkMl: null;
  source: 'pdf' | 'manual';
};

export type NutritionImportDraft = {
  draft: NutritionImportDraftBody;
  candidates: string[];
  menuItems: MenuItemDraft[];
  warning: string | null;
  fieldReview: LabelFieldReviewMap;
  recipeCard: RecipeCardImportDraft | null;
  labelPanels: LabelPanelImport[];
};

function panelPreview(block: string): string {
  const compact = block.replace(/\s+/g, ' ').trim();
  if (compact.length <= 96) return compact;
  return `${compact.slice(0, 96)}…`;
}

export function buildNutritionImportWithPanels(
  text: string,
  kind: 'pdf' | 'html' | 'image',
  html: string | null = null,
): NutritionImportDraft {
  const primary = buildNutritionImport(text, kind, html);
  if (primary.menuItems.length > 0 || primary.recipeCard) {
    return { ...primary, labelPanels: [] };
  }
  if (primary.candidates.length > 0 && !primary.draft.nutrients.calories && !parseNutritionLabel(text).looksLikeLabel) {
    return { ...primary, labelPanels: [] };
  }
  const blocks = splitNutritionLabelTexts(text);
  if (!blocksLookLikeSeparateLabels(blocks)) {
    return { ...primary, labelPanels: [] };
  }
  const labelPanels: LabelPanelImport[] = blocks.map((block, index) => {
    const built = buildNutritionImport(block, kind, html);
    return {
      index,
      preview: panelPreview(block),
      draft: { ...built.draft, source: kind === 'pdf' ? 'pdf' : 'manual' },
      fieldReview: built.fieldReview,
      warning: built.warning,
    };
  });
  return {
    ...buildNutritionImport(blocks[0] ?? text, kind, html),
    labelPanels,
    warning: primary.warning ?? `Found ${labelPanels.length} nutrition labels. Pick one or import all.`,
  };
}

export function buildNutritionImport(
  text: string,
  kind: 'pdf' | 'html' | 'image',
  html: string | null = null,
): NutritionImportDraft {
  const menuItems = parseMenuFromSource(text, kind === 'html' ? html : null);
  if (menuItems.length > 0) {
    return {
      draft: {
        name: '',
        brand: null,
        kind: 'restaurant',
        servingLabel: '1 serving',
        servingsPerContainer: null,
        nutrients: empty(),
        isDrink: false,
        drinkMl: null,
        source: kind === 'pdf' ? 'pdf' : 'manual',
      },
      candidates: menuItems.map((item) => item.name),
      menuItems,
      warning: `Found ${menuItems.length} menu items. Tap one to load its nutrition.`,
      fieldReview: {},
      recipeCard: null,
      labelPanels: [],
    };
  }

  const parsed = parseNutritionLabel(text);
  const recipeCard = buildRecipeCardDraft(text, parsed);
  const fieldReview = assessLabelFieldReview(text, parsed);
  let warning: string | null = null;
  if (recipeCard) {
    warning = 'Found a recipe card with ingredients and instructions. Review below, then save as a recipe.';
  } else if (!text.trim()) {
    warning = 'No text was found. Enter nutrition values yourself.';
  } else if (/nutrition facts/i.test(text) && parsed.nutrients.calories === 0 && parsed.nutrients.protein === 0) {
    warning = 'Found a Nutrition Facts section but could not read the numbers. Edit the fields below.';
  } else if (kind === 'html' && !parsed.looksLikeLabel && !/nutrition facts/i.test(text)) {
    warning = 'This page may need JavaScript in a browser to show nutrition. Try a direct PDF link or a photo of the label.';
  }
  const foodKind = kind === 'pdf' && !parsed.looksLikeLabel ? 'restaurant' : 'packaged';
  return {
    draft: {
      name: '',
      brand: null,
      kind: foodKind,
      servingLabel: parsed.servingLabel ?? '1 serving',
      servingsPerContainer: parsed.servingsPerContainer,
      nutrients: parsed.nutrients,
      isDrink: false,
      drinkMl: null,
      source: kind === 'pdf' ? 'pdf' : 'manual',
    },
    candidates: parsed.looksLikeLabel ? [] : menuCandidates(text),
    menuItems: [],
    warning,
    fieldReview,
    recipeCard,
    labelPanels: [],
  };
}

function buildRecipeCardDraft(
  text: string,
  nutrition: ReturnType<typeof parseNutritionLabel>,
): RecipeCardImportDraft | null {
  const card = parseRecipeCard(text);
  if (!card.looksLikeRecipeCard) return null;
  const name = card.title ?? 'Imported recipe';
  const servesMatch = text.match(/\bserves?\s+(\d+)\b/i);
  const makesServings = servesMatch ? Math.max(1, Number(servesMatch[1])) : 1;
  return {
    name,
    brand: card.brand,
    makesServings,
    servingLabel: nutrition.servingLabel ?? '1 serving',
    nutrients: nutrition.nutrients,
    ingredients: card.ingredientLines.map((line) => ({ name: line, servings: 1 })),
    instructions: card.instructions,
  };
}

function empty(): Nutrients {
  return { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [] };
}
