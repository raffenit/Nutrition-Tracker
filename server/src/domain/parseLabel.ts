import type { Nutrients } from '../types.js';
import { emptyNutrients } from './nutrients.js';

export type LabelParse = {
  servingLabel: string | null;
  nutrients: Nutrients;
  looksLikeLabel: boolean;
};

export function parseNutritionLabel(text: string): LabelParse {
  const compact = text.replace(/calories from fat/gi, ' ').replace(/\s+/g, ' ').trim();
  const nutrients = emptyNutrients();
  nutrients.calories = amount(compact, 'calories', '') ?? 0;
  nutrients.fat = amount(compact, 'total fat', 'g') ?? 0;
  nutrients.carbs = amount(compact, 'total carbohydrates?', 'g') ?? 0;
  nutrients.fiber = amount(compact, 'dietary fiber', 'g') ?? 0;
  nutrients.protein = amount(compact, 'protein', 'g') ?? 0;
  nutrients.sodium = amount(compact, 'sodium', 'mg') ?? 0;
  return {
    servingLabel: servingSize(compact),
    nutrients,
    looksLikeLabel: hasAnyMacro(nutrients),
  };
}

export function menuCandidates(text: string): string[] {
  const seen = new Set<string>();
  const lines = text.split(/\n/).map((line) => line.trim());
  return lines.filter((line) => keepCandidate(line, seen)).slice(0, 40);
}

function amount(text: string, label: string, unit: string): number | null {
  const unitPattern = unit ? `\\s*${unit}` : '';
  const match = text.match(new RegExp(`${label}\\s*:?\\s*(\\d+(?:\\.\\d+)?)${unitPattern}`, 'i'));
  return match ? Number(match[1]) : null;
}

function servingSize(text: string): string | null {
  const match = text.match(/serving size\s*:?\s*(.+?)\s+amount per serving/i)
    ?? text.match(/serving size\s*:?\s*(.+?)\s+calories\b/i);
  if (!match) return null;
  const label = match[1].trim();
  return label.slice(0, 80) || null;
}

function hasAnyMacro(nutrients: Nutrients): boolean {
  return nutrients.calories > 0 || nutrients.protein > 0 || nutrients.fat > 0 || nutrients.carbs > 0;
}

function keepCandidate(line: string, seen: Set<string>): boolean {
  if (line.length < 3 || line.length > 80) return false;
  if (/nutrition|calories|serving|ingredient|daily value|^\d|%$/.test(line.toLowerCase())) return false;
  const key = line.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}
