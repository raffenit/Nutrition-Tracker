import type { Nutrients } from '../types.js';
import type { RecipeCardImportDraft } from '../domain/nutritionImport.js';
import { collectJsonLdNodes, jsonLdDocuments } from './jsonLd.js';

/**
 * schema.org `Recipe` JSON-LD → recipe-card import draft.
 * Covers the structured-data shape used by most recipe sites
 * (name, recipeYield, recipeIngredient, recipeInstructions, nutrition).
 */
export function recipeCardFromJsonLd(html: string | null): RecipeCardImportDraft | null {
  if (!html) return null;
  for (const doc of jsonLdDocuments(html)) {
    for (const node of collectJsonLdNodes(doc)) {
      if (!isRecipeNode(node)) continue;
      const draft = draftFromRecipeNode(node);
      if (draft) return draft;
    }
  }
  return null;
}

/** Best-effort page title for recipe pages without usable Recipe JSON-LD. */
export function pageTitleFromHtml(html: string | null): string | null {
  if (!html) return null;
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og?.[1]) return decodeEntities(og[1]).trim() || null;
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const title = decodeEntities(h1[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (title) return title;
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const title = decodeEntities(titleTag[1]).replace(/\s+/g, ' ').trim();
    if (title) return title;
  }
  return null;
}

function isRecipeNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((value) => typeof value === 'string' && value.toLowerCase() === 'recipe');
}

function draftFromRecipeNode(node: Record<string, unknown>): RecipeCardImportDraft | null {
  const name = textValue(node.name)?.trim();
  if (!name) return null;
  const ingredients = recipeIngredients(node.recipeIngredient);
  const instructions = recipeInstructions(node.recipeInstructions);
  if (ingredients.length === 0 && instructions.length < 40) return null;
  return {
    name,
    brand: null,
    makesServings: recipeYieldServings(node.recipeYield),
    servingLabel: '1 serving',
    nutrients: recipeNutrients(node.nutrition),
    ingredients: ingredients.map((line) => ({ name: line, servings: 1 })),
    instructions,
  };
}

function recipeIngredients(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const lines: string[] = [];
  for (const item of items) {
    const line = ingredientLine(item);
    if (line) lines.push(line);
  }
  return lines;
}

function ingredientLine(item: unknown): string | null {
  if (typeof item === 'string') return cleanInline(item);
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  for (const key of ['name', 'item', 'text']) {
    const value = record[key];
    if (typeof value === 'string') return cleanInline(value);
  }
  return null;
}

function recipeInstructions(value: unknown): string {
  if (typeof value === 'string') return cleanBlock(value);
  const steps: string[] = [];
  collectInstructionSteps(value, steps);
  return steps.join('\n').trim();
}

function collectInstructionSteps(value: unknown, steps: string[]): void {
  if (value == null) return;
  if (typeof value === 'string') {
    const text = cleanInline(value);
    if (text) steps.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectInstructionSteps(item, steps);
    return;
  }
  if (typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  const types = Array.isArray(type) ? type : [type];
  const isSection = types.some((t) => typeof t === 'string' && t.toLowerCase() === 'howtosection');
  if (isSection) {
    collectInstructionSteps(record.itemListElement, steps);
    return;
  }
  for (const key of ['text', 'name']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      steps.push(cleanInline(candidate));
      return;
    }
  }
  collectInstructionSteps(record.itemListElement, steps);
}

function recipeYieldServings(value: unknown): number {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    const text = typeof item === 'number' ? String(item) : typeof item === 'string' ? item : null;
    if (text == null) continue;
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) return Math.max(1, Math.round(Number(match[1])));
  }
  return 1;
}

function recipeNutrients(value: unknown): Nutrients {
  const nutrients: Nutrients = { calories: 0, protein: 0, fiber: 0, fat: 0, carbs: 0, sodium: 0, extras: [] };
  const infos = Array.isArray(value) ? value : [value];
  for (const info of infos) {
    if (!info || typeof info !== 'object') continue;
    const record = info as Record<string, unknown>;
    nutrients.calories = firstNumber(nutrients.calories, record, ['calories', 'calorieContent']);
    nutrients.protein = firstNumber(nutrients.protein, record, ['proteinContent']);
    nutrients.fat = firstNumber(nutrients.fat, record, ['fatContent']);
    nutrients.carbs = firstNumber(nutrients.carbs, record, ['carbohydrateContent']);
    nutrients.fiber = firstNumber(nutrients.fiber, record, ['fiberContent']);
    nutrients.sodium = firstNumber(nutrients.sodium, record, ['sodiumContent']);
  }
  return nutrients;
}

function firstNumber(current: number, record: Record<string, unknown>, keys: string[]): number {
  if (current > 0) return current;
  for (const key of keys) {
    const parsed = numberFrom(record[key]);
    if (parsed != null) return parsed;
  }
  return current;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return numberFrom(record.value ?? record['@value']);
  }
  return null;
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return record.name;
    if (typeof record['@value'] === 'string') return record['@value'];
  }
  return null;
}

function cleanInline(value: string): string {
  return decodeEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanBlock(value: string): string {
  return decodeEntities(value)
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}
