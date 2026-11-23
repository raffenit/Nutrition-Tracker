import { HttpError } from '../http/errors.js';

/**
 * Canonical protein tags for meal-plan shuffling. Foods and recipes carry
 * a JSON list of these on `protein_tags_json`; the planner filters
 * candidates by them ("fish and chicken" = any-of match).
 */
export const PROTEIN_TAGS = [
  'chicken',
  'turkey',
  'beef',
  'pork',
  'fish',
  'shellfish',
  'tofu',
  'eggs',
  'dairy',
  'legumes',
] as const;

export type ProteinTag = (typeof PROTEIN_TAGS)[number];

/** Recipe ingredient-line roles for mix-and-match planning (main vs side). */
export const COMPONENT_ROLES = ['main', 'side'] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

export function isProteinTag(value: string): value is ProteinTag {
  return (PROTEIN_TAGS as readonly string[]).includes(value);
}

export function isComponentRole(value: string): value is ComponentRole {
  return (COMPONENT_ROLES as readonly string[]).includes(value);
}

/** Parse a stored/request protein tag list — unknown tags are dropped, dupes removed. */
export function readProteinTags(value: unknown): ProteinTag[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'Protein tags must be a list');
  const tags = new Set<ProteinTag>();
  for (const item of value) {
    if (typeof item !== 'string') throw new HttpError(400, 'Protein tags must be text');
    const trimmed = item.trim().toLowerCase();
    if (!trimmed) continue;
    if (!isProteinTag(trimmed)) throw new HttpError(400, `Unknown protein tag "${item}"`);
    tags.add(trimmed);
  }
  return [...tags];
}

/** Parse a stored/request component role — null/empty means untagged. */
export function readComponentRole(value: unknown): ComponentRole | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !isComponentRole(value.trim().toLowerCase())) {
    throw new HttpError(400, 'Component role must be main or side');
  }
  return value.trim().toLowerCase() as ComponentRole;
}

/** Stored JSON column helpers — tolerate corrupt/legacy values as empty. */
export function parseStoredProteinTags(json: string | null | undefined): ProteinTag[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ProteinTag => typeof item === 'string' && isProteinTag(item));
  } catch {
    return [];
  }
}

export function parseStoredComponentRole(value: string | null | undefined): ComponentRole | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return isComponentRole(trimmed) ? trimmed : null;
}

