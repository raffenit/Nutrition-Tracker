/**
 * Client mirror of the unit families in server/src/domain/groceryList.ts —
 * volume and weight convert to a common base so shopping lines can offer
 * alternate units ("2 cup" ↔ "470 g" style). Count-ish units never convert.
 */

const VOLUME_TO_ML: Record<string, number> = {
  tsp: 4.92892, tbsp: 14.7868, cup: 236.588, ml: 1, l: 1000, L: 1000,
};
const WEIGHT_TO_G: Record<string, number> = {
  oz: 28.3495, lb: 453.592, g: 1, kg: 1000,
};

export type MeasureFamily = 'volume' | 'weight' | null;

export function measureFamily(unit: string): MeasureFamily {
  const lower = unit.trim().toLowerCase();
  if (lower in VOLUME_TO_ML) return 'volume';
  if (lower in WEIGHT_TO_G) return 'weight';
  return null;
}

/** Units a shopper can switch between for a given unit (same family only). */
export function convertibleUnitOptions(unit: string): string[] {
  const family = measureFamily(unit);
  if (family === 'volume') return ['cup', 'tbsp', 'tsp', 'ml', 'L'];
  if (family === 'weight') return ['oz', 'lb', 'g', 'kg'];
  return [unit.trim()];
}

function toBase(quantity: number, unit: string): number | null {
  const trimmed = unit.trim();
  const table = measureFamily(trimmed) === 'volume' ? VOLUME_TO_ML : measureFamily(trimmed) === 'weight' ? WEIGHT_TO_G : null;
  if (!table) return null;
  const factor = table[trimmed] ?? table[trimmed.toLowerCase()];
  return factor == null ? null : quantity * factor;
}

/** Convert a quantity between same-family units; null when units don't convert. */
export function convertMeasure(quantity: number, fromUnit: string, toUnit: string): number | null {
  if (measureFamily(fromUnit) !== measureFamily(toUnit) || measureFamily(fromUnit) === null) return null;
  const base = toBase(quantity, fromUnit);
  const target = toBase(1, toUnit);
  if (base == null || target == null || target === 0) return null;
  return Math.round((base / target) * 1000) / 1000;
}

/** Trim float noise for display ("2.125" → "2.13", "2.00" → "2"). */
export function formatMeasureQty(value: number): string {
  return String(Math.round(value * 100) / 100);
}
