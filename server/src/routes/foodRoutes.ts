import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import Busboy from 'busboy';
import { attachUpload, findUpload, insertUpload } from '../db/uploads.js';
import { deleteFood, getFood, insertFood, listFoods, setFavorite, updateFood, type FoodShelf } from '../db/foods.js';
import { perServing, sumIngredientNutrients } from '../domain/compose.js';
import { mergeRecipeIngredientsWithEcosystem } from '../domain/recipeEcosystem.js';
import type { RecipePageLayout } from '../domain/recipeCardLayout.js';
import { favoriteOnly, readFoodInput } from '../domain/foodInput.js';
import { isRecord, optionalText, requiredNumber, requiredText } from '../domain/guards.js';
import { readComponentRole, readProteinTags } from '../domain/proteinTags.js';
import { applySlotMergedNutrients, emptyNutrients, readNutrients, roundNutrients } from '../domain/nutrients.js';
import { DEFAULT_CORE_NUTRIENT_UNITS } from '../domain/nutrientUnits.js';
import { buildNutritionImportWithPanels, type NutritionImportDraft } from '../domain/nutritionImport.js';
import {
  failImportJob,
  finishImportJob,
  getImportJobForUser,
  parseImportJobId,
  reportImportJobStep,
  appendImportJobDebug,
  runWithImportJob,
} from '../import/importJobProgress.js';
import { extractImageLabel } from '../integrations/extractText.js';
import { importNutritionFromUrl } from '../integrations/importUrl.js';
import { importNutritionFromUrlWithImageFallback } from '../integrations/urlLabelImages.js';
import { searchOpenFoodFacts } from '../integrations/openFoodFacts.js';
import { searchUsda } from '../integrations/usda.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import type { Food, Nutrients, SearchHit } from '../types.js';
import type { LabelServingFields } from '../domain/labelServingVote.js';

// Scanned recipe-card PDFs (multi-page, no text layer) legitimately reach
// ~40 MB per file; 64 MB covers those while still bounding memory (busboy
// buffers the upload in RAM).
const MAX_UPLOAD = 64 * 1024 * 1024;

export function foodRoutes(): Route[] {
  return [
    route('GET', '/api/foods', async (ctx) => {
      requireUser(ctx.auth);
      sendJson(ctx.res, 200, { foods: listFoods(ctx.db, ctx.url.searchParams.get('q')?.trim() ?? '', readShelf(ctx.url.searchParams.get('shelf'))) });
    }),
    route('GET', '/api/foods/:id', async (ctx) => {
      requireUser(ctx.auth);
      const food = getFood(ctx.db, ctx.params.id);
      if (!food) throw new HttpError(404, 'Food not found');
      sendJson(ctx.res, 200, { food });
    }),
    route('POST', '/api/foods', saveNewFood),
    route('POST', '/api/foods/stubs', createStubFoods),
    route('PATCH', '/api/foods/:id', patchFood),
    route('DELETE', '/api/foods/:id', async (ctx) => {
      requireUser(ctx.auth);
      if (!deleteFood(ctx.db, ctx.params.id)) throw new HttpError(404, 'Food not found');
      sendJson(ctx.res, 200, { ok: true });
    }),
    route('POST', '/api/foods/compose', composeFood),
    route('GET', '/api/ingredients/search', searchIngredients),
    route('POST', '/api/uploads', receiveUpload),
    route('POST', '/api/import-url', importFromUrl),
    route('GET', '/api/import-jobs/:id', readImportJob),
  ];
}

async function readImportJob(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const snapshot = getImportJobForUser(ctx.params.id, user.id);
  if (!snapshot) throw new HttpError(404, 'Import job not found');
  sendJson(ctx.res, 200, snapshot);
}

async function saveNewFood(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  const food = insertFood(ctx.db, readFoodInput(body, user.id));
  const uploadId = isRecord(body) ? body.uploadId : null;
  if (typeof uploadId === 'string') attachOwnedUpload(ctx, uploadId, food.id);
  sendJson(ctx.res, 201, { food });
}

async function createStubFoods(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body) || !Array.isArray(body.names)) throw new HttpError(400, 'Expected a list of names');
  const names = body.names
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (names.length === 0) throw new HttpError(400, 'Choose at least one name');
  if (names.length > 40) throw new HttpError(400, 'At most 40 placeholders at once');
  const source = body.source === 'pdf' ? 'pdf' : 'manual';
  const foods: Food[] = [];
  for (const name of names) {
    const food = insertFood(ctx.db, {
      createdBy: user.id,
      name,
      brand: null,
      kind: 'restaurant',
      servingLabel: '1 serving',
      servingsPerContainer: null,
      nutrients: emptyStubNutrients(),
      nutrientUnits: { ...DEFAULT_CORE_NUTRIENT_UNITS },
      isFavorite: false,
      isDrink: false,
      drinkMl: null,
      makesServings: 1,
      source,
      sourceRef: null,
      instructions: null,
      mealKitEcosystemId: null,
      proteinTags: [],
      ingredients: [],
    });
    foods.push(food);
  }
  const uploadId = body.uploadId;
  if (typeof uploadId === 'string' && foods[0]) attachOwnedUpload(ctx, uploadId, foods[0].id);
  sendJson(ctx.res, 201, { foods, count: foods.length });
}

function emptyStubNutrients(): Food['nutrients'] {
  return { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [] };
}

async function patchFood(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  const favorite = favoriteOnly(body);
  if (favorite !== null) {
    const food = setFavorite(ctx.db, ctx.params.id, favorite);
    if (!food) throw new HttpError(404, 'Food not found');
    sendJson(ctx.res, 200, { food });
    return;
  }
  let input = readFoodInput(body, user.id);
  input = recomputeRecipeNutrients(ctx, body, input);
  const food = updateFood(ctx.db, ctx.params.id, input);
  if (!food) throw new HttpError(404, 'Food not found');
  sendJson(ctx.res, 200, { food });
}

async function composeFood(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body) || !Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    throw new HttpError(400, 'Add at least one ingredient');
  }
  const parsedLines = body.ingredients.map((line) => ingredientLine(ctx, line));
  const ecosystemId = optionalText(body.mealKitEcosystemId);
  const ingredientRows = mergeRecipeIngredientsWithEcosystem(
    ctx.db,
    ecosystemId,
    parsedLines.map(({ nutrients: _nutrients, hasNutrition: _hasNutrition, ...line }) => line),
  );
  const makesServings = requiredNumber(body.makesServings, 'Servings');
  const label = isRecord(body.nutrients) ? roundNutrients(readNutrients(body.nutrients)) : null;
  const nutrients = recipeNutrients(parsedLines, makesServings, label);
  const instructions = optionalInstructions(body.instructions);
  const food = insertFood(ctx.db, {
    createdBy: user.id,
    name: requiredText(body.name, 'Name'),
    brand: optionalText(body.brand),
    kind: 'custom',
    servingLabel: typeof body.servingLabel === 'string' && body.servingLabel.trim()
      ? body.servingLabel.trim()
      : '1 serving',
    servingsPerContainer: null,
    nutrients,
    nutrientUnits: { ...DEFAULT_CORE_NUTRIENT_UNITS },
    isFavorite: body.isFavorite === true,
    isDrink: false,
    drinkMl: null,
    makesServings,
    source: 'composed',
    sourceRef: null,
    instructions,
    mealKitEcosystemId: ecosystemId,
    proteinTags: readProteinTags(body.proteinTags),
    ingredients: ingredientRows,
  });
  sendJson(ctx.res, 201, { food });
}

async function searchIngredients(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const query = ctx.url.searchParams.get('q')?.trim() ?? '';
  const usdaState = ctx.config.usdaApiKey ? 'ready' : 'missing_key';
  if (query.length < 2) {
    sendJson(ctx.res, 200, { results: [], usda: usdaState });
    return;
  }
  const libraryOnly = ctx.url.searchParams.get('library') === '1';
  const results = [...libraryHits(ctx, query, libraryOnly), ...await remoteHits(ctx, query)];
  sendJson(ctx.res, 200, { results, usda: usdaState });
}

async function receiveUpload(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const jobId = parseImportJobId(ctx.req.headers, null);
  const file = await readUpload(ctx);
  const kind = uploadKind(file.mime, file.filename);
  if (!kind) throw new HttpError(400, 'Upload a JPEG, PNG, WEBP, or PDF');
  const flow = kind === 'pdf' ? 'pdf' : 'image';
  const uploadLabel = `${path.basename(file.filename).replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 80) || 'upload'} (${kind}, ${(file.bytes.length / 1024 / 1024).toFixed(1)} MB)`;
  const startedAt = Date.now();
  const elapsed = () => `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
  console.log(`[upload] received ${uploadLabel}`);
  try {
    await runWithImportJob(jobId, user.id, flow, async () => {
      reportImportJobStep('Receive', 'File received…', path.basename(file.filename).slice(0, 180) || 'upload');
      const storedName = `${randomUUID()}${kind === 'pdf' ? '.pdf' : extensionFor(file.filename)}`;
      await writeFile(path.join(ctx.config.uploadDir, storedName), file.bytes);
      const extracted = await readExtractedText(kind, file.bytes, ctx.config);
      reportImportJobStep(
        'Draft',
        extracted.pageLayouts?.some((layout) => layout && layout.ingredients.length >= 2) ? 'Building recipe drafts…' : 'Building your draft…',
        extracted.pageLayouts ? undefined : 'Applying parsers and import panels.',
      );
      const built = buildNutritionImportWithPanels(extracted.text, kind, null, extracted.pageTexts, {
        varietyPackExpectedColumns: extracted.varietyPackExpectedColumns,
        recipePageLayouts: extracted.pageLayouts,
      });
      const varietyPackPanels =
        (extracted.varietyPackExpectedColumns ?? 0) >= 2 && built.labelPanels.length > 0;
      if (extracted.slotMergedNutrients && !varietyPackPanels) {
        applySlotMergedNutrients(built.draft.nutrients, extracted.slotMergedNutrients);
      }
      if (extracted.serving && !varietyPackPanels) applyVotedServing(built.draft, extracted.serving);
      const warning = [extracted.warning, built.warning].filter(Boolean).join(' ') || null;
      const saved = insertUpload(ctx.db, {
        kind,
        originalName: path.basename(file.filename).slice(0, 180) || 'upload',
        storedName,
        extractedText: extracted.text,
        createdBy: user.id,
      });
      finishImportJob(jobId);
      console.log(
        `[upload] done ${uploadLabel} in ${elapsed()}: ocr=${extracted.usedOcr ? 'yes' : 'no'}, recipe cards=${built.recipeCards?.length ?? (built.recipeCard ? 1 : 0)}, text chars=${extracted.text.length}${warning ? `, warning: ${warning}` : ''}`,
      );
      sendImportJson(ctx.res, {
        uploadId: saved.id,
        kind,
        warning,
        textPreview: previewExtractedText(extracted.text),
        built,
        sourceKind: kind,
        usedOcr: extracted.usedOcr ?? false,
      });
    });
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Import failed';
    console.error(`[upload] failed ${uploadLabel} after ${elapsed()}: ${error instanceof Error ? error.message : String(error)}`);
    failImportJob(jobId, message);
    throw error;
  }
}

async function importFromUrl(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a URL');
  const url = requiredText(body.url, 'URL');
  const jobId = parseImportJobId(ctx.req.headers, body);
  try {
    await runWithImportJob(jobId, user.id, 'url', async () => {
      reportImportJobStep('Request', 'Sending import request…', url.slice(0, 120));
      const fetched = await importNutritionFromUrl(url);
      reportImportJobStep('Draft', 'Building your draft…', 'Preparing import results for review.');
      let text = fetched.text;
      let kind: 'pdf' | 'html' | 'image' = fetched.kind;
      let html = fetched.html;
      let built = buildNutritionImportWithPanels(text, kind, html);
      let usedOcr = false;
      if (!importDraftHasNutrition(built)) {
        const fallback = await importNutritionFromUrlWithImageFallback(fetched, {
          extractImageLabel,
          tessdataDir: ctx.config.tessdataDir,
          easyocrModelDir: ctx.config.easyocrEnabled ? ctx.config.easyocrModelDir : undefined,
          textYieldsNutrition: () => false,
        });
        if (fallback.usedOcr && fallback.imageUrl) {
          const ocrBuilt = buildNutritionImportWithPanels(fallback.text, 'image', null);
          if (importDraftHasNutrition(ocrBuilt)) {
            text = fallback.text;
            kind = 'image';
            html = null;
            built = ocrBuilt;
            usedOcr = true;
            appendImportJobDebug(`url import: page text had no nutrition; OCR fallback read label image ${fallback.imageUrl}`);
          }
        }
      }
      finishImportJob(jobId);
      sendImportJson(ctx.res, {
        uploadId: null,
        kind,
        finalUrl: fetched.finalUrl,
        warning: [
          usedOcr ? 'Nutrition label was read from an image on the page (OCR) — review carefully.' : null,
          built.warning,
        ].filter(Boolean).join(' ') || null,
        textPreview: previewExtractedText(text),
        built,
        sourceKind: kind,
        usedOcr,
      });
    });
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Import failed';
    failImportJob(jobId, message);
    throw error;
  }
}

function importDraftHasNutrition(built: NutritionImportDraft): boolean {
  const n = built.draft.nutrients;
  return (
    (n.calories ?? 0) > 0 ||
    (n.protein ?? 0) > 0 ||
    (n.fat ?? 0) > 0 ||
    (n.carbs ?? 0) > 0 ||
    built.candidates.length > 0 ||
    built.menuItems.length > 0
  );
}

type ImportJsonBody = {
  uploadId: string | null;
  kind: 'pdf' | 'image' | 'html';
  warning: string | null;
  textPreview: string | null;
  built: NutritionImportDraft;
  sourceKind: 'pdf' | 'image' | 'html';
  finalUrl?: string;
  usedOcr?: boolean;
};

function sendImportJson(
  res: import('node:http').ServerResponse,
  body: ImportJsonBody,
): void {
  const draftSource = body.sourceKind === 'pdf' ? 'pdf' : body.sourceKind === 'image' ? 'image' : 'manual';
  sendJson(res, 200, {
    uploadId: body.uploadId,
    kind: body.kind === 'html' ? 'html' : body.kind,
    finalUrl: body.finalUrl,
    warning: body.warning ?? body.built.warning,
    textPreview: body.textPreview,
    draft: { ...body.built.draft, source: draftSource },
    candidates: body.built.candidates,
    menuItems: body.built.menuItems,
    fieldReview: body.built.fieldReview,
    recipeCard: body.built.recipeCard,
    recipeCards: body.built.recipeCards ?? (body.built.recipeCard ? [body.built.recipeCard] : []),
    labelPanels: body.built.labelPanels,
    usedOcr: body.usedOcr,
  });
}

function previewExtractedText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > 2400 ? `${trimmed.slice(0, 2400)}…` : trimmed;
}

function attachOwnedUpload(ctx: Ctx, uploadId: string, foodId: string): void {
  const upload = findUpload(ctx.db, uploadId);
  if (!upload || upload.createdBy !== requireUser(ctx.auth).id) throw new HttpError(404, 'Upload not found');
  attachUpload(ctx.db, uploadId, foodId);
}

function ingredientLine(ctx: Ctx, value: unknown): {
  name: string;
  servings: number;
  nutrients: ReturnType<typeof readNutrients>;
  /** False for text-only lines (e.g. imported meal-kit rows) that carry no nutrition. */
  hasNutrition: boolean;
  sourceRef: string | null;
  childFoodId: string | null;
  componentRole: 'main' | 'side' | null;
  shopEquivalentFoodId: string | null;
  shopEquivalentLabel: string | null;
} {
  if (!isRecord(value)) throw new HttpError(400, 'Each ingredient needs a name');
  const servings = requiredNumber(value.servings, 'Ingredient amount');
  if (servings <= 0) throw new HttpError(400, 'Ingredient amount must be greater than zero');
  const shopEquivalentFoodId = optionalText(value.shopEquivalentFoodId);
  const shopEquivalentLabel = optionalText(value.shopEquivalentLabel);
  const childFoodId = typeof value.foodId === 'string' ? value.foodId : null;
  const componentRole = readComponentRole(value.componentRole);
  if (childFoodId) {
    const food = getFood(ctx.db, childFoodId);
    if (!food) throw new HttpError(400, 'Unknown ingredient');
    return {
      name: food.name,
      servings,
      nutrients: food.nutrients,
      hasNutrition: true,
      sourceRef: food.sourceRef,
      childFoodId,
      componentRole,
      shopEquivalentFoodId,
      shopEquivalentLabel,
    };
  }
  return {
    name: requiredText(value.name, 'Ingredient'),
    servings,
    nutrients: value.nutrients == null ? emptyNutrients() : readNutrients(value.nutrients),
    hasNutrition: value.nutrients != null,
    sourceRef: typeof value.sourceRef === 'string' ? value.sourceRef : null,
    childFoodId: null,
    componentRole,
    shopEquivalentFoodId,
    shopEquivalentLabel,
  };
}

function libraryHits(ctx: Ctx, query: string, ingredientsOnly: boolean): SearchHit[] {
  const shelf: FoodShelf = ingredientsOnly ? 'foods' : 'all';
  return listFoods(ctx.db, query, shelf).slice(0, 8).map(foodHit);
}

function readShelf(value: string | null): FoodShelf {
  if (value === 'foods' || value === 'recipes' || value === 'all') return value;
  return 'all';
}

function recomputeRecipeNutrients(ctx: Ctx, body: unknown, input: ReturnType<typeof readFoodInput>): ReturnType<typeof readFoodInput> {
  if (input.kind !== 'custom' || !isRecord(body) || !Array.isArray(body.ingredients) || body.ingredients.length === 0) {
    return input;
  }
  const lines = body.ingredients.map((line) => ingredientLine(ctx, line));
  const nutrients = recipeNutrients(lines, input.makesServings, input.nutrients);
  const baseIngredients = lines.map(({ name, servings, sourceRef, childFoodId, componentRole, shopEquivalentFoodId, shopEquivalentLabel }) => ({
    name,
    servings,
    sourceRef,
    childFoodId,
    componentRole,
    shopEquivalentFoodId,
    shopEquivalentLabel,
  }));
  const ingredients = mergeRecipeIngredientsWithEcosystem(ctx.db, input.mealKitEcosystemId, baseIngredients);
  return {
    ...input,
    nutrients,
    ingredients,
  };
}

async function remoteHits(ctx: Ctx, query: string): Promise<SearchHit[]> {
  const usda = ctx.config.usdaApiKey ? await searchUsda(query, ctx.config.usdaApiKey).catch(() => []) : [];
  const packaged = ctx.config.openFoodFactsEnabled ? await searchOpenFoodFacts(query).catch(() => []) : [];
  return [...usda, ...packaged];
}

function foodHit(food: Food): SearchHit {
  return {
    name: food.name,
    brand: food.brand,
    servingLabel: food.servingLabel,
    nutrients: food.nutrients,
    source: 'library',
    sourceRef: food.sourceRef,
    foodId: food.id,
  };
}

function uploadKind(mime: string, filename: string): 'image' | 'pdf' | null {
  const name = filename.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(name)) return 'image';
  return null;
}

function extensionFor(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith('.png')) return '.png';
  if (name.endsWith('.webp')) return '.webp';
  return '.jpg';
}

async function readExtractedText(
  kind: 'image' | 'pdf',
  bytes: Buffer,
  config: { tessdataDir: string; easyocrModelDir: string; easyocrEnabled: boolean },
): Promise<{
  text: string;
  warning: string | null;
  slotMergedNutrients: Nutrients | null;
  usedOcr?: boolean;
  pageTexts: string[] | null;
  pageLayouts?: Array<RecipePageLayout | null> | null;
  varietyPackExpectedColumns?: number;
  serving?: LabelServingFields;
}> {
  try {
    if (kind === 'pdf') {
      const { extractPdfTextWithOcrFallback } = await import('../integrations/ocrScannedPdf.js');
      const { text, usedOcr, pageTexts, pageLayouts } = await extractPdfTextWithOcrFallback(
        bytes,
        config.tessdataDir,
        config.easyocrEnabled ? config.easyocrModelDir : undefined,
      );
      let warning: string | null = null;
      if (!text.trim()) warning = 'No text was found. Enter the nutrition facts yourself.';
      else if (usedOcr) warning = 'Scanned PDF — text came from OCR. Review ingredients and instructions carefully.';
      return { text, warning, slotMergedNutrients: null, usedOcr, pageTexts, pageLayouts };
    }
    const { text, slotMergedNutrients, varietyPackExpectedColumns, serving } = await extractImageLabel(
      bytes,
      config.tessdataDir,
      {
        easyocrModelDir: config.easyocrEnabled ? config.easyocrModelDir : undefined,
      },
    );
    return {
      text,
      warning: text.trim() ? null : 'No text was found. Enter the nutrition facts yourself.',
      slotMergedNutrients,
      pageTexts: null,
      varietyPackExpectedColumns,
      serving,
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    const stage = kind === 'pdf' ? 'readExtractedText:pdf' : 'readExtractedText:image';
    appendImportJobDebug(`${stage}: failed (${reason})`);
    console.error(`[${stage}]`, error);
    return {
      text: '',
      warning: 'The file is saved, and the text could not be read. Enter the nutrition facts yourself.',
      slotMergedNutrients: null,
      pageTexts: null,
    };
  }
}

/** Ingredient totals when every line has nutrition; otherwise the recipe's label (e.g. a meal-kit card) when it has one. */
function recipeNutrients(lines: Array<{ servings: number; nutrients: Nutrients; hasNutrition: boolean }>, makesServings: number, label: Nutrients | null): Nutrients {
  const fromIngredients = roundNutrients(perServing(sumIngredientNutrients(lines), makesServings));
  const complete = lines.every((line) => line.hasNutrition);
  if (complete && hasMacroTotals(fromIngredients)) return fromIngredients;
  return label && hasAnyNutrient(label) ? label : fromIngredients;
}

function hasAnyNutrient(nutrients: Nutrients): boolean {
  return hasMacroTotals(nutrients) || nutrients.fiber > 0 || nutrients.sodium > 0;
}

function hasMacroTotals(nutrients: Nutrients): boolean {
  return nutrients.calories > 0 || nutrients.protein > 0 || nutrients.fat > 0 || nutrients.carbs > 0;
}

function optionalInstructions(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readUpload(ctx: Ctx): Promise<{ filename: string; mime: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const parser = Busboy({ headers: ctx.req.headers, limits: { files: 1, fileSize: MAX_UPLOAD } });
    let file: { filename: string; mime: string; bytes: Buffer } | null = null;
    let tooBig = false;
    parser.on('file', (_name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on('limit', () => { tooBig = true; });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('close', () => { file = { filename: info.filename, mime: info.mimeType, bytes: Buffer.concat(chunks) }; });
    });
    parser.on('error', reject);
    parser.on('finish', () => {
      if (tooBig) reject(new HttpError(413, 'File is larger than 64 MB'));
      else if (!file) reject(new HttpError(400, 'Choose a file'));
      else resolve(file);
    });
    ctx.req.pipe(parser);
  });
}

/** Fill serving fields the primary OCR text missed with values voted across all candidates. */
function applyVotedServing(
  draft: { servingLabel: string; servingsPerContainer: number | null },
  serving: LabelServingFields,
): void {
  if (serving.servingLabel && (!draft.servingLabel || draft.servingLabel === '1 serving')) {
    draft.servingLabel = serving.servingLabel;
  }
  if (serving.servingsPerContainer != null && draft.servingsPerContainer == null) {
    draft.servingsPerContainer = serving.servingsPerContainer;
  }
}
