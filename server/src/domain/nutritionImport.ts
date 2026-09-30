import { menuCandidates, parseNutritionLabel } from './parseLabel.js';
import { parseMenuFromSource, type MenuItemDraft } from './parseMenuTable.js';
import type { Nutrients } from '../types.js';

export type NutritionImportDraft = {
  draft: {
    name: string;
    brand: string | null;
    kind: 'packaged' | 'restaurant';
    servingLabel: string;
    nutrients: Nutrients;
    isDrink: boolean;
    drinkMl: null;
    source: 'pdf' | 'manual';
  };
  candidates: string[];
  menuItems: MenuItemDraft[];
  warning: string | null;
};

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
        nutrients: empty(),
        isDrink: false,
        drinkMl: null,
        source: kind === 'pdf' ? 'pdf' : 'manual',
      },
      candidates: menuItems.map((item) => item.name),
      menuItems,
      warning: `Found ${menuItems.length} menu items. Tap one to load its nutrition.`,
    };
  }

  const parsed = parseNutritionLabel(text);
  let warning: string | null = null;
  if (!text.trim()) {
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
      nutrients: parsed.nutrients,
      isDrink: false,
      drinkMl: null,
      source: kind === 'pdf' ? 'pdf' : 'manual',
    },
    candidates: parsed.looksLikeLabel ? [] : menuCandidates(text),
    menuItems: [],
    warning,
  };
}

function empty(): Nutrients {
  return { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [] };
}
