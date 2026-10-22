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
