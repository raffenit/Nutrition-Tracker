import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Nutrients } from '../types.js';

/** How the label presents products to OCR / import (not geometry step names alone). */
export type LabelGroundTruthLayout = 'single' | 'multi_column' | 'shared_rail';

/** Label shows "&lt; X" — numeric fields use 0 when the amount is only bounded. */
export type GroundTruthLessThanSpec = {
  field: 'fiber' | 'protein' | 'cholesterol';
  amount: number;
  unit: string;
};

export type LabelProductGroundTruth = {
  productName: string;
  servingLabel?: string;
  nutrients: Nutrients;
  lessThan?: GroundTruthLessThanSpec[];
};

/** Canonical nutrient ground-truth fixture (any label layout). */
export type LabelNutrientGroundTruthFile = {
  sourceImage: string;
  layout?: LabelGroundTruthLayout;
  valueColumnIndexBase?: number;
  valueColumnCount?: number;
  caloriesKcalPerValueColumn?: number[];
  products: LabelProductGroundTruth[];
  /** Subset of compare field ids; default = infer from products. */
  compareFields?: string[];
  notes?: string;
};

export type LabelNutrientGroundTruthBundle = {
  sourceImage: string;
  layout: LabelGroundTruthLayout;
  products: LabelProductGroundTruth[];
  compareFields?: string[];
  notes?: string;
  /** Which fixture file supplied this bundle. */
  fixtureBasename: string;
};

function normalizeProductsFromRecord(
  record: Record<string, unknown>,
): LabelProductGroundTruth[] | null {
  const raw =
    (record.products as LabelProductGroundTruth[] | undefined) ??
    (record.productsPerValueColumn as LabelProductGroundTruth[] | undefined);
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw;
}

function layoutFromRecord(record: Record<string, unknown>, productCount: number): LabelGroundTruthLayout {
  const explicit = record.layout;
  if (explicit === 'single' || explicit === 'multi_column' || explicit === 'shared_rail') return explicit;
  if (productCount <= 1) return 'single';
  return 'shared_rail';
}

function bundleFromParsed(
  parsed: Record<string, unknown>,
  fixtureBasename: string,
): LabelNutrientGroundTruthBundle | null {
  const sourceImage = typeof parsed.sourceImage === 'string' ? parsed.sourceImage : null;
  if (!sourceImage) return null;
  const products = normalizeProductsFromRecord(parsed);
  if (!products) return null;
  return {
    sourceImage,
    layout: layoutFromRecord(parsed, products.length),
    products,
    compareFields: Array.isArray(parsed.compareFields)
      ? (parsed.compareFields as string[]).filter((f) => typeof f === 'string')
      : undefined,
    notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
    fixtureBasename,
  };
}

/**
 * Load human nutrient ground truth for a test image.
 * Matches `*NutrientGroundTruth.json` and legacy shared-label `*GlareGroundTruth.json` with products.
 */
export async function loadLabelNutrientGroundTruthForImage(
  imageBasename: string,
  fixturesDir: string,
): Promise<LabelNutrientGroundTruthBundle | null> {
  let names: string[];
  try {
    names = await readdir(fixturesDir);
  } catch {
    return null;
  }

  const candidates = names
    .filter(
      (n) =>
        n.endsWith('NutrientGroundTruth.json') ||
        (n.endsWith('GlareGroundTruth.json') && !n.endsWith('NutrientGroundTruth.json')),
    )
    .sort((a, b) => {
      const aNutrient = a.endsWith('NutrientGroundTruth.json') ? 0 : 1;
      const bNutrient = b.endsWith('NutrientGroundTruth.json') ? 0 : 1;
      return aNutrient - bNutrient || a.localeCompare(b);
    });

  for (const name of candidates) {
    const raw = await readFile(path.join(fixturesDir, name), 'utf8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (parsed.sourceImage !== imageBasename) continue;
    const bundle = bundleFromParsed(parsed, name);
    if (bundle) return bundle;
  }
  return null;
}