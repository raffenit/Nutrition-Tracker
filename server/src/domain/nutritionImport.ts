import { assessLabelFieldReview, type LabelFieldReviewMap } from './labelFieldReview.js';
import { blocksLookLikeSeparateLabels, collectLabelPanelBlocks, splitNutritionLabelTexts } from './labelTextBlocks.js';
import { menuCandidates, parseNutritionLabel } from './parseLabel.js';
import { multiProductColumnsToFieldReview, parseMultiProductLabelTable } from './parseMultiProductLabelTable.js';
import { parseRecipeCard } from './parseRecipeCard.js';
import { parseMenuFromSource, type MenuItemDraft } from './parseMenuTable.js';
import { emptyNutrients } from './nutrients.js';
import type { Nutrients } from '../types.js';

export type NutritionImportBuildOptions = {
  /** Variety-pack geometry column count when OCR stitched fewer parseable products. */
  varietyPackExpectedColumns?: number;
};

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
  pageTexts: string[] | null = null,
  options?: NutritionImportBuildOptions,
): NutritionImportDraft {
  const expectedCols = options?.varietyPackExpectedColumns ?? 0;
  const multiProductEarly = parseMultiProductLabelTable(text);

  /** Geometry-confirmed variety pack: always surface partial panels (parsed + placeholders). */
  if (expectedCols >= 2) {
    const primary = buildNutritionImport(text, kind, html);
    return panelsFromMultiProductColumns(
      multiProductEarly ?? [],
      text,
      kind,
      primary.menuItems.length > 0 ? null : primary.warning,
      expectedCols,
    );
  }

  if (multiProductEarly && multiProductEarly.length >= 2) {
    const primary = buildNutritionImport(text, kind, html);
    return panelsFromMultiProductColumns(multiProductEarly, text, kind, primary.warning, undefined);
  }

  const primary = buildNutritionImport(text, kind, html);
  if (primary.menuItems.length > 0 || primary.recipeCard) {
    return { ...primary, labelPanels: [] };
  }
  if (primary.candidates.length > 0 && !primary.draft.nutrients.calories && !parseNutritionLabel(text).looksLikeLabel) {
    return { ...primary, labelPanels: [] };
  }
  const parts = pageTexts && pageTexts.length > 0 ? pageTexts : [text];
  const blocks = collectLabelPanelBlocks(parts);
  if (blocksLookLikeSeparateLabels(blocks)) {
    return panelsFromBlocks(blocks, text, kind, html, primary.warning);
  }
  const fallbackBlocks = splitNutritionLabelTexts(text);
  if (blocksLookLikeSeparateLabels(fallbackBlocks)) {
    return panelsFromBlocks(fallbackBlocks, text, kind, html, primary.warning);
  }
  return { ...primary, labelPanels: [] };
}

function columnHasMacroNutrients(nutrients: Nutrients): boolean {
  return nutrients.calories > 0 || nutrients.protein > 0 || nutrients.fat > 0 || nutrients.carbs > 0;
}

function panelsFromMultiProductColumns(
  columns: NonNullable<ReturnType<typeof parseMultiProductLabelTable>>,
  sourceText: string,
  kind: 'pdf' | 'html' | 'image',
  primaryWarning: string | null,
  varietyPackExpectedColumns?: number,
): NutritionImportDraft {
  const labelPanels: LabelPanelImport[] = columns.map((column, index) => {
    const readable = columnHasMacroNutrients(column.nutrients);
    return {
      index,
      preview: readable
        ? `${column.name} · ${column.nutrients.calories} kcal`
        : `${column.name} · needs review`,
      draft: {
        name: column.name,
        brand: null,
        kind: 'packaged',
        servingLabel: column.servingLabel ?? '1 serving',
        servingsPerContainer: null,
        nutrients: column.nutrients,
        isDrink: false,
        drinkMl: null,
        source: kind === 'pdf' ? 'pdf' : 'manual',
      },
      fieldReview: multiProductColumnsToFieldReview(sourceText, column),
      warning: readable
        ? null
        : 'Nutrients for this column could not be read from the photo. Enter or correct them manually.',
    };
  });

  const targetCount = Math.max(labelPanels.length, varietyPackExpectedColumns ?? 0);
  for (let i = labelPanels.length; i < targetCount; i += 1) {
    labelPanels.push(incompleteVarietyPackPanel(i, kind));
  }

  const parsedCount = columns.filter((col) => columnHasMacroNutrients(col.nutrients)).length;
  const incomplete = targetCount > parsedCount;
  const warning =
    primaryWarning ??
    (incomplete
      ? `Read ${parsedCount} of ${targetCount} products on this variety label. Pick one to edit, or import all (fill any blank slots manually).`
      : `Found ${labelPanels.length} products on one label panel. Pick one or import all.`);

  const primaryShell = buildNutritionImport(sourceText, kind);
  const draft =
    draftFromLabelPanels(labelPanels, kind) ??
    ({
      ...primaryShell.draft,
      name: '',
      kind: 'packaged',
      nutrients: { ...emptyNutrients() },
    } satisfies NutritionImportDraftBody);

  return {
    ...primaryShell,
    draft,
    menuItems: [],
    candidates: [],
    labelPanels,
    warning,
  };
}

function draftFromLabelPanels(
  panels: LabelPanelImport[],
  kind: 'pdf' | 'html' | 'image',
): NutritionImportDraftBody | null {
  const readable = panels.find(
    (panel) => !panel.warning && columnHasMacroNutrients(panel.draft.nutrients),
  );
  if (!readable) return null;
  return { ...readable.draft, source: kind === 'pdf' ? 'pdf' : 'manual' };
}

function incompleteVarietyPackPanel(
  index: number,
  kind: 'pdf' | 'html' | 'image',
): LabelPanelImport {
  const name = `Product ${index + 1}`;
  const nutrients = emptyNutrients();
  return {
    index,
    preview: `${name} · needs manual entry`,
    draft: {
      name,
      brand: null,
      kind: 'packaged',
      servingLabel: '1 serving',
      servingsPerContainer: null,
      nutrients,
      isDrink: false,
      drinkMl: null,
      source: kind === 'pdf' ? 'pdf' : 'manual',
    },
    fieldReview: assessLabelFieldReview('', {
      servingLabel: null,
      servingsPerContainer: null,
      nutrients,
      looksLikeLabel: false,
    }),
    warning: 'Could not read this column from the photo. Enter nutrition facts manually.',
  };
}

function panelsFromBlocks(
  blocks: string[],
  fallbackText: string,
  kind: 'pdf' | 'html' | 'image',
  html: string | null,
  primaryWarning: string | null,
): NutritionImportDraft {
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
    ...buildNutritionImport(blocks[0] ?? fallbackText, kind, html),
    labelPanels,
    warning: primaryWarning ?? `Found ${labelPanels.length} nutrition labels. Pick one or import all.`,
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
