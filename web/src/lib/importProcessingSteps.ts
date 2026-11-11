/** Server-side import phases — pattern-based copy, not product-specific. */

export type ImportProcessStep = {
  short: string;
  message: string;
  detail: string;
};

export const IMAGE_IMPORT_STEPS: ImportProcessStep[] = [
  {
    short: 'Prepare',
    message: 'Preparing image for OCR…',
    detail: 'Auto-rotate, upscale, and contrast — shared preprocessing before any reader runs.',
  },
  {
    short: 'Read text',
    message: 'Reading the Nutrition Facts panel…',
    detail: 'Neural OCR and classic Tesseract on several preprocessed copies of your photo.',
  },
  {
    short: 'More passes',
    message: 'Trying alternate crops and contrast…',
    detail: 'Glossy or curved labels often need extra passes; this can take up to a minute.',
  },
  {
    short: 'Row match',
    message: 'Matching label rows…',
    detail: 'Searching for row names like Fat, Sodium, and Protein — not guessing calorie numbers.',
  },
  {
    short: 'Units',
    message: 'Reading amounts beside g and mg…',
    detail: 'Picking values that sit next to the expected unit for each row.',
  },
  {
    short: 'Draft',
    message: 'Building your draft…',
    detail: 'Combining the best value per nutrient from all OCR results.',
  },
];

export const PDF_IMPORT_STEPS: ImportProcessStep[] = [
  {
    short: 'PDF',
    message: 'Reading PDF on server…',
    detail: 'Extracting embedded text from your document.',
  },
  {
    short: 'OCR',
    message: 'Scanning pages if needed…',
    detail: 'Menus and scans without a text layer are rasterized and sent through OCR — large files can take up to a minute.',
  },
  {
    short: 'Parse',
    message: 'Looking for nutrition facts…',
    detail: 'Detecting label layout or menu tables in the text.',
  },
  {
    short: 'Draft',
    message: 'Building your draft…',
    detail: 'Filling fields where structure matches a nutrition panel.',
  },
];

/** Meal-kit recipe card import (PDF — may rasterize + OCR). */
export const RECIPE_CARD_PDF_IMPORT_STEPS: ImportProcessStep[] = [
  {
    short: 'PDF',
    message: 'Opening recipe card PDF…',
    detail: 'Reading embedded text or preparing scanned pages for OCR.',
  },
  {
    short: 'OCR',
    message: 'Reading ingredients and steps…',
    detail: 'Scanned recipe cards often need a full-page OCR pass — this can take up to a minute.',
  },
  {
    short: 'Sections',
    message: 'Finding Ingredients and Instructions…',
    detail: 'Matching layout patterns for kit-style cards, not a specific brand.',
  },
  {
    short: 'Nutrition',
    message: 'Parsing nutrition panel…',
    detail: 'Pulling per-serving macros when a Nutrition Facts block is present.',
  },
  {
    short: 'Draft',
    message: 'Building your recipe draft…',
    detail: 'Combining ingredient lines, steps, and nutrition for review.',
  },
];

/** Meal-kit recipe card import (photo). */
export const RECIPE_CARD_IMAGE_IMPORT_STEPS: ImportProcessStep[] = [
  {
    short: 'Prepare',
    message: 'Preparing photo for OCR…',
    detail: 'Auto-rotate, upscale, and contrast before reading the card.',
  },
  {
    short: 'Read',
    message: 'Reading recipe card text…',
    detail: 'Neural OCR and classic Tesseract on several preprocessed copies.',
  },
  {
    short: 'More passes',
    message: 'Trying alternate crops…',
    detail: 'Glossy or curved cards may need extra passes — up to a minute.',
  },
  {
    short: 'Sections',
    message: 'Finding Ingredients and Instructions…',
    detail: 'Splitting the text into shopping lines and cooking steps.',
  },
  {
    short: 'Draft',
    message: 'Building your recipe draft…',
    detail: 'Filling ingredients, steps, and nutrition when detected.',
  },
];

export const URL_IMPORT_STEPS: ImportProcessStep[] = [
  {
    short: 'Fetch',
    message: 'Fetching link…',
    detail: 'Loading the page from your server (private network).',
  },
  {
    short: 'Read',
    message: 'Reading page content…',
    detail: 'Pulling text and tables from the response.',
  },
  {
    short: 'Parse',
    message: 'Looking for nutrition facts…',
    detail: 'Matching label or menu patterns in the HTML.',
  },
  {
    short: 'Draft',
    message: 'Almost done…',
    detail: 'Preparing import results for review.',
  },
];

export function formatUploadBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
