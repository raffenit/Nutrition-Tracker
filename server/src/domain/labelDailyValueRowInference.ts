import { mergeSlotReadingsAcrossCandidates } from './labelSlotExtract.js';

/**
 * Recover rows whose nutrient name OCR could not read (e.g. squashed on a curved tub edge) from
 * the amount and its %DV: "90mg 4%" can only be sodium (90 / 2300 ≈ 4%). Uses FDA (2016+) daily values.
 */

type DvNutrient = {
  key: string;
  label: string;
  unit: 'g' | 'mg' | 'mcg';
  dailyValue: number;
  /** Already read from the text when this matches (skip inference). */
  labelRe: RegExp;
  coreSlot?: 'fat' | 'sodium' | 'carbs' | 'fiber' | 'protein';
};

const DV_NUTRIENTS: DvNutrient[] = [
  { key: 'fat', label: 'Total Fat', unit: 'g', dailyValue: 78, labelRe: /total\s*fat/i, coreSlot: 'fat' },
  { key: 'saturated_fat', label: 'Saturated Fat', unit: 'g', dailyValue: 20, labelRe: /saturated/i },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', dailyValue: 300, labelRe: /cholesterol/i },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dailyValue: 2300, labelRe: /sodium/i, coreSlot: 'sodium' },
  { key: 'carbs', label: 'Total Carbohydrate', unit: 'g', dailyValue: 275, labelRe: /carb/i, coreSlot: 'carbs' },
  { key: 'fiber', label: 'Dietary Fiber', unit: 'g', dailyValue: 28, labelRe: /fiber/i, coreSlot: 'fiber' },
  { key: 'added_sugars', label: 'Incl. Added Sugars', unit: 'g', dailyValue: 50, labelRe: /added/i },
  { key: 'protein', label: 'Protein', unit: 'g', dailyValue: 50, labelRe: /protein/i, coreSlot: 'protein' },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'mcg', dailyValue: 20, labelRe: /vitamin\s*d/i },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dailyValue: 1300, labelRe: /calcium/i },
  { key: 'iron', label: 'Iron', unit: 'mg', dailyValue: 18, labelRe: /\biron\b/i },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dailyValue: 4700, labelRe: /potassium/i },
];

export type DvInferredRow = { key: string; label: string; amount: number; unit: string; percent: number };

/** `cost` counts assumed OCR repairs (dropped unit glyph, inserted decimal, misread %). */
type AmountReading = { value: number; unit: 'g' | 'mg' | 'mcg' | null; cost: number };
type PercentReading = { value: number; cost: number };

/** OCR letter→digit confusions inside numeric tokens. */
function normalizeNumericToken(token: string): string {
  return token
    .replace(/[_.,:;]+$/, '')
    .replace(/^[Il|]/, '1')
    .replace(/(?<=\d)[Il|]|[Il|](?=\d)/g, '1')
    .replace(/(?<=\d)[Oo]|[Oo](?=\d)|^[Oo](?=[.,]?\d|mg|mcg|g)/g, '0');
}

/** Interpretations of an amount token; unitless digits may have lost a decimal point or a trailing "g". */
export function amountReadings(token: string): AmountReading[] {
  const t = normalizeNumericToken(token);
  const withUnit = /^(\d+(?:[.,]\d+)?)(mcg|mg|g)$/i.exec(t);
  if (withUnit) {
    return [
      { value: Number(withUnit[1]!.replace(',', '.')), unit: withUnit[2]!.toLowerCase() as AmountReading['unit'], cost: 0 },
    ];
  }
  const bare = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (!bare) return [];
  const raw = bare[1]!;
  const forms = new Map<string, number>([[raw, 0]]);
  // "g" is often read as 0 or 9 at the end of an amount.
  if (raw.length >= 2 && /[09]$/.test(raw)) forms.set(raw.slice(0, -1), 1);
  for (const [form, cost] of [...forms]) {
    const dotted = `${form.slice(0, -1)}.${form.slice(-1)}`;
    if (!form.includes('.') && form.length >= 2 && !forms.has(dotted)) forms.set(dotted, cost + 1);
  }
  return [...forms].map(([f, cost]) => ({ value: Number(f), unit: null, cost }));
}

/** Interpretations of a %DV token; "%" is often read as 9, 8, 6 or k. */
export function percentReadings(token: string): PercentReading[] {
  const t = normalizeNumericToken(token);
  const explicit = /^(\d{1,3})%$/.exec(t);
  if (explicit) return [{ value: Number(explicit[1]), cost: 0 }];
  const glyph = /^(\d{1,3})[kK]$/.exec(t);
  if (glyph) return [{ value: Number(glyph[1]), cost: 1 }];
  const bare = /^(\d{1,3})$/.exec(t);
  if (!bare) return [];
  const out = [{ value: Number(bare[1]), cost: 0 }];
  if (bare[1]!.length >= 2 && /[986]$/.test(bare[1]!)) out.push({ value: Number(bare[1]!.slice(0, -1)), cost: 1 });
  return out;
}

function percentMatches(amount: number, dailyValue: number, percent: number): boolean {
  if (percent <= 0 || percent > 200 || amount <= 0) return false;
  const predicted = (100 * amount) / dailyValue;
  return Math.abs(predicted - percent) <= Math.max(1, 0.12 * percent);
}

function matchPair(amountToken: string, percentToken: string): DvInferredRow | null {
  const amounts = amountReadings(amountToken);
  const percents = percentReadings(percentToken);
  if (amounts.length === 0 || percents.length === 0) return null;
  type Scored = DvInferredRow & { cost: number; err: number };
  const byKey = new Map<string, Scored>();
  for (const nutrient of DV_NUTRIENTS) {
    for (const a of amounts) {
      if ((a.unit ?? 'g') !== nutrient.unit) continue;
      for (const p of percents) {
        if (!percentMatches(a.value, nutrient.dailyValue, p.value)) continue;
        const cost = a.cost + p.cost;
        const err = Math.abs((100 * a.value) / nutrient.dailyValue - p.value);
        const prev = byKey.get(nutrient.key);
        if (!prev || cost < prev.cost || (cost === prev.cost && err < prev.err)) {
          byKey.set(nutrient.key, {
            key: nutrient.key, label: nutrient.label, amount: a.value, unit: nutrient.unit, percent: p.value, cost, err,
          });
        }
      }
    }
  }
  // Fewest assumed repairs wins; a tie between different nutrients is ambiguous.
  const ranked = [...byKey.values()].sort((x, y) => x.cost - y.cost);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[1]!.cost === ranked[0]!.cost)) return null;
  const { cost: _cost, err: _err, ...row } = ranked[0]!;
  return row;
}

/**
 * Scan the token stream for amount→%DV pairs and keep nutrients matched uniquely by daily value.
 * The first match per nutrient wins (per-serving precedes per-container); a later, smaller match
 * for the same nutrient makes it ambiguous and drops it.
 */
export function inferDailyValueRows(text: string): DvInferredRow[] {
  const tokens = text.split(/\s+/).filter((t) => t && !/^[_—\-–|]+$/.test(t));
  const first = new Map<string, DvInferredRow>();
  const rejected = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const row = matchPair(tokens[i]!, tokens[i + 1]!);
    if (!row || rejected.has(row.key)) continue;
    const prev = first.get(row.key);
    if (!prev) first.set(row.key, row);
    else if (row.amount < prev.amount) {
      first.delete(row.key);
      rejected.add(row.key);
    }
    i += 1;
  }
  return [...first.values()];
}

/** Append inferred rows for nutrients the text does not already name, so slot parsing can read them. */
export function appendDailyValueInferredRows(text: string): string {
  const merged = mergeSlotReadingsAcrossCandidates([text]);
  const lines: string[] = [];
  for (const row of inferDailyValueRows(text)) {
    const nutrient = DV_NUTRIENTS.find((n) => n.key === row.key)!;
    if (nutrient.labelRe.test(text)) continue;
    if (nutrient.coreSlot && merged && merged[nutrient.coreSlot] > 0) continue;
    lines.push(`${row.label} ${row.amount}${row.unit} ${row.percent}%`);
  }
  return lines.length > 0 ? `${text}\n${lines.join('\n')}` : text;
}
