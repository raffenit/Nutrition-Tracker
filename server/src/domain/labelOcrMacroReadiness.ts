import type { Nutrients } from '../types.js';
import { assessSlotConsensus, mergeSlotReadingsAcrossCandidates, type LabelSlotKey } from './labelSlotExtract.js';

export type CoreImportMacro = 'calories' | 'fat' | 'sodium' | 'carbs' | 'protein';

const CORE_MACROS: CoreImportMacro[] = ['calories', 'fat', 'sodium', 'carbs', 'protein'];

export function missingCoreImportMacros(nutrients: Nutrients): CoreImportMacro[] {
  const missing: CoreImportMacro[] = [];
  if (nutrients.calories <= 0) missing.push('calories');
  if (nutrients.fat <= 0) missing.push('fat');
  if (nutrients.sodium <= 0) missing.push('sodium');
  if (nutrients.carbs <= 0) missing.push('carbs');
  if (nutrients.protein <= 0) missing.push('protein');
  return missing;
}

export function coreImportMacrosReady(nutrients: Nutrients): boolean {
  return missingCoreImportMacros(nutrients).length === 0;
}

export function slotMergedMacrosReadyFromCandidates(candidates: string[]): {
  ready: boolean;
  missing: CoreImportMacro[];
  merged: Nutrients | null;
} {
  const merged = mergeSlotReadingsAcrossCandidates(candidates);
  if (!merged) {
    return { ready: false, missing: [...CORE_MACROS], merged: null };
  }
  const missing = missingCoreImportMacros(merged);
  return { ready: missing.length === 0, missing, merged };
}

const CORE_MACRO_SLOT: Record<CoreImportMacro, LabelSlotKey> = {
  calories: 'calories',
  fat: 'fat',
  sodium: 'sodium',
  carbs: 'carbs',
  protein: 'protein',
};

/** FDA rounding lets rounded sub-rows exceed their parent by up to ~1 unit. */
const SUBROW_ROUNDING_SLACK = 1;

export type CoreMacroReadiness = {
  /** All core macros present, uncontested, and arithmetically consistent. */
  settled: boolean;
  missing: CoreImportMacro[];
  /** Core macros where candidates disagree at similar name/unit confidence. */
  contested: CoreImportMacro[];
  /** Parent rows smaller than their sub-rows (e.g. carbs < sugars + fiber). */
  inconsistent: string[];
  merged: Nutrients | null;
};

/**
 * Progressive OCR gate: stop adding engines only when merged core macros are present,
 * agreed on by the candidate pool, and pass label arithmetic (parent ≥ sub-rows).
 */
export function assessCoreMacroReadiness(candidates: string[]): CoreMacroReadiness {
  const merged = mergeSlotReadingsAcrossCandidates(candidates);
  if (!merged) {
    return { settled: false, missing: [...CORE_MACROS], contested: [], inconsistent: [], merged: null };
  }
  const missing = missingCoreImportMacros(merged);
  const consensus = assessSlotConsensus(candidates);
  const contested = CORE_MACROS.filter(
    (macro) => !missing.includes(macro) && consensus.get(CORE_MACRO_SLOT[macro])?.contested === true,
  );

  const inconsistent: string[] = [];
  const sugar = consensus.get('sugar')?.amount ?? 0;
  const fiber = consensus.get('fiber')?.amount ?? 0;
  if (merged.carbs > 0 && sugar + fiber > merged.carbs + SUBROW_ROUNDING_SLACK) {
    inconsistent.push('carbs<sugar+fiber');
  }
  const saturated = consensus.get('saturated_fat')?.amount ?? 0;
  if (merged.fat > 0 && saturated > merged.fat + SUBROW_ROUNDING_SLACK) {
    inconsistent.push('fat<saturated_fat');
  }

  const settled = missing.length === 0 && contested.length === 0 && inconsistent.length === 0;
  return { settled, missing, contested, inconsistent, merged };
}
