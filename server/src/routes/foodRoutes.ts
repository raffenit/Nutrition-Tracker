import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import Busboy from 'busboy';
import { attachUpload, findUpload, insertUpload } from '../db/uploads.js';
import { deleteFood, getFood, insertFood, listFoods, setFavorite, updateFood, type FoodShelf } from '../db/foods.js';
import { perServing, sumIngredientNutrients } from '../domain/compose.js';
import { favoriteOnly, readFoodInput } from '../domain/foodInput.js';
import { isRecord, requiredNumber, requiredText } from '../domain/guards.js';
import { readNutrients, roundNutrients } from '../domain/nutrients.js';
import { buildNutritionImport } from '../domain/nutritionImport.js';
import { extractImageText, extractPdfText } from '../integrations/extractText.js';
import { importNutritionFromUrl } from '../integrations/importUrl.js';
import { searchOpenFoodFacts } from '../integrations/openFoodFacts.js';
import { searchUsda } from '../integrations/usda.js';
import { HttpError } from '../http/errors.js';
import { requireUser } from '../http/access.js';
import { readJson, sendJson } from '../http/respond.js';
import { route, type Ctx, type Route } from '../http/router.js';
import type { Food, SearchHit } from '../types.js';

const MAX_UPLOAD = 12 * 1024 * 1024;

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
  ];
}

async function saveNewFood(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  const food = insertFood(ctx.db, readFoodInput(body, user.id));
  const uploadId = isRecord(body) ? body.uploadId : null;
  if (typeof uploadId === 'string') attachOwnedUpload(ctx, uploadId, food.id);
  sendJson(ctx.res, 201, { food });
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
  const lines = body.ingredients.map((line) => ingredientLine(ctx, line));
  const makesServings = requiredNumber(body.makesServings, 'Servings');
  const nutrients = roundNutrients(perServing(sumIngredientNutrients(lines), makesServings));
  const food = insertFood(ctx.db, {
    createdBy: user.id,
    name: requiredText(body.name, 'Name'),
    brand: null,
    kind: 'custom',
    servingLabel: '1 serving',
    nutrients,
    isFavorite: body.isFavorite === true,
    isDrink: false,
    drinkMl: null,
    makesServings,
    source: 'composed',
    sourceRef: null,
    ingredients: lines.map(({ nutrients: _nutrients, ...line }) => line),
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
  const file = await readUpload(ctx);
  const kind = uploadKind(file.mime, file.filename);
  if (!kind) throw new HttpError(400, 'Upload a JPEG, PNG, WEBP, or PDF');
  const storedName = `${randomUUID()}${kind === 'pdf' ? '.pdf' : extensionFor(file.filename)}`;
  await writeFile(path.join(ctx.config.uploadDir, storedName), file.bytes);
  const extracted = await readExtractedText(kind, file.bytes, ctx.config.tessdataDir);
  const built = buildNutritionImport(extracted.text, kind);
  const warning = extracted.warning ?? built.warning;
  const saved = insertUpload(ctx.db, {
    kind,
    originalName: path.basename(file.filename).slice(0, 180) || 'upload',
    storedName,
    extractedText: extracted.text,
    createdBy: user.id,
  });
  sendJson(ctx.res, 200, {
    uploadId: saved.id,
    kind,
    warning,
    draft: { ...built.draft, source: kind },
    candidates: built.candidates,
    menuItems: built.menuItems,
  });
}

async function importFromUrl(ctx: Ctx): Promise<void> {
  requireUser(ctx.auth);
  const body = await readJson(ctx.req);
  if (!isRecord(body)) throw new HttpError(400, 'Expected a URL');
  const url = requiredText(body.url, 'URL');
  const fetched = await importNutritionFromUrl(url);
  const built = buildNutritionImport(fetched.text, fetched.kind, fetched.html);
  sendJson(ctx.res, 200, {
    uploadId: null,
    kind: fetched.kind,
    finalUrl: fetched.finalUrl,
    warning: built.warning,
    draft: built.draft,
    candidates: built.candidates,
    menuItems: built.menuItems,
  });
}

function attachOwnedUpload(ctx: Ctx, uploadId: string, foodId: string): void {
  const upload = findUpload(ctx.db, uploadId);
  if (!upload || upload.createdBy !== requireUser(ctx.auth).id) throw new HttpError(404, 'Upload not found');
  attachUpload(ctx.db, uploadId, foodId);
}

function ingredientLine(ctx: Ctx, value: unknown): { name: string; servings: number; nutrients: ReturnType<typeof readNutrients>; sourceRef: string | null; childFoodId: string | null } {
  if (!isRecord(value)) throw new HttpError(400, 'Each ingredient needs a name');
  const servings = requiredNumber(value.servings, 'Ingredient amount');
  if (servings <= 0) throw new HttpError(400, 'Ingredient amount must be greater than zero');
  const childFoodId = typeof value.foodId === 'string' ? value.foodId : null;
  if (childFoodId) {
    const food = getFood(ctx.db, childFoodId);
    if (!food) throw new HttpError(400, 'Unknown ingredient');
    return { name: food.name, servings, nutrients: food.nutrients, sourceRef: food.sourceRef, childFoodId };
  }
  return {
    name: requiredText(value.name, 'Ingredient'),
    servings,
    nutrients: readNutrients(value.nutrients),
    sourceRef: typeof value.sourceRef === 'string' ? value.sourceRef : null,
    childFoodId: null,
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
  const nutrients = roundNutrients(perServing(sumIngredientNutrients(lines), input.makesServings));
  return { ...input, nutrients, ingredients: lines.map(({ name, servings, sourceRef, childFoodId }) => ({ name, servings, sourceRef, childFoodId })) };
}

async function remoteHits(ctx: Ctx, query: string): Promise<SearchHit[]> {
  const usda = ctx.config.usdaApiKey ? await searchUsda(query, ctx.config.usdaApiKey).catch(() => []) : [];
  const packaged = await searchOpenFoodFacts(query).catch(() => []);
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

async function readExtractedText(kind: 'image' | 'pdf', bytes: Buffer, tessdata: string): Promise<{ text: string; warning: string | null }> {
  try {
    const text = kind === 'pdf' ? await extractPdfText(bytes) : await extractImageText(bytes, tessdata);
    return { text, warning: text.trim() ? null : 'No text was found. Enter the nutrition facts yourself.' };
  } catch {
    return { text: '', warning: 'The file is saved, and the text could not be read. Enter the nutrition facts yourself.' };
  }
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
      if (tooBig) reject(new HttpError(413, 'File is larger than 12 MB'));
      else if (!file) reject(new HttpError(400, 'Choose a file'));
      else resolve(file);
    });
    ctx.req.pipe(parser);
  });
}
