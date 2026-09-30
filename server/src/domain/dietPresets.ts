import type { Targets } from '../types.js';

export type DietPresetPublic = {
  id: string;
  name: string;
  summary: string;
  sourceLabel: string;
  sourceUrl: string;
};

export type DietPreset = DietPresetPublic & {
  patch: DietPresetPatch;
};

/** Macro and limit fields applied on top of the user's display preferences. */
export type DietPresetPatch = Pick<
  Targets,
  'calories' | 'protein' | 'fiber' | 'fat' | 'carbs' | 'sodium' | 'hydrationMl' | 'extras' | 'sodiumIsLimit' | 'carbsIsLimit'
>;

const SAT_FAT = (grams: number) => ({
  key: 'saturated_fat',
  label: 'Saturated fat',
  amount: grams,
  unit: 'g',
});

export const DIET_PRESETS: DietPreset[] = [
  {
    id: 'balanced',
    name: 'Balanced (2000 kcal)',
    summary: 'General USDA-style reference pattern for maintenance.',
    sourceLabel: 'U.S. Dietary Guidelines',
    sourceUrl: 'https://www.dietaryguidelines.gov/',
    patch: {
      calories: 2000,
      protein: 75,
      fiber: 28,
      fat: 65,
      carbs: 260,
      sodium: 2300,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [],
    },
  },
  {
    id: 'dash',
    name: 'DASH',
    summary: 'Emphasizes produce, lean protein, and low-fat dairy; standard sodium cap.',
    sourceLabel: 'NIH NHLBI DASH plan',
    sourceUrl: 'https://www.nhlbi.nih.gov/education/dash-eating-plan',
    patch: {
      calories: 2000,
      protein: 91,
      fiber: 30,
      fat: 60,
      carbs: 275,
      sodium: 2300,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [SAT_FAT(13)],
    },
  },
  {
    id: 'dash-low-sodium',
    name: 'DASH · lower sodium',
    summary: 'Same DASH macro pattern with a 1,500 mg sodium ceiling.',
    sourceLabel: 'NIH NHLBI DASH plan',
    sourceUrl: 'https://www.nhlbi.nih.gov/education/dash-eating-plan',
    patch: {
      calories: 2000,
      protein: 91,
      fiber: 30,
      fat: 60,
      carbs: 275,
      sodium: 1500,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [SAT_FAT(13)],
    },
  },
  {
    id: 'low-sodium',
    name: 'Low sodium',
    summary: 'Heart-friendly sodium cap with moderate macros; adjust calories with your clinician.',
    sourceLabel: 'FDA / AHA sodium guidance',
    sourceUrl: 'https://www.fda.gov/food/nutrition-education-resources-materials/sodium-your-diet',
    patch: {
      calories: 2000,
      protein: 80,
      fiber: 28,
      fat: 65,
      carbs: 250,
      sodium: 1500,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [],
    },
  },
  {
    id: 'mediterranean',
    name: 'Mediterranean',
    summary: 'Higher unsaturated fat, ample produce and fiber; moderate sodium cap.',
    sourceLabel: 'Harvard Nutrition Source',
    sourceUrl: 'https://nutritionsource.hsph.harvard.edu/healthy-weight/diet-reviews/mediterranean-diet/',
    patch: {
      calories: 2000,
      protein: 75,
      fiber: 30,
      fat: 78,
      carbs: 225,
      sodium: 2300,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [SAT_FAT(15)],
    },
  },
  {
    id: 'anti-inflammatory',
    name: 'Anti-inflammatory',
    summary: 'Mediterranean-leaning pattern with higher fiber and tighter saturated fat.',
    sourceLabel: 'Harvard Nutrition Source',
    sourceUrl: 'https://nutritionsource.hsph.harvard.edu/healthy-eating-plate/',
    patch: {
      calories: 2000,
      protein: 80,
      fiber: 35,
      fat: 72,
      carbs: 220,
      sodium: 2300,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [SAT_FAT(12)],
    },
  },
  {
    id: 'diabetic-friendly',
    name: 'Diabetes-friendly',
    summary: 'Carb ceiling with fiber and sodium limits; not a substitute for medical meal planning.',
    sourceLabel: 'American Diabetes Association',
    sourceUrl: 'https://diabetes.org/food-nutrition',
    patch: {
      calories: 1800,
      protein: 90,
      fiber: 25,
      fat: 60,
      carbs: 175,
      sodium: 2300,
      sodiumIsLimit: true,
      carbsIsLimit: true,
      hydrationMl: 2000,
      extras: [SAT_FAT(18)],
    },
  },
  {
    id: 'ibs-friendly',
    name: 'IBS-friendly (macro guide)',
    summary: 'Gentler fiber target; this app does not track FODMAPs—use with a clinician or Monash list.',
    sourceLabel: 'Monash University (FODMAP program)',
    sourceUrl: 'https://www.monashfodmap.com/',
    patch: {
      calories: 1900,
      protein: 75,
      fiber: 20,
      fat: 62,
      carbs: 240,
      sodium: 2300,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [],
    },
  },
  {
    id: 'heart-healthy',
    name: 'Heart-healthy',
    summary: 'Lower saturated fat and sodium with higher fiber.',
    sourceLabel: 'American Heart Association',
    sourceUrl: 'https://www.heart.org/en/healthy-living/healthy-eating',
    patch: {
      calories: 2000,
      protein: 80,
      fiber: 32,
      fat: 58,
      carbs: 255,
      sodium: 1500,
      sodiumIsLimit: true,
      carbsIsLimit: false,
      hydrationMl: 2000,
      extras: [SAT_FAT(11)],
    },
  },
];

export function listDietPresetsPublic(): DietPresetPublic[] {
  return DIET_PRESETS.map(({ id, name, summary, sourceLabel, sourceUrl }) => ({
    id,
    name,
    summary,
    sourceLabel,
    sourceUrl,
  }));
}

export function dietPresetById(id: string): DietPreset | null {
  return DIET_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function applyDietPreset(current: Targets, preset: DietPreset): Targets {
  return {
    ...current,
    ...preset.patch,
    extras: preset.patch.extras.map((extra) => ({ ...extra })),
  };
}
